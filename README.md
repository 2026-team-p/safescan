# SafeScan

웹 개발자를 위한 오픈소스 보안 검사 프레임워크.
검증된 보안 도구(npm audit, Semgrep, ZAP …)를 **모듈**로 감싸 같은 형식의 결과로 모으고,
각 단계의 시간 · AI 비용 · 정확도를 기록해 효율을 비교합니다.

> 현재 단계: **모듈 뼈대**. 모듈 계약 · 러너 · CLI · 템플릿 · 예시 모듈(npm-audit)이 준비되어 있습니다.
> 로컬 UI(`safescan run`)와 AI 추천 · 수정 요청은 다음 단계입니다.

## 빠른 시작

```bash
git clone <이 저장소> safescan && cd safescan
npm install
npm link                      # (선택) 어디서나 safescan 명령 사용
safescan scan ../my-web-app   # npm link 없이: node bin/safescan.js scan ../my-web-app
```

| 명령 | 설명 |
|---|---|
| `safescan list [경로]` | 모듈 목록, 경로를 주면 적용 여부 표시 |
| `safescan scan [경로]` | 프로젝트에 맞는 모듈을 골라 검사 (`-m a,b`, `--all`, `-o 모듈.키=값`, `--json`) |
| `safescan new <id>` | 템플릿으로 새 모듈 만들기 |
| `safescan check [id…]` | 모듈 계약 검사 |
| `safescan bench [id…]` | 예제 프로젝트로 정확도 측정 · 기록 |

검사 결과는 대상 프로젝트의 `.safescan/runs/<runId>/` 에 `run.json`, `events.jsonl` 로 저장됩니다.

### 검사에서 뺄 경로 (`.safescanignore`)

테스트용 예제, 생성된 파일처럼 검사하지 않을 경로는 대상 프로젝트 루트의 `.safescanignore` 에 적습니다.
`node_modules`, `.git`, `dist`, `build` 등은 따로 적지 않아도 항상 제외됩니다.

```gitignore
# 한 줄에 패턴 하나. # 으로 시작하는 줄은 주석 (패턴 뒤에 주석을 붙일 수는 없음)

# 이름이 같은 폴더 · 파일을 어느 위치에서든 제외 (폴더면 그 아래 전부)
generated/
# * 는 폴더 경계(/)를 넘지 않음
*.min.js
# / 가 들어 있거나 / 로 시작하면 프로젝트 루트 기준
modules/*/fixtures/
# ** 는 여러 단계 폴더를 건너뜀
docs/**/draft
```

`!` 로 다시 포함시키는 문법은 지원하지 않습니다. 이 저장소에도 벤치용 예제를 빼는 [`.safescanignore`](.safescanignore) 가 있습니다.

## 구조

```
 프로젝트 ─▶ 모듈 ─┬─ 전처리   소스에서 도구 입력 모으기 (필요하면 AI)
                   ├─ 툴       공개 · 검증된 보안 도구 실행
                   ├─ 후처리   표준 Finding 으로 정리 (필요하면 AI)
                   └─ 검증     시간 · 토큰 · 비용 · 정확도 기록과 자체 점검
                         │
                         ▼
            이벤트 스트림 ─▶ CLI 출력 / (다음 단계) 로컬 UI 스텝퍼 · 콘솔 · 텔레메트리
```

- 계약: [`src/sdk/types.d.ts`](src/sdk/types.d.ts)
- 모듈 작성 가이드: [`docs/MODULE_GUIDE.md`](docs/MODULE_GUIDE.md)
- 만들 모듈 후보: [`docs/MODULE_BACKLOG.md`](docs/MODULE_BACKLOG.md)
- AI 에이전트용 안내: [`AGENTS.md`](AGENTS.md)

## AI 설정 (선택)

AI 를 쓰는 모듈만 영향을 받습니다. 설정하지 않아도 AI 없는 모듈은 그대로 동작합니다.

| 환경 변수 | 설명 |
|---|---|
| `ANTHROPIC_API_KEY` | 있으면 Claude 사용 |
| `SAFESCAN_AI_PROVIDER` | `anthropic` · `mock` · `none` |
| `SAFESCAN_AI_MODEL` | 기본 `claude-opus-5-5` |

거절(refusal) 응답에 대비해 서버 측 대체 모델(`fallbacks: "default"`)이 켜져 있습니다.

## 다음 단계

1. 로컬 UI (`safescan run` → `http://localhost:3000`) — 모듈 토글, 실행 스텝퍼, 투명성 콘솔, 텔레메트리
2. AI 모듈 자동 추천 (프로젝트 profile + module.json 설명 기반)
3. 칸반 이슈 관리 · 스레드형 이력 (Finding fingerprint 기반)
4. AI 수정 요청 · Diff 리뷰 · 자동 재검증

## 라이선스

[MIT](LICENSE)
