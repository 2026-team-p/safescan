# npm 의존성 취약점 검사 (`npm-audit`)

새 모듈을 만들 때 참고하는 **기준 예시**입니다. 4단계를 모두 쓰고, 옵션 · 검증 · fixtures 를 갖추고 있습니다.

## 무엇을 찾나요
`package-lock.json` / `npm-shrinkwrap.json` 에 고정된 패키지 중 GitHub Advisory Database 에 보안 권고가 있는 버전.
OWASP A03:2025 (Software Supply Chain Failures).

## 핵심 도구
- [npm audit](https://docs.npmjs.com/cli/commands/npm-audit) — npm 공식 CLI, npm 레지스트리의 권고 DB 사용
- Node.js 와 함께 설치되므로 별도 설치가 필요 없습니다. **레지스트리 접속(네트워크)이 필요합니다.**

## 단계별 동작
| 단계 | 하는 일 | AI |
|---|---|---|
| 전처리 | lockfile 찾기, 설치 버전 · 줄 번호 미리 추출 (npm audit 결과에는 없음) | 없음 |
| 툴 | lockfile 마다 `npm audit --json --package-lock-only` (`omitDev` 이면 `--omit=dev`) | - |
| 후처리 | 권고 1건 = Finding 1건. severity `moderate`→`medium`, `info`→`low`. `minSeverity` · `directOnly` 에 맞지 않는 권고는 뺌 | 없음 |
| 검증 | npm 이 보고한 취약 패키지 수(옵션으로 고른 범위)와 결과 패키지 수 비교 | 없음 |

## 옵션
| 키 | 타입 | 기본 | 설명 |
|---|---|---|---|
| `minSeverity` | enum `low` · `medium` · `high` · `critical` | `low` | 보고할 최소 위험도 (SafeScan 위험도 기준, `moderate` = `medium`). `npm audit --audit-level` 은 종료 코드만 바꾸므로 후처리에서 거릅니다 |
| `omitDev` | boolean | false | devDependencies 제외 (`--omit=dev`) |
| `directOnly` | boolean | false | `package.json` 에 직접 적은 패키지(`isDirect`)의 권고만. 다른 패키지를 거쳐 설치된 패키지의 권고는 뺌 |

```bash
safescan scan ./my-app -m npm-audit -o npm-audit.omitDev=true -o npm-audit.minSeverity=high
```

## 신뢰도 기준
- 직접 의존성 0.9, 간접 의존성 0.75
- 권고 DB 는 정확하지만, 취약한 함수를 실제로 호출하는지(도달 가능성)는 보지 않습니다.

## 한계
- 중첩 설치(`node_modules/a/node_modules/b`)의 버전은 최상위 버전으로 표시됩니다.
- yarn · pnpm lockfile 은 지원하지 않습니다 (별도 모듈로 만드는 것을 권장).
- 오프라인에서는 실패합니다.
- `directOnly` 를 켜면 간접 의존성의 권고가 모두 빠집니다. 그중에는 직접 의존성을 올려야 해결되는 것도 있으니, 배포 전에는 한 번 끄고 확인하세요.

## 벤치
`fixtures/vulnerable` 에 `lodash@4.17.20`, `minimist@1.2.5` 를 고정해 두었습니다.
권고 DB 가 계속 늘어나므로 `expected.json` 은 `allowExtra: true` 로 재현율만 봅니다.
