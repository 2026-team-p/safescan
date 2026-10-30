# 예외 처리 결함 정적 분석 (`semgrep-exception`)

## 무엇을 찾나요
JavaScript · TypeScript · Python · Java 소스에서 오류를 잘못 다루는 패턴.
OWASP A10:2025 (Mishandling of Exceptional Conditions).

| 분류 | CWE | 대상 |
|---|---|---|
| 빈 catch / except | CWE-390 | `catch (e) {}`, `except: pass`, Java 빈 `catch` |
| 스택 트레이스 노출 | CWE-209 | `res.send(err.stack)`, `return traceback.format_exc()`, Java `printStackTrace()` |
| 오류 시 허용 (fail-open) | CWE-636 | 이름에 auth · verify · valid · permi · allow · check · login · token 이 들어간 함수가 `catch` 에서 `true` 를 돌려줌 |

인젝션 계열(SQLi · XSS 등)은 `semgrep-injection` 모듈 담당이라 여기서 다루지 않습니다.

## 핵심 도구
- [Semgrep CE](https://semgrep.dev/docs/) (LGPL-2.1) — 설치: `pip install semgrep`
- 규칙은 [`rules/exception.yml`](./rules/exception.yml) 에 **고정**되어 있어 네트워크 없이 같은 결과가 나옵니다 (`--metrics=off`).

## 단계별 동작
| 단계 | 하는 일 | AI |
|---|---|---|
| 전처리 | `findFiles` 로 소스 파일 수집 (`.safescanignore` 적용). 없으면 건너뜀 | 없음 |
| 툴 | 파일을 100개씩 나눠 `semgrep scan --json --config rules/` 실행 | - |
| 후처리 | 결과 1건 = Finding 1건. 코드 줄은 소스에서 직접 읽어 `snippet` 으로 채움 | 없음 |
| 검증 | Semgrep 오류 0건인지, 원본 결과 수와 Finding 수가 같은지 확인 | 없음 |

## 위험도 매핑
| Semgrep | SafeScan | 해당 규칙 |
|---|---|---|
| ERROR | `high` | fail-open |
| WARNING | `medium` | 스택 트레이스 응답 노출 |
| INFO | `low` | 빈 catch, `printStackTrace()` |

가이드의 "빈 catch 는 `low`" 기준을 따랐고, 이 모듈은 `critical` 을 내지 않습니다.

## 신뢰도 기준
규칙 `metadata.confidence` 를 옮깁니다: HIGH 0.85 · MEDIUM 0.6 · LOW 0.4 (없으면 0.5).
- HIGH: 코드 모양만으로 확정되는 패턴 (빈 catch, 스택을 응답에 넣기)
- MEDIUM: fail-open — 함수 **이름**으로 인증 · 검증 함수를 추정하므로 오탐이 있을 수 있음

## 한계
- fail-open 은 함수 이름 추정입니다. 이름이 다른 인증 함수는 놓치고, `checkout()` 처럼 이름만 비슷한 함수는 오탐일 수 있습니다.
- 일반 `function` 선언과 메서드만 봅니다. 화살표 함수에 할당된 함수는 놓칠 수 있습니다.
- 스택 트레이스 노출은 직접 응답에 넣는 경우만 잡습니다. 변수에 담았다가 내보내면 놓칩니다.
- 빈 catch 중 의도적으로 무시하는 경우(예: 정리 코드)도 잡히므로 `low` 로 둡니다.
- Windows 에서는 Semgrep 설치가 어려울 수 있습니다 (WSL · Docker 권장).

## 코어 변경 요청
없음. (스캔 결과가 대상 프로젝트 안에 `.safescan/` 으로 저장되는 점은 `semgrep-injection` README 의 요청을 참고)

## 벤치
`fixtures/vulnerable` 에 JS · Python · Java 결함 9건과, 같은 파일의 안전한 코드(로그 남기기 · 일반 메시지 · 오류 시 거부)를 두었습니다.
`allowExtra: false` 라서 안전한 코드를 잡으면 오탐으로 계산됩니다.
