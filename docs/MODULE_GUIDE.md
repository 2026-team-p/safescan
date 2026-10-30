# 모듈 작성 가이드

SafeScan 의 모든 검사 기능은 **모듈**입니다. 모듈은 `modules/<id>/` 폴더 하나로 끝나고,
정해진 계약만 지키면 CLI · 로컬 UI · AI 추천 · 검증 기록에 자동으로 연결됩니다.

- 계약 원문: [`src/sdk/types.d.ts`](../src/sdk/types.d.ts)
- 기준 예시: [`modules/npm-audit/`](../modules/npm-audit/) (lockfile 기반), [`modules/gitleaks/`](../modules/gitleaks/) (폴더를 스스로 훑는 도구 · 비밀 값 가리기)
- 만들 모듈 후보: [`MODULE_BACKLOG.md`](./MODULE_BACKLOG.md)

---

## 1. 한눈에 보기

```
            ┌──────────── modules/<id>/index.js ────────────┐
 프로젝트 → │ preprocess → tool → postprocess → verify       │ → Finding[] + 기록
            └──────┬─────────┬──────────┬───────────┬────────┘
                   │ ctx.project · ctx.exec · ctx.ai · ctx.log
            ┌──────┴────────────────────────────────────────┐
            │ 러너: 시간 · 토큰 · 비용 · 도구 버전 자동 기록, │
            │ 이벤트 발행(스텝퍼 · 투명성 콘솔 · 텔레메트리) │
            └───────────────────────────────────────────────┘
```

| 단계 | 하는 일 | 돌려주는 값 |
|---|---|---|
| **전처리** `preprocess(ctx)` | 소스에서 도구에 필요한 정보를 모은다. 대상이 없으면 `ctx.skip()` | 도구 입력 (자유 형식) |
| **툴** `tool(ctx, input)` | 공개 · 검증된 도구를 `ctx.exec` 로 실행한다 | 도구 결과 원본 |
| **후처리** `postprocess(ctx, raw, input)` | 원본을 표준 `Finding[]` 으로 바꾼다 | `Finding[]` |
| **검증** `verify(ctx, { input, raw, findings })` *(선택)* | 결과를 스스로 점검한다 | `VerifyReport` |

검증 단계의 **시간 · AI 토큰 · 비용 · 도구 버전 기록은 프레임워크가 자동으로** 합니다.
모듈의 `verify` 는 "결과가 말이 되는지" 스스로 확인하는 일만 하면 됩니다.

---

## 2. 폴더 구조

```
modules/<id>/
├─ module.json              정적 정보 (코드 실행 없이 UI · AI 추천에 쓰임)
├─ index.js                 4단계 구현 — export default defineModule({...})
├─ README.md                무엇을 · 어떻게 · 한계
├─ fixtures/
│  ├─ vulnerable/           취약점을 심어 둔 작은 예제 프로젝트
│  └─ expected.json         그 예제에서 반드시 찾아야 하는 결과
└─ (선택) rules/ 등          도구에 넘길 규칙 파일. ctx.module.dir 로 경로를 얻습니다
```

- `modules/` 아래 폴더는 **자동으로 등록**됩니다. 중앙 목록 파일은 없습니다.
- `_` 로 시작하는 폴더(`_template`)는 무시됩니다.
- 새 모듈은 직접 만들지 말고 `safescan new <id> --category <분류>` 로 만드세요.

---

## 3. module.json

| 필드 | 필수 | 설명 |
|---|---|---|
| `id` | ✓ | kebab-case, **폴더 이름과 같아야 함**. 이름 규칙: `<도구>-<대상>` (예: `semgrep-xss`, `gitleaks`) |
| `name` | ✓ | UI 에 보일 한국어 이름 |
| `version` | ✓ | semver. 동작이 바뀌면 올립니다 (벤치 기록이 버전별로 비교됨) |
| `description` | ✓ | 무엇을 찾는지 한두 문장. **AI 자동 추천의 근거**가 되므로 구체적으로 |
| `category` | ✓ | `sast` `dast` `dependency` `secrets` `config` `iac` `container` `other` |
| `tool` | ✓ | `{ name, homepage, license? }` 툴 단계의 핵심 도구 |
| `owasp` | | `["A05:2025"]` — OWASP Top 10:2025 분류 |
| `cwe` | | `["CWE-79"]` |
| `status` | | `experimental`(기본) → 벤치가 안정되면 `stable` |
| `requires` | | `[{ bin, versionArgs?, install }]` 필요한 실행 파일. 없으면 설치 안내와 함께 **자동으로 건너뜀**. 확인한 버전은 기록에 남음 |
| `appliesWhen` | | `{ files: ["package.json", "*.py"] }` 이 중 하나라도 있으면 적용 대상. 생략하면 항상 적용 |
| `ai` | | `none`(기본) · `optional` · `required` — §6 참고 |
| `options` | | 검사 설정 화면에서 바꿀 수 있는 옵션 — 아래 참고 |
| `timeoutSec` | | 모듈 전체 제한 시간. 기본 300 |
| `criteria` | | 이 모듈의 수치 기준. UI 의 "검증 기준" 패널에 그대로 보임 — 아래 참고 |
| `i18n` | | 다른 언어 화면용 이름 · 설명 · 기준 이름. `{ "en": { name, description, criteria: [...] } }` — 아래 참고 |

### 옵션 (`options`)

검사 설정 화면은 모듈마다 옵션을 입력 칸으로 보여 줍니다. 사용자가 고른 값은 프로젝트의 `.safescan/settings.json` 에 저장되고,
화면 · CLI(`safescan scan`) · Claude(`run_scan`) · 수정 후 재검사가 모두 같은 값을 씁니다. CLI 의 `-o 모듈.키=값` 은 저장된 값보다 우선합니다.
모듈 코드에서는 `ctx.options.키` 로 읽습니다 (기본값이 채워진 상태).

| 필드 | 설명 |
|---|---|
| `type` | `boolean` 켜기/끄기 · `enum` 하나 고르기 · `multi` 여러 개 고르기(값은 배열) · `number` · `string` |
| `label` · `description` | 화면에 보일 이름과 한 줄 설명 (한국어). 다른 언어는 `i18n.<언어>.options.<키>` |
| `default` | 기본값. **기본값으로 돌렸을 때 지금까지와 똑같이 동작**해야 벤치 결과가 흔들리지 않습니다 |
| `choices` · `choiceLabels` | enum · multi 의 선택지와 화면 이름. 예: `{ "baseline": "기본 (요청만 관찰)" }` |
| `min` · `max` · `step` · `unit` | number 의 범위와 단위. 범위를 벗어나면 화면 · 서버가 받지 않습니다 |
| `placeholder` · `format` | string 의 입력 예시. `format: "url"` 이면 http(s) 주소만 받습니다 (빈 값은 허용) |
| `required` | 비어 있으면 모듈이 건너뛰는 옵션 (예: 동적 검사의 서버 주소). 화면이 검사 전에 알려 줍니다 |
| `when` | 다른 옵션이 이 값일 때만 보입니다. 예: `{ "mode": "full" }` |
| `advanced` | 자주 바꾸지 않는 옵션. 화면에서 "고급" 아래에 접어 둡니다 |

```json
"options": {
  "url": { "type": "string", "label": "검사할 서버 주소", "format": "url", "required": true, "placeholder": "http://localhost:3000" },
  "severity": { "type": "multi", "label": "검사할 위험도", "choices": ["low", "medium", "high", "critical"], "default": ["medium", "high", "critical"],
                "choiceLabels": { "low": "낮음", "medium": "보통", "high": "높음", "critical": "치명적" } },
  "mode": { "type": "enum", "label": "검사 방식", "choices": ["baseline", "full"], "default": "baseline" },
  "confirmActive": { "type": "boolean", "label": "공격 요청 보내기 승인", "default": false, "when": { "mode": "full" } },
  "minutes": { "type": "number", "label": "탐색 시간", "default": 2, "min": 1, "max": 30, "unit": "분", "advanced": true }
}
```

옵션은 그 모듈의 도구와 사용자에게 의미 있는 것만 둡니다. 도구 인자를 그대로 늘어놓지 말고, "무엇을 검사할지 · 얼마나 깊게 · 무엇을 뺄지" 를 사용자 말로 고르게 하세요.

### 검증 기준 (`criteria`)

신뢰도를 어떤 근거로 몇으로 매기는지(§5), 벤치에서 정밀도 · 재현율이 얼마 이상이어야 하는지(§7)를 적습니다.
UI 는 모듈마다 이 값을 보여 주고, 최근 벤치 결과와 비교해 통과 · 미달 · 측정 안 됨을 표시합니다.

```json
"criteria": {
  "confidence": [
    { "min": 0.85, "label": "형식이 정해진 규칙", "description": "JWT · 개인 키처럼 모양이 정해진 값" },
    { "min": 0.55, "label": "일반 키 (추정)", "description": "오탐 가능성 있음" }
  ],
  "accuracy": { "precision": 0.9, "recall": 0.7 }
}
```

- `confidence` — 높은 값부터 적습니다. `min` 은 0~1, 코드가 실제로 매기는 값과 맞아야 합니다.
- `accuracy` — 벤치 목표. `allowExtra: true` 라 정밀도를 잴 수 없으면 `recall` 만 적습니다.

### 다른 언어 (`i18n`)

UI 는 한국어(기본) · English · 日本語 · Español · 简体中文 을 지원합니다. `name` · `description` · `criteria[].label` 을 언어별로 적으면 그 언어 화면에서 바꿔 보여 주고, 빠진 항목은 한국어 값을 씁니다.
`criteria` 배열은 `criteria.confidence` 와 **같은 순서**로 적습니다. 언어 코드는 `en` `ja` `es` `zh` 입니다.

```json
"i18n": {
  "en": { "name": "Hardcoded secrets", "description": "Finds API keys …", "criteria": ["Fixed-format rule", "Generic key (heuristic)"] }
}
```

Finding 제목 · 로그 · 건너뛴 이유처럼 모듈 코드가 만드는 문장은 번역되지 않습니다. 한국어로 적습니다.

OWASP Top 10:2025 — A01 Broken Access Control · A02 Security Misconfiguration · A03 Software Supply Chain Failures ·
A04 Cryptographic Failures · A05 Injection · A06 Insecure Design · A07 Authentication Failures ·
A08 Software or Data Integrity Failures · A09 Security Logging and Alerting Failures · A10 Mishandling of Exceptional Conditions

---

## 4. 단계별 규칙

### 전처리
- 프로젝트 파일은 **`ctx.project` 로만** 읽습니다 (`findFiles`, `readText`, `exists`). `node:fs` 로 프로젝트를 직접 읽지 마세요 — 프로젝트 밖 접근이 막혀 있습니다.
- 검사 대상은 `ctx.project.findFiles` 로 찾습니다. 사용자가 `.safescanignore` 에 적은 경로가 자동으로 빠지므로 모듈이 따로 처리할 필요가 없습니다.
  도구가 폴더 전체를 스스로 훑는 경우(예: `semgrep scan .`, `gitleaks dir .`)에는 제외 규칙이 적용되지 않으니,
  `findFiles` 로 얻은 파일 목록을 도구에 넘기거나, 후처리에서 `ctx.project.isIgnored(파일)` 로 결과를 거르세요 (예: `modules/gitleaks`).
- 도구 결과에 없는 정보(설치 버전, 줄 번호, 프레임워크 종류 등)는 여기서 미리 뽑아 두세요.
- 검사할 대상이 없으면 `ctx.skip('이유')` — 실패가 아니라 '건너뜀'으로 기록됩니다.

### 툴
- 외부 도구는 **`ctx.exec(cmd, args, opts)` 로만** 실행합니다. 출력이 투명성 콘솔로 흐르고, 시간 · 종료 코드가 기록되며, 제한 시간이 지나면 자동으로 종료됩니다.
- 셸 문자열을 만들지 마세요. 인자는 배열로 넘깁니다 (`ctx.exec('semgrep', ['scan', '--json', '.'])`).
- 결과가 큰 JSON 이면 `{ quiet: true }` 로 콘솔 출력을 끕니다.
- 취약점이 있을 때 0 이 아닌 코드로 끝나는 도구는 `okExitCodes: [0, 1]` 처럼 지정합니다.
- 결과는 **가공하지 말고 원본 그대로** 돌려줍니다. 가공은 후처리의 일입니다.
- 도구 설정 파일 · 규칙 파일은 모듈 폴더 안에 두고 `ctx.module.dir` 로 경로를 만듭니다. 임시 파일은 `ctx.tmpDir` 에 씁니다.

### 후처리
- 결과 1건 = `Finding` 1개. 필수 필드: `ruleId`, `title`, `severity`, `confidence`.
- `location.file` 은 **프로젝트 루트 기준 상대 경로, `/` 구분**입니다. 절대 경로 · `\` 는 거부됩니다.
- 형식이 틀린 Finding 은 일반 검사에서는 버려지고(경고), `check` · `bench` 에서는 모듈 실패가 됩니다.

### 검증 (선택)
- 도구 원본과 결과를 비교해 빠진 것이 없는지, 숫자가 맞는지 확인합니다 → `checks`.
- 모듈 전체 신뢰도를 따로 판단할 수 있으면 `confidence` 로 돌려줍니다. 생략하면 Finding 평균을 씁니다.
- 한계는 `notes` 에 적습니다 (예: "도달 가능성은 확인하지 않음").

---

## 5. Finding 작성 기준

### 위험도 (severity)

| 값 | UI | 기준 | 예 |
|---|---|---|---|
| `critical` | 🔴 크리티컬 | 당장 서버가 뚫릴 수 있는 치명적 결함 | 원격 코드 실행, 인증 우회, SQL 인젝션 |
| `high` | 🟠 위험 | 데이터 유출로 이어질 수 있음 | 저장형 XSS, 하드코딩된 비밀 키 |
| `medium` | 🟡 주의 | 권장 보안 설정 누락 | 보안 헤더 누락, 약한 쿠키 설정 |
| `low` | 🔵 참고 | 코드 스멜 · 정보성 | 빈 catch, 디버그 로그 |

도구 자체 등급(CVSS, ERROR/WARNING 등)이 있으면 그대로 옮기되, 매핑 표를 모듈 README 에 적어 두세요.

### 신뢰도 (confidence, 0~1)

| 범위 | 의미 |
|---|---|
| 0.9 이상 | 도구가 확정적으로 확인 (권고 DB 일치, 실제 요청으로 재현) |
| 0.7 ~ 0.9 | 패턴이 정확히 일치, 맥락 일부 확인 |
| 0.4 ~ 0.7 | 휴리스틱 — 오탐 가능성 있음 |
| 0.4 미만 | 참고용 추정 (AI 단독 판단 등) |

정한 기준은 모듈 README 의 "신뢰도 기준"에 적습니다.

### fingerprint 와 group — 이슈 아이템이 되는 방식
검사 결과를 저장하면(`scan` 기본 동작) 결과가 `<프로젝트>/.safescan/issues.json` 의 **이슈 아이템**(칸반 카드 + 타임라인)으로 쌓입니다.

| 키 | 역할 | 생략하면 |
|---|---|---|
| `fingerprint` | 재검사 사이에서 **같은 결과**를 알아봄 | `moduleId · ruleId · 파일 · (의존성 이름 \| snippet \| 줄 번호)` |
| `group` | **같은 조치로 함께 해결되는 결과**를 이슈 하나(스레드 하나)로 묶음 | 의존성: `파일 + 패키지 이름`, 그 밖: fingerprint 하나당 이슈 하나 |

- 재검사에서 그룹이 그대로면 기록이 늘지 않고, 일부가 바뀌면 "변경", 모두 사라지면 "조치 완료", 다시 나타나면 "재발견"이 타임라인에 남습니다.
- 실패 · 건너뜀으로 끝난 모듈은 결과가 없어도 이슈를 조치 완료로 옮기지 않습니다.
- 줄 번호는 코드가 바뀌면 흔들립니다. 코드 위치형 결과는 `location.snippet` 을 채우거나 fingerprint 를 직접 만드세요
  (줄이 밀려도 같은 이슈로 이어지는 예: `modules/gitleaks` — 파일 + 규칙 + 가린 일치 문자열 + 순번).

---

## 6. AI 사용 규칙

- AI 는 **`ctx.ai.complete()` 로만** 호출합니다. 토큰 · 비용 · 시간 · 모델이 자동으로 기록되고, 이 기록이 검증 단계의 효율 비교에 쓰입니다. SDK 를 직접 부르면 기록이 빠집니다.
- 모든 호출에 `purpose` 를 붙이세요 (예: `'엔트리포인트 추출'`). 기록에서 어떤 호출이 비싼지 구분됩니다.
- JSON 이 필요하면 `{ json: true }` → `response.json` 으로 받습니다.
- `module.json` 의 `ai` 값:
  - `none` — AI 를 쓰지 않음
  - `optional` — `ctx.ai.available` 이 false 면 **AI 없이도 동작**해야 함 (규칙 기반 대체 경로)
  - `required` — AI 가 없으면 모듈이 건너뜀
- 핵심 판정은 **툴 단계의 검증된 도구**가 합니다. AI 는 전처리(대상 좁히기, 설정 생성)와 후처리(설명 보강, 중복 정리)를 돕는 역할입니다. AI 만으로 만든 Finding 은 confidence 0.4 미만으로 둡니다.

---

## 7. fixtures 와 벤치

`fixtures/vulnerable/` 에 **취약점을 일부러 심은 작은 프로젝트**를 두고, `fixtures/expected.json` 에 찾아야 할 결과를 적습니다.

```json
{
  "description": "심어 둔 취약점 설명",
  "allowExtra": false,
  "findings": [
    { "ruleId": "javascript.express.xss", "file": "src/app.js", "line": 12, "severity": "high" }
  ]
}
```

- 매칭 키: `ruleId` `file` `line`(±2줄) `severity` `dependency`(패키지 이름). 적은 키만 비교합니다.
- `allowExtra: false` — 목록에 없는 결과는 오탐(FP)으로 셉니다 → 정밀도 계산. 가능하면 이쪽을 쓰세요.
- `allowExtra: true` — 결과가 시간에 따라 늘어나는 도구(권고 DB 등)용. 재현율만 계산합니다.
- 오탐을 잡는 예제(안전한 코드)도 함께 넣으면 정밀도가 의미를 가집니다.
- fixtures 안의 코드는 **실행되지 않는 예제**여야 합니다. 실제 비밀 값 · 실제 악성 코드는 넣지 마세요.

```bash
safescan bench <id>     # 정밀도 · 재현율 · F1 · 시간 · 비용을 .safescan/bench/<id>.jsonl 에 쌓고 직전 기록과 비교
```

일부러 문제를 심어 둔 예제 프로젝트라면, 프로젝트 루트에 같은 형식의 정답표 `safescan.expected.json` 을 모듈별로 둘 수 있습니다.
그러면 검사할 때마다 그 검사의 정확도를 재서 결과 화면 · 기록 화면 · CLI 요약에 보여 줍니다.

```json
{ "modules": { "gitleaks": { "allowExtra": false, "findings": [{ "ruleId": "jwt", "file": "scripts/seed-admin.js", "line": 5 }] } } }
```

---

## 8. 병렬 작업 규칙

여러 사람(또는 여러 AI 세션)이 동시에 모듈을 만들 수 있도록, 아래를 지킵니다.

1. **자기 모듈 폴더만 수정합니다.** `modules/<id>/` 밖의 파일은 건드리지 않습니다.
2. **`src/` (코어)는 고치지 않습니다.** 필요한 기능이 있으면 모듈 README 의 "코어 변경 요청"에 적고, 코어 PR 을 따로 엽니다.
3. **npm 의존성을 추가하지 않습니다.** 외부 도구는 실행 파일로 부르고(`requires`), 파싱 등은 Node 내장 기능으로 해결합니다.
4. 브랜치 이름은 `module/<id>`, 커밋 · PR 은 모듈 하나 단위로 만듭니다.
5. 다른 모듈의 코드를 import 하지 않습니다. 공통으로 쓰고 싶은 코드가 생기면 코어 변경 요청으로 올립니다.

---

## 9. 완료 기준

```bash
safescan check <id>     # ✓ 통과, TODO 경고 없음
safescan bench <id>     # status ok, 재현율 확인
npm test                # 모든 모듈 계약 테스트 통과
```

- [ ] `module.json` — 설명 · 도구 · requires · appliesWhen · owasp 채움, `criteria`(신뢰도 기준 · 벤치 목표) · `i18n` 적기
- [ ] 4단계 구현, 대상이 없을 때 `ctx.skip()`
- [ ] 외부 도구는 `ctx.exec`, AI 는 `ctx.ai` 로만 호출
- [ ] `fixtures/vulnerable` + `expected.json` 작성, 벤치 결과를 PR 설명에 붙임
- [ ] README — 무엇을 · 핵심 도구 · 단계별 동작 · 신뢰도 기준 · 한계
- [ ] `modules/<id>/` 밖 변경 없음

---

## 10. 자주 하는 실수

| 실수 | 바른 방법 |
|---|---|
| `child_process` 로 도구 실행 | `ctx.exec` — 기록 · 제한 시간 · Windows 호환을 함께 처리 |
| `fs.readFile(절대경로)` 로 프로젝트 읽기 | `ctx.project.readText(상대경로)` |
| `location.file` 에 절대 경로 | `path.relative` 후 `/` 로 바꾼 상대 경로 |
| 대상이 없어서 `throw` | `ctx.skip('이유')` |
| tool 단계에서 결과 가공 | 원본을 넘기고 postprocess 에서 가공 |
| `npm audit` 처럼 취약점이 있으면 종료 코드 1 인 도구에서 실패 | `okExitCodes: [0, 1]` |
| 큰 JSON 출력이 콘솔을 가득 채움 | `{ quiet: true }` |
