# 인젝션 취약점 정적 분석 (`semgrep-injection`)

## 무엇을 찾나요
JavaScript · TypeScript · Python · Java 소스에서 외부 입력이 검증 없이 위험한 함수로 들어가는 패턴.
OWASP A05:2025 (Injection).

| 분류 | CWE | 대상 |
|---|---|---|
| SQL 인젝션 | CWE-89 | JS `db.query` 등, Python `cursor.execute`, Java `Statement.execute*` 에 문자열 연결 · 포맷 |
| OS 명령 주입 | CWE-78 | JS `exec`, Python `os.system` · `subprocess(shell=True)`, Java `Runtime.exec` |
| XSS | CWE-79 | 요청 값 → `res.send` · `innerHTML` (taint), `innerHTML` 에 템플릿 · 연결 문자열 |
| 코드 주입 | CWE-95 | JS · Python 의 `eval` · `exec` · `new Function` 에 동적 값 |
| 템플릿 주입 | CWE-1336 | Flask `render_template_string` 에 연결 · 포맷 문자열 |

예외 처리 계열(빈 catch, fail-open 등)은 `semgrep-exception` 모듈 담당이라 여기서 다루지 않습니다.

## 핵심 도구
- [Semgrep CE](https://semgrep.dev/docs/) (LGPL-2.1) — 설치: `pip install semgrep`
- 규칙은 [`rules/injection.yml`](./rules/injection.yml) 에 **고정**되어 있어 네트워크 없이 같은 결과가 나옵니다 (`--metrics=off`).

## 단계별 동작
| 단계 | 하는 일 | AI |
|---|---|---|
| 전처리 | `findFiles` 로 소스 파일 수집 (`.safescanignore` 적용). 없으면 건너뜀 | 없음 |
| 툴 | 파일을 100개씩 나눠 `semgrep scan --json --config rules/` 실행 | - |
| 후처리 | 결과 1건 = Finding 1건. 규칙 메타데이터에서 CWE · OWASP · 신뢰도를 가져옴 | 없음 |
| 검증 | Semgrep 오류 0건인지, 원본 결과 수와 Finding 수가 같은지 확인 | 없음 |

## 위험도 매핑
| Semgrep | SafeScan |
|---|---|
| ERROR + CWE-89 · 78 · 95 · 1336 | `critical` |
| ERROR (그 외, 예: XSS) | `high` |
| WARNING | `medium` |
| INFO | `low` |

## 신뢰도 기준
규칙 `metadata.confidence` 를 옮깁니다: HIGH 0.85 · MEDIUM 0.6 · LOW 0.4 (없으면 0.5).
- HIGH: 위험한 함수에 연결 · 포맷 문자열이 직접 들어가는 패턴
- MEDIUM: XSS 처럼 흐름 · 맥락에 따라 오탐이 있는 규칙

## 한계
- 대부분 패턴 매칭입니다. 값이 변수를 거쳐 전달되면 놓칠 수 있습니다 (XSS 규칙만 taint 분석, 같은 파일 안에서만).
- 이미 이스케이프하는 자체 함수는 `escapeHtml`, `encodeURIComponent` 만 안전으로 인식합니다.
- 규칙이 적은 수의 대표 패턴만 다룹니다. ORM 별 raw 쿼리 API 등은 규칙을 추가해야 합니다.
- Windows 에서는 Semgrep 설치가 어려울 수 있습니다 (WSL · Docker 권장).

## 향후 개선 (보류)
- Spring · JPA 규칙 추가: `@Query` 문자열 연결, `JdbcTemplate`, `createNativeQuery` 등. 실제 Spring Boot 프로젝트(platform-server)를 스캔해 보니 현재 규칙으로는 0건이었음.
- 그 밖에 ORM 별 raw 쿼리 API 규칙, 변수를 거친 값의 흐름(taint) 확장.

## 코어 변경 요청
- `scan` 은 검사 대상 프로젝트 안에 `.safescan/runs/` 를 만듭니다. 대상 프로젝트가 팀 저장소이면 `git status` 에 잡힙니다. 저장 위치를 바꿀 수 있는 옵션이 필요합니다.
- 파일을 하나씩 나열해 넘기므로 콘솔에 찍히는 명령줄이 매우 깁니다. 긴 인자 목록을 줄여서 출력하는 방안이 필요합니다.

## 벤치
`fixtures/vulnerable` 에 JS · Python · Java 취약 코드 9건과, 같은 파일의 안전한 코드(바인딩 · 이스케이프 · 고정 명령)를 두었습니다.
`allowExtra: false` 라서 안전한 코드를 잡으면 오탐으로 계산됩니다.
