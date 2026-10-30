# Nuclei 웹 취약점 스캔 (`nuclei-web`)

실행 중인 웹 서버에 Nuclei 템플릿으로 요청을 보내 취약점을 찾는 DAST 모듈입니다.
유저 플로우의 "도구가 내 로컬 서버를 스캔"(6단계)과 "수정 후 다시 공격"(10단계)을 맡습니다.

## 무엇을 찾나요
- 노출된 디버그 경로 (`/debug`), 디렉터리 리스팅 (`/files/`) — 모듈 내장 템플릿
- 잘못된 서버 설정, 알려진 CVE 취약점 등 — `templates=all` 일 때 Nuclei 공개 템플릿
- OWASP Top 10:2025 — 주로 **A02 Security Misconfiguration**, 태그에 따라 A03 · A05 · A07
- 보안 헤더 · 쿠키 설정은 `http-observatory` 모듈의 영역이라 이 모듈의 내장 템플릿에는 넣지 않았습니다.

## 핵심 도구
- [Nuclei](https://github.com/projectdiscovery/nuclei) — MIT, ProjectDiscovery 가 관리하는 템플릿 기반 취약점 스캐너
- YAML 템플릿으로 검사를 정의하고 JSONL 로 결과를 내므로 기계가 읽기 좋습니다.
- 설치: `brew install nuclei` (이 모듈은 v3.11.1 에서 확인했습니다)

## 단계별 동작
| 단계 | 하는 일 | AI |
|---|---|---|
| 전처리 | `targetUrl` 확인 (없거나 localhost 가 아니면 건너뜀), 옵션 검증, 템플릿 태그 결정 | 선택 — 태그를 비워 두면 프로젝트 정보로 태그를 좁힘 |
| 툴 | `nuclei -u <주소> -jsonl -omit-raw ...` 실행, stdout(JSONL) 원본을 그대로 반환 | - |
| 후처리 | JSONL 한 줄을 `Finding` 하나로 변환 (매핑은 아래 표) | 없음 |
| 검증 | JSONL 형식 · 원본 줄 수와 결과 수 일치 · nuclei 오류 여부 확인 | 없음 |

### 안전 장치
- 기본은 `localhost` · `127.0.0.1` · `::1` 만 검사합니다. 다른 주소는 `allowRemote` 를 켜야 하며, **내가 소유했거나 검사할 권한이 있는 서버에만** 쓰세요.
- 서버를 마비시킬 수 있는 템플릿은 항상 제외합니다 (`-exclude-tags dos,fuzz,intrusive`).
- 외부 OAST 서버(interactsh)를 쓰지 않고 (`-ni`), 요청 속도를 제한합니다 (`rateLimit`, 기본 초당 50).
- 주소에 계정 정보(`user:pw@`)가 있으면 로그에 남으므로 건너뜁니다.
- `-omit-raw` 로 요청 · 응답 원문을 기록하지 않습니다. 템플릿 경로 · curl 명령도 결과에 담지 않습니다.

## 옵션
검사 설정 화면에는 앞의 세 개가 보이고, 나머지는 "고급" 아래에 있습니다.

| 키 | 타입 | 기본값 | 설명 |
|---|---|---|---|
| `targetUrl` | string (필수, url) | (없음) | 검사할 서버 주소. 없으면 모듈을 건너뜁니다 |
| `templates` | enum `bundled` · `all` | `bundled` | `bundled`: 모듈 내장 템플릿만 (오프라인 · 항상 같은 결과) / `all`: Nuclei 공개 템플릿 전체 (첫 실행 시 내려받음, 내장 템플릿은 제외) |
| `severity` | multi `info` · `low` · `medium` · `high` · `critical` | `low,medium,high,critical` | 실행할 템플릿의 위험도 (`-severity`). 하나도 고르지 않았거나 위험도 · 태그에 맞는 템플릿이 없으면(예: `bundled` 에서 `info` 만) 건너뜁니다 |
| `tags` | string (고급) | (비움) | 쉼표로 구분한 태그 (`-tags`). 비우면 AI 또는 기본값(`exposure,misconfig`) |
| `useAiTags` | boolean (고급) | `true` | 태그가 비었을 때 AI 로 태그 고르기 (AI 가 없으면 기본값) |
| `rateLimit` | number 1~1000 회 (고급) | `50` | 초당 최대 요청 수 (`-rl`) |
| `allowRemote` | boolean (고급) | `false` | localhost 밖 주소 허용 |

```bash
node bin/safescan.js scan <프로젝트 경로> -m nuclei-web -o nuclei-web.targetUrl=http://localhost:3000 -o nuclei-web.severity=high,critical
```
`severity` 는 여러 개 고르기(multi)라 CLI 에서는 쉼표로 구분합니다. 예전 설정의 쉼표 문자열도 받습니다.

## 위험도 · 필드 매핑
| nuclei | Finding |
|---|---|
| `template-id` | `ruleId` |
| `info.name` | `title` |
| `info.severity` | `severity` — critical · high · medium · low 그대로, `info` · `unknown` → `low` |
| `info.classification.cwe-id` | `cwe` (대문자 `CWE-123` 으로 변환, 형식이 다르면 버림) |
| `info.classification.cve-id` | `references` 에 NVD 링크 |
| `info.remediation` / `info.reference` | `remediation` / `references` |
| `info.tags` | `owasp` — `misconfig` `exposure` `config` `debug` `listing` `panel` → A02 · `cve` → A03 · `xss` `sqli` `injection` `ssti` `lfi` → A05 · `default-login` `auth` `token` → A07 · 해당 없으면 A02 |
| `matched-at` | `location` 이 아니라 `description` · `raw.matchedAt` (URL 은 프로젝트 파일 경로가 아님) |

**fingerprint** 는 `템플릿 ID + matcher 이름 + matched-at(쿼리 · 해시 제거)` 로 직접 만듭니다. 같은 서버를 다시 검사했을 때 같은 이슈로 이어지며, 코드를 고친 뒤 재검사(10단계)에서 사라졌는지 비교하는 기준이 됩니다.

## 신뢰도 기준
| 값 | 경우 |
|---|---|
| 0.9 | 템플릿이 응답에서 값을 추출함 (`extracted-results`) |
| 0.85 | 실제 요청에서 matcher 가 일치함 |
| 0.6 | 정보성 결과 (`info` · `unknown`) — 오탐 가능성이 더 큼 |

## 한계
- **서버가 응답한 경로만** 검사합니다. 로그인이 필요한 페이지는 검사하지 않습니다.
- `templates=bundled` 는 내장 템플릿 2개(디렉터리 리스팅, 디버그 엔드포인트)만 실행합니다. 더 넓게 보려면 `templates=all` 을 쓰세요 (첫 실행 시 공개 템플릿을 내려받으며 시간이 걸립니다. 이 경우 결과가 시간이 지나며 늘어납니다).
- 템플릿이 가리키는 경로가 서버에 없으면 취약점이 없는 것처럼 보입니다. 취약점이 없다는 증명은 아닙니다.
- `templates=all` 의 `cve` 태그 결과는 버전 · 응답 패턴으로 판단하므로 실제 악용 가능 여부는 확인하지 않습니다.
- `fixtures/vulnerable/server.js` 는 일부러 취약하게 만든 예제입니다. SafeScan 이 실행하지 않으며, 검증할 때 직접 띄웁니다 (`node server.js [포트]`, `127.0.0.1` 에만 바인딩).

## 검증 방법
```bash
# 1) 후처리 · 전처리 단위 테스트 (nuclei · 서버 불필요)
node --test modules/nuclei-web/postprocess.test.js

# 2) 실제 스캔
node modules/nuclei-web/fixtures/vulnerable/server.js 3999 &
node bin/safescan.js scan modules/nuclei-web/fixtures/vulnerable -m nuclei-web -o nuclei-web.targetUrl=http://127.0.0.1:3999 -v
```

### 정확도 (v0.2.0, nuclei 3.11.1)
`safescan bench` 는 아직 옵션을 넣지 못해 '건너뜀'으로 끝나므로, 예제 서버를 띄운 뒤 예제 폴더 복사본에 `safescan.expected.json`(내용: `{ "modules": { "nuclei-web": <fixtures/expected.json> } }`)을 두고 `scan` 으로 쟀습니다.

| 버전 | 정밀도 | 재현율 | F1 |
|---|---|---|---|
| 0.1.0 | 100% | 100% | 100% (TP 2 · FP 0 · FN 0) |
| 0.2.0 | 100% | 100% | 100% (TP 2 · FP 0 · FN 0) |

`criteria.accuracy` 목표는 정밀도 · 재현율 0.9 입니다.
`fixtures/sample-output.jsonl` 은 위 서버를 실제 nuclei 로 검사한 출력에서 절대 경로 · base64 템플릿 · curl 명령만 뺀 것입니다.

## 코어 변경 요청
1. **bench 가 예제 서버를 띄우고 `targetUrl` 을 넣어 주세요.** 지금 `safescan bench nuclei-web` 은 `targetUrl` 이 없어 '건너뜀'으로 끝납니다. 예: `fixtures/vulnerable/server.js` 가 있으면 빈 포트로 실행한 뒤 `options.targetUrl` 에 주입하고 끝나면 종료. 최소한 `bench` 에도 `-o 모듈.키=값` 을 받게 해 주세요.
2. **모듈 폴더 안의 `*.test.js` 도 `npm test` 에 포함해 주세요.** 지금 `package.json` 의 `test` 는 `test/**/*.test.js` 만 실행하므로 `modules/nuclei-web/postprocess.test.js` 는 직접 실행해야 합니다.
3. **URL 기반 결과를 위한 위치 필드가 필요합니다.** `Finding.location.file` 은 프로젝트 상대 경로만 허용하므로 DAST 결과의 URL 은 `description` · `raw.matchedAt` 에 담았습니다. UI 가 URL 을 보여 주려면 `Finding` 에 `url` 같은 필드가 필요합니다.
4. **도구 버전 기록에서 ANSI 색상 코드를 제거해 주세요.** `nuclei -version` 은 `-nc` 를 줘도 색상 코드가 섞인 문장(`[INF] Nuclei Engine Version: v3.11.1`)을 내보내서, `probeTool`(`src/core/runner.js`)이 `toolVersions` 에 그대로 저장합니다.
5. **이전 실행과의 fingerprint 비교(재검증)** 는 코어(러너 · 이슈 스레드)의 일입니다. 이 모듈은 비교에 쓸 안정적인 fingerprint 만 제공합니다.
