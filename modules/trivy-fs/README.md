# trivy-fs

SafeScan 모듈: Trivy 0.76.1 Docker 이미지로 프로젝트 파일시스템을 검사합니다.
lockfile 의 알려진 의존성 취약점, Dockerfile · IaC 설정 오류, 비밀 값 노출을 한 번에 봅니다.

## 단계
- preprocess: 옵션 확인(검사 항목 · 위험도를 하나도 고르지 않으면 건너뜀), `ctx.project.findFiles()`로 파일 존재 확인
- tool: `ctx.exec('docker', [...])`로 Trivy `fs --format json` 실행, 원본 JSON 파싱
- postprocess: 취약점·설정 오류·비밀정보 탐지 항목별 `Finding[]` 변환. `.safescanignore` · 기본 제외 폴더(`node_modules` 등)에 있는 대상의 결과는 뺌
- verify: 원본 탐지 개수 = Finding 개수 + 제외 경로 개수 인지 비교

## 옵션
| 키 | 타입 | 기본 | 설명 |
|---|---|---|---|
| `scanners` | multi `vuln` · `misconfig` · `secret` | 모두 | 검사 항목 (`--scanners`). 하나도 고르지 않으면 건너뜀. 0.1.0 의 `scannerSet`(enum) 을 대신합니다 |
| `severity` | multi `low` · `medium` · `high` · `critical` | 모두 | 보고할 위험도 (`--severity`). `low` 는 Trivy 의 `LOW` 와 `UNKNOWN` 을 함께 고릅니다 |
| `ignoreUnfixed` | boolean | false | 수정 버전이 없는 의존성 취약점 제외 (`--ignore-unfixed`) |
| `skipDbUpdate` | boolean (고급) | false | 받아 둔 취약점 DB · 설정 규칙으로 바로 검사 (`--skip-db-update --skip-java-db-update --skip-check-update`). 오프라인용이며, 받아 둔 DB 가 없으면 실패합니다 |

```powershell
node .\bin\safescan.js scan C:\path\to\backend -m trivy-fs -o trivy-fs.scanners=vuln -o trivy-fs.severity=high,critical -o trivy-fs.ignoreUnfixed=true
```

## 취약점 DB 캐시
Trivy 의 캐시 폴더(`/root/.cache/trivy`)를 이름 있는 Docker 볼륨 `safescan-trivy-cache` 에 붙입니다.
첫 검사에서 취약점 DB 를 내려받고, 그다음부터는 DB 에 적힌 다음 업데이트 시각(받은 DB 기준 하루 뒤)이 지났을 때만 다시 받습니다.
같은 예제에서 첫 실행 약 16초 → 다음 실행 약 2초(도커 시작 포함)였습니다.
캐시를 지우려면 `docker volume rm safescan-trivy-cache` 를 실행하세요.

## 검사·결과
SafeScan CLI의 `scan --json` 결과는 별도 파일로 저장할 수 있습니다.

```powershell
node .\bin\safescan.js scan C:\path\to\backend -m trivy-fs --json > backend-safescan.json
```

Docker Desktop이 실행 중이어야 합니다. Trivy 이미지가 처음 실행되는 경우 자동 다운로드됩니다.

## 위험도 매핑
CRITICAL → critical, HIGH → high, MEDIUM → medium, LOW/UNKNOWN → low.

## 신뢰도
의존성 DB 일치 0.9, 설정 규칙 0.8, 비밀정보 패턴 0.6. 실제 도달 가능성과 악용 가능성은 확인하지 않습니다.
`module.json` 의 `criteria.confidence` 가 같은 구간입니다.

## 벤치
`fixtures/vulnerable/Dockerfile` 에 non-root `USER` 가 없는 Dockerfile 을 두었습니다 (`DS-0002`). 규칙이 늘어날 수 있어 `allowExtra: true` 로 재현율만 봅니다.

| 버전 | 재현율 | 시간 |
|---|---|---|
| 0.1.0 | 100% (TP 1) | 21.8s (매번 DB 내려받음) |
| 0.2.0 | 100% (TP 1) | 6.9s (캐시 볼륨 사용) |

`criteria.accuracy` 목표는 재현율 0.9 입니다.

## 한계 및 주의
- Trivy 는 폴더 전체를 훑은 뒤 결과에서만 `.safescanignore` · 기본 제외 폴더를 거릅니다. 검사 시간은 줄지 않습니다.
- `node_modules`, `.env`, 개인 비밀키 등을 포함한 경로를 스캔할 때 민감 데이터가 원본에 노출되지 않도록 검사 범위를 관리하세요.
- JSON Finding에는 탐지된 비밀 원문을 넣지 않습니다.
- Docker 이미지 태그를 고정하였으나 DB는 업데이트에 따라 결과가 달라질 수 있습니다.
- 이 모듈은 원본 Trivy 보고서 자체를 별도 파일로 저장하지 않으며 SafeScan 표준 JSON 결과로 저장합니다.
- 0.1.0 에서 저장한 `scannerSet` 옵션은 더 이상 쓰지 않습니다. 저장된 설정에 남아 있으면 코어가 버리고 기본값(모두)으로 검사합니다.
