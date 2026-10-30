# 비밀 값 노출 검사 (`gitleaks`)

## 무엇을 찾나요
소스 코드 · 설정 파일에 하드코딩된 API 키, 비밀번호, JWT, 개인 키 등.
`scope=history` 이면 지금은 지웠지만 git 커밋 기록에 남아 있는 비밀 값도 찾습니다.
OWASP A07:2025 (Authentication Failures), CWE-798 (Use of Hard-coded Credentials).

## 핵심 도구
- [Gitleaks](https://github.com/gitleaks/gitleaks) — MIT, 비밀 값 검출 분야에서 가장 널리 쓰이는 오픈소스 도구 중 하나 (GitHub 스타 2만 이상, 수백 개의 공급자별 규칙)
- 설치: `winget install Gitleaks.Gitleaks` (Windows) · `brew install gitleaks` (macOS) · [릴리스](https://github.com/gitleaks/gitleaks/releases)
- 확인한 버전: 8.30.1

## 단계별 동작
| 단계 | 하는 일 | AI |
|---|---|---|
| 전처리 | 검사할 파일이 있는지, 프로젝트에 `.gitleaks.toml` 이 있는지(있으면 gitleaks 가 자동으로 사용), `scope=history` 일 때 프로젝트 루트에 `.git` 이 있는지 확인 (없으면 경고 후 현재 파일만) | 없음 |
| 툴 | `gitleaks dir . --redact --report-format json --report-path -`, `scope=history` 이면 같은 옵션으로 `gitleaks git .` 도 실행 (`maxCommits` 가 있으면 `--log-opts "--full-history --all --diff-filter=tuxdb -n N"`) | - |
| 후처리 | 누출 1건 = Finding 1건. 경로를 프로젝트 기준으로 맞추고, `.safescanignore` · 기본 제외 폴더 · (옵션) 테스트 · 예제 경로의 결과를 거름. 커밋 기록 결과 중 현재 파일에 그대로 있는 값(파일 · 규칙 · 가린 일치 문자열이 같음)은 한 번만 보고 | 없음 |
| 검증 | 비밀 값이 모두 가려졌는지(REDACTED), 도구 결과 수 = 결과 수 + 제외 경로 + 테스트 · 예제 + 겹치는 기록 인지 확인 | 없음 |

## 옵션
| 키 | 타입 | 기본 | 설명 |
|---|---|---|---|
| `scope` | enum `files` · `history` | `files` | 검사 범위. `history` 는 현재 파일 + git 커밋 기록 (`gitleaks git`). 프로젝트 루트가 git 저장소가 아니면 현재 파일만 |
| `excludeTests` | boolean | false | `test` · `tests` · `__tests__` · `spec` · `fixtures` · `examples` · `mocks` · `e2e` 폴더와 `*.test.*` · `*.spec.*` · `test_*` · `*Test.java` · `*.example` · `*.sample`(예: `.env.example`) 파일의 결과를 뺌 |
| `maxCommits` | number 0~100000 (고급, `scope=history` 일 때) | 0 | 검사할 최근 커밋 수. 0 이면 전체 기록 |
| `maxFileMB` | number 1~100 MB (고급) | 5 | 이보다 큰 파일은 건너뜀 (`--max-target-megabytes`) |

```bash
safescan scan ./my-app -m gitleaks -o gitleaks.scope=history -o gitleaks.excludeTests=true
```

## 위험도 · 신뢰도 기준
| 규칙 | 위험도 | 신뢰도 |
|---|---|---|
| `private-key`, 클라우드 · 저장소 · 메신저 토큰 (`aws-*`, `gcp-*`, `azure-*`, `github-*`, `gitlab-pat`, `slack-*`) | critical | 0.85 |
| 형식이 정해진 그 밖의 규칙 (`jwt` 등) | high | 0.85 |
| `generic-api-key` (키워드 + 엔트로피 추정) | high | 엔트로피 4.5 이상 0.7, 미만 0.55 |

## 비밀 값 처리
- 항상 `--redact` 로 실행하므로 결과 · 이슈 · 로그 어디에도 원문이 남지 않습니다. 검증 단계가 이를 매번 확인합니다.
- 도구 출력(stdout)은 콘솔로 흘리지 않습니다 (`quiet`).

## 커밋 기록 결과
- 제목 끝에 `(커밋 기록)` 이 붙고, 설명에 커밋 앞 8자리와 날짜가 들어갑니다. 줄 번호는 그 커밋 시점의 줄입니다.
- 작성자 이름 · 이메일은 개인정보라 결과에 담지 않습니다.
- 조치: 값을 폐기 · 재발급하는 것이 먼저이고, 기록에서도 지우려면 `git filter-repo` 등으로 기록을 다시 써야 합니다.

## fingerprint · 이슈 묶기
줄 번호 대신 `파일 + 규칙 + 가린 일치 문자열(예: password: 'REDACTED') + 같은 모양의 순번` 으로 만듭니다. 커밋 기록 결과는 앞에 커밋 해시를 더합니다.
코드가 위아래로 밀려도 같은 이슈로 이어지고, 값을 지우면 해당 이슈가 조치 완료로 옮겨집니다.
같은 비밀 값이 여러 파일에 있어도 원문을 볼 수 없으므로 하나로 묶지 않습니다 (위치마다 이슈 하나).

## 한계
- `generic-api-key` 는 흔한 단어(shop, api 등)가 들어간 값을 일부러 무시합니다 → 벤치 예제의 `payments.js` 가 이 경우이며 '놓침'으로 기록됩니다.
- 기본(`scope=files`)은 git 커밋 기록을 보지 않습니다. 이미 지운 비밀 값이 과거 커밋에 남아 있을 수 있으니 `scope=history` 로 한 번은 확인하세요.
- 커밋 기록은 프로젝트 루트에 `.git` 이 있을 때만 봅니다 (저장소 안의 하위 폴더를 검사하면 현재 파일만).
- 커밋 기록과 현재 파일의 같은 값은 `파일 + 규칙 + 가린 일치 문자열` 로 맞춥니다. 원문을 볼 수 없으므로, 같은 줄 모양에 값만 바뀐 경우도 같은 값으로 봅니다.
- gitleaks 가 폴더 전체를 훑으므로 `node_modules` 가 큰 프로젝트에서는 느릴 수 있습니다 (결과에서는 제외됨).

## 코어 변경 요청
없음 (이 모듈을 만들며 `ctx.project.isIgnored` 와 `Finding.group` 이 코어에 추가됨)
