# trivy-fs

SafeScan 모듈: Trivy 0.76.1 Docker 이미지로 프로젝트 파일시스템을 검사합니다.

## 단계
- preprocess: `ctx.project.findFiles()`로 파일 존재 확인
- tool: `ctx.exec('docker', [...])`로 Trivy `fs --format json` 실행, 원본 JSON 파싱
- postprocess: 취약점·설정 오류·비밀정보 탐지 항목별 `Finding[]` 변환
- verify: 원본 탐지 개수와 Finding 개수 비교

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

## 한계 및 주의
- `.safescanignore`를 Trivy 전체 폴더 검사 옵션으로 전달하지 않아 제외 범위가 일치하지 않을 수 있습니다.
- `node_modules`, `.env`, 개인 비밀키 등을 포함한 경로를 스캔할 때 민감 데이터가 원본에 노출되지 않도록 검사 범위를 관리하세요.
- JSON Finding에는 탐지된 비밀 원문을 넣지 않습니다.
- Docker 이미지 태그를 고정하였으나 DB는 업데이트에 따라 결과가 달라질 수 있습니다.
- 이 모듈은 원본 Trivy 보고서 자체를 별도 파일로 저장하지 않으며 SafeScan 표준 JSON 결과로 저장합니다.
