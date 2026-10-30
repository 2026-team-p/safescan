# AGENTS.md

AI 코딩 에이전트(Claude Code, Codex 등)를 위한 안내입니다. 사람이 읽어도 됩니다.

SafeScan 은 웹 개발자를 위한 보안 검사 프레임워크입니다. 검사 기능은 모두 `modules/<id>/` 의 모듈이고,
모듈은 **전처리 → 툴 → 후처리 → 검증** 4단계 계약(`src/sdk/types.d.ts`)을 따릅니다.

## 설치 · 실행

요구 사항: Node.js 20.12 이상 (빌드 단계 없음, 순수 ESM JavaScript)

```bash
npm install
node bin/safescan.js help            # 또는 npm link 후 safescan help
node bin/safescan.js scan <프로젝트 경로>
npm test
```

사용자가 "이 저장소를 설치해 줘 / 준비해 줘"라고 하면: `npm install` → `npm test` → `node bin/safescan.js check` 를 실행하고 결과를 알려 주세요.
`npx safescan` 은 쓰지 마세요 — 같은 이름의 다른 npm 패키지를 내려받을 수 있습니다.

## 저장소 구조

```
bin/safescan.js        CLI 진입점
src/sdk/               모듈이 import 하는 공개 API (defineModule, 상수, 타입 계약)
src/core/              러너 · 레지스트리 · ctx · 실행기 · AI 계측 · 벤치  ← 코어
src/cli/               터미널 명령과 출력
modules/_template/     safescan new 가 복사하는 템플릿
modules/<id>/          검사 모듈 (자동 등록)
docs/MODULE_GUIDE.md   모듈 작성 규칙 — 모듈 작업 전 반드시 읽기
test/                  node:test 테스트
```

## 모듈 하나를 맡았을 때

1. `docs/MODULE_GUIDE.md` 와 `modules/npm-audit/` 를 먼저 읽습니다.
2. `node bin/safescan.js new <id> --name "<한국어 이름>" --category <분류>` 로 폴더를 만듭니다.
3. `module.json` → `index.js` → `fixtures/` → `README.md` 순서로 채웁니다.
4. 완료 기준:
   - `node bin/safescan.js check <id>` 통과, TODO 경고 없음
   - `node bin/safescan.js bench <id>` 가 status ok (도구가 설치되어 있지 않으면 사용자에게 설치를 요청)
   - `npm test` 통과
5. **`modules/<id>/` 밖의 파일은 수정하지 않습니다.** 여러 에이전트가 동시에 다른 모듈을 만들고 있을 수 있습니다.
   코어(`src/`) 변경이 필요하면 모듈 README 의 "코어 변경 요청"에 적고 사용자에게 알립니다.
6. npm 의존성을 추가하지 않습니다. 외부 도구는 `requires` 에 적고 `ctx.exec` 로 실행합니다.

## 코어를 고칠 때

- `src/sdk/types.d.ts` 는 모든 모듈의 계약입니다. 바꾸면 모든 모듈과 `docs/MODULE_GUIDE.md` 를 함께 고쳐야 합니다.
- 러너 이벤트(`RunEvent`)는 CLI 와 앞으로 만들 로컬 UI 가 함께 구독합니다. 이벤트 형태를 바꿀 때는 두 쪽을 모두 고려합니다.
- 변경 후 `npm test` 와 `node bin/safescan.js check` 를 실행합니다.

## 코드 스타일

- ESM, Node 내장 모듈 우선, 빌드 · 트랜스파일 없음
- 타입은 JSDoc + `src/sdk/types.d.ts` (에디터 검사용 `jsconfig.json`)
- 사용자에게 보이는 문구와 주석은 한국어, 식별자는 영어
- 외부 명령은 셸 문자열이 아니라 인자 배열로 실행
