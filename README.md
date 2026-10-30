# SafeScan

웹 개발자를 위한 오픈소스 보안 검사 프레임워크.
검증된 보안 도구(npm audit, Semgrep, ZAP …)를 **모듈**로 감싸 같은 형식의 결과로 모으고,
각 단계의 시간 · AI 비용 · 정확도를 기록해 효율을 비교합니다.

## 빠른 시작

```bash
git clone https://github.com/2026-team-p/safescan.git && cd safescan
npm install                   # 의존성 설치 + 로컬 UI 빌드
npm link                      # (선택) 어디서나 safescan 명령 사용
safescan run ../my-web-app    # → http://localhost:3000  (npm link 없이: npm start -- ../my-web-app)
```

| 명령 | 설명 |
|---|---|
| `safescan run [경로] [-p 3000]` | 로컬 UI 실행 — 모듈 선택 · 실행 모니터링 · 이슈 칸반 · AI 수정 요청 |
| `safescan list [경로]` | 모듈 목록, 경로를 주면 적용 여부 표시 |
| `safescan scan [경로]` | 프로젝트에 맞는 모듈을 골라 검사 (`-m a,b`, `--all`, `-o 모듈.키=값`, `--json`) |
| `safescan issues [경로]` | 쌓인 이슈를 발견됨 · 해결 중 · 조치 완료로 보기 (`--all`, `--show <id>` 로 타임라인) |
| `safescan new <id>` | 템플릿으로 새 모듈 만들기 |
| `safescan check [id…]` | 모듈 계약 검사 |
| `safescan bench [id…]` | 예제 프로젝트로 정확도 측정 · 기록 |

검사 결과는 대상 프로젝트의 `.safescan/runs/<runId>/` 에 `run.json`, `events.jsonl` 로 저장되고,
결과는 `.safescan/issues.json` 의 **이슈 아이템**으로 이어집니다. 같은 문제는 재검사해도 같은 이슈에 기록이 쌓이고
(발견 → 변경 → 조치 완료 → 재발견), 연결된 결과(예: 한 패키지의 보안 권고 여러 건)는 이슈 하나로 묶입니다.

모듈별로 필요한 외부 도구가 다릅니다 (`npm-audit` → npm, `gitleaks` → [Gitleaks](https://github.com/gitleaks/gitleaks)).
도구가 없으면 해당 모듈은 설치 안내와 함께 건너뜁니다.

## Claude 에 연결하기 (API 키 없이)

SafeScan 을 실행 중인 Claude Code 에 MCP 서버로 붙이면, 화면의 AI 기능(✨ 자동 세팅, 🪄 수정안)을 **연결된 Claude 세션이 처리**합니다.
별도 API 키 · 과금 없이 사용자의 Claude 로그인으로 동작하고, Claude 가 프로젝트 파일을 직접 읽으며 판단합니다.

```bash
safescan setup --apply      # Claude Code 에 등록 (claude mcp add --scope user safescan …), 한 번만
```

| 환경 | 시작 | 화면 버튼을 누르면 |
|---|---|---|
| 터미널 Claude Code | `claude --dangerously-load-development-channels server:safescan` | 채널 알림으로 세션이 **바로** 작업 (연구 미리보기 기능) |
| 데스크톱 앱 Code 탭 · Codex | 평소처럼 | 작업이 대기열에 들어가고, 채팅에 "SafeScan 요청 처리해 줘"라고 하면 처리 |

- Claude 에게 "SafeScan 열어 줘"라고 하면 화면이 열립니다 (`open_ui`). Claude 를 켜면 화면 서버도 함께 켜지고, 끄면 함께 꺼집니다.
- Claude 는 수정안을 **제출만** 합니다. 파일은 화면에서 비교 후 Accept 할 때만 바뀌고, 바로 재검사합니다.
- 채널 알림에는 작업 번호만 담고, 이슈 · 코드 내용은 Claude 가 도구로 가져가며 "데이터"로 표시됩니다 (검사 대상 코드에 숨은 문장이 지시로 읽히는 것을 막기 위해).
- Claude 세션 안에서 쓴 토큰은 SafeScan 이 셀 수 없어, 텔레메트리에는 비용 대신 "구독"과 걸린 시간이 표시됩니다.
- 채널이 연결되지 않으면 `MCP_PROTOCOL_NEGOTIATION=legacy` 로 Claude Code 를 실행해 보세요. Team · Enterprise 계정은 관리자가 채널을 허용해야 합니다.

## 로컬 UI (`safescan run`)

| 화면 | 하는 일 |
|---|---|
| 첫 진입 | 프로젝트(package.json · pom.xml 등)와 설치된 보안 도구를 분석하는 동안 뼈대 화면 표시 |
| 검사 설정 | 감지한 스택(언어 · 프레임워크 · 패키지 매니저 · 주요 파일) 표시 · ✨ **자동 세팅**: AI(키가 없으면 규칙)가 모듈을 고르고 판단 근거를 말풍선으로 보여 줌 · 모듈 검색 · 필터(적용 대상 · 실행 가능 · 선택됨 · 분류) · 모듈별 토글, ⚙ **옵션**(모듈 특성에 맞춘 입력 칸, 필수 값이 비면 검사 전에 알림), **검증 기준**(신뢰도 기준 · 벤치 목표와 최근 결과) · ▶ 검사 시작 버튼 |
| 실행 | 모듈마다 전처리 → 툴 → 후처리 → 검증 스텝퍼, 실제 도구 로그가 흐르는 투명성 콘솔, 우측 상단 AI 비용 · 소요 시간 · 신뢰도. 끝나면 **검사 수치**(평균 신뢰도 · 정확도 · 발견 · 시간 · 사용한 AI 모델)와 모듈별 표. 카드를 누르면 단계별 결과 · 정확도(맞힘 · 오탐 · 놓침) · 신뢰도 분포 · 사용한 옵션 · AI 호출 · 자체 점검 · 실행한 명령 · 발견 목록 · 로그를 펼쳐 봄 |
| 기록 | 지난 검사마다 신뢰도 · 정확도 · 발견 수(직전 대비 증감) · AI 모델 · 토큰 · 비용 · 시간을 한 줄로 비교, 누르면 모듈별 수치와 단계 · 로그 다시 보기. AI 작업(모듈 추천 · 수정안)은 처리 방식 · 모델별로 요청 수 · 적용 · 재검사 통과율 · 비용을 모아 보여 줌 |
| 이슈 | 👀 발견됨 → 🛠️ 해결 중 → ✅ 조치 완료 칸반 (끌어서 옮기기), 카드를 누르면 오른쪽에 타임라인(스레드). ↻ **다시 검사**: 열린 이슈를 낸 모듈만 다시 실행 |
| 설정 | 🌐 언어(한국어 · English · 日本語 · Español · 简体中文), 화면 모드(시스템 · 밝게 · 어둡게) — 브라우저에 저장 |
| AI 수정 | 🪄 수정안 요청 + 옵션 칩(안정성 · 성능 · 구조 유지 · 주석) → 기존/제안 코드 나란히 비교 → Accept 하면 파일 적용 · 해결 중 이동 · 해당 모듈 자동 재검사 → 사라지면 조치 완료 |

- 서버는 `127.0.0.1` 에만 열리고, 다른 사이트가 브라우저를 통해 검사 · 파일 수정을 일으키지 못하도록 Host · Origin 을 확인합니다.
- AI 수정 요청은 해당 파일 내용을 AI 로 보냅니다. 비밀 값 모듈(`gitleaks` 등)의 이슈라면 발견된 줄의 문자열을 가린 뒤 보내고, 제안을 받은 뒤 원래 값으로 되돌립니다.
- 의존성 이슈(`npm-audit`)는 AI 수정 대신 패키지 매니저(`npm audit fix`)로 해결하도록 안내합니다.
- 화면에서 바꾼 모듈 옵션은 `<프로젝트>/.safescan/settings.json` 에 저장되어 CLI · Claude 의 검사에도 쓰입니다. CLI 의 `-o 모듈.키=값` 이 우선합니다.
- **정확도**: 정답을 아는 예제 프로젝트는 루트에 `safescan.expected.json` 정답표를 두면 검사마다 그 검사의 정밀도 · 재현율 · F1 을 잽니다 (형식은 [모듈 작성 가이드](docs/MODULE_GUIDE.md) §7). 정답표가 없으면 모듈 버전별 최근 벤치(`safescan bench`) 결과를 보여 줍니다.
- 검사 기록은 `.safescan/runs/<id>/`, AI 작업 기록은 `.safescan/ai-jobs.jsonl` 에 쌓입니다.
- UI 를 고칠 때: `npm run dev:ui`(5173, 바로 반영) 와 `safescan run`(3000, API) 을 함께 띄웁니다.

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

UI 의 AI 작업은 **연결된 Claude 세션 → API 키 → 규칙** 순서로 처리합니다. 위의 Claude 연결을 쓰면 아래 설정은 필요 없습니다.
아무것도 없어도 AI 없는 모듈은 그대로 동작하고, 자동 세팅은 규칙 기반으로 동작합니다.
`ANTHROPIC_API_KEY` 는 `safescan run` 으로 띄운 화면과, AI 를 쓰는 모듈(`ai: optional | required`)에 쓰입니다.

| 환경 변수 | 설명 |
|---|---|
| `ANTHROPIC_API_KEY` | 있으면 Claude 사용 |
| `SAFESCAN_AI_PROVIDER` | `anthropic` · `mock` · `none` |
| `SAFESCAN_AI_MODEL` | 기본 `claude-opus-5-5` |

거절(refusal) 응답에 대비해 서버 측 대체 모델(`fallbacks: "default"`)이 켜져 있습니다.

## 다음 단계

1. 모듈 확충 — [`docs/MODULE_BACKLOG.md`](docs/MODULE_BACKLOG.md) (Semgrep, OSV-Scanner, ZAP …)
2. AI 수정안의 성공률(재검사 통과율) · 비용을 벤치처럼 기록해 모델 · 옵션별로 비교
3. UI 에서 모듈 옵션(`module.json` 의 `options`) 바꾸기, 지난 검사 기록 비교 화면
4. 여러 파일에 걸친 수정안

## 라이선스

[MIT](LICENSE)
