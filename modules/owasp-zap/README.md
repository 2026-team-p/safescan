# OWASP ZAP — SafeScan DAST 모듈

SafeScan의 `modules/owasp-zap/`에 설치하는 Node.js 모듈입니다. `preprocess -> tool -> postprocess -> verify` 4단계 계약을 따릅니다.

## 사전 준비

- SafeScan 저장소: Node.js >= 20.12, `npm install`
- Docker Desktop 실행 (`docker info` 정상)
- 검사할 로컬 웹사이트 실행 (예: `http://localhost:5000`)
- 실제 Bluetooth 장치, 운영 데이터베이스, 외부 API 등과 격리된 테스트 사본만 사용

## 검사 실행 (SafeScan 저장소 루트에서)

Windows PowerShell:

```powershell
node bin/safescan.js check owasp-zap
node bin/safescan.js scan "$HOME\Desktop\hackathon" -m owasp-zap -o owasp-zap.url=http://localhost:5000 -o owasp-zap.mode=baseline
```

능동 검사는 **소유권과 허가가 확인된 격리 테스트 환경**에서만:

```powershell
node bin/safescan.js scan "$HOME\Desktop\hackathon" -m owasp-zap -o owasp-zap.url=http://localhost:5000 -o owasp-zap.mode=full -o owasp-zap.confirmActive=true
```

`http://localhost`와 `127.0.0.1`은 Docker 컨테이너가 접근할 수 있게 `host.docker.internal`로 변환합니다.

ZAP 이미지가 없으면 처음 실행할 때 자동으로 pull합니다. 결과는 검사 대상 프로젝트의 `.safescan/runs/<runId>/run.json`에 저장됩니다.
원본 ZAP JSON은 임시 폴더에서 파싱한 뒤 자동 삭제되므로, 원본 파일의 지속 보관이 필요하면 코어에 아티팩트 저장 API 추가를 별도로 요청해야 합니다.

## 벤치마크 (별도 PowerShell 2개)

1. 한 터미널에서 fixture 웹서버 실행:

```powershell
cd "$HOME\Desktop\safescan"
python -m http.server 5100 --bind 0.0.0.0 --directory .\modules\owasp-zap\fixtures\vulnerable
```

2. 다른 터미널에서 `node bin/safescan.js bench owasp-zap` 실행

`fixtures/vulnerable/.safescan-zap.json`이 검사 URL을 지정합니다. CI 자동 실행을 위해서는 별도의 Fixture 웹서버 기동 단계가 필요합니다.

## 결과와 제약

- ZAP의 10종 경고 등은 1종류=SafeScan Finding 1개로 반환합니다. 발생 위치 수는 `raw.occurrenceCount`에서 확인합니다.
- 도구의 종료 코드 1/2는 탐지 경고로 인정하고 3 이상은 실행 오류로 처리합니다.
- 위험도 매핑: ZAP high->high, medium->medium, low/info->low. 정보성 여부는 `raw.informational`에 표시합니다.
- 신뢰도 매핑: ZAP false-positive=0.1, low=0.45, medium=0.65, high=0.85, confirmed=0.95. 이 수치는 스캐너의 탐지 수준 표현일 뿐 공격 성공 확률이 아닙니다.
- 대부분의 웹서버 설정 경고는 OWASP A02:2025로 분류되지만, 별도 규칙별 분류 보강이 필요합니다.
- ZAP Full Scan은 XSS/SQLi 등 일부 능동 검사를 하지만 JS 중심 DOM XSS, 접근 제어, 비즈니스 로직 취약점 전체를 검증하지 않습니다.
- 로컬 Python `http.server`에서 검출된 헤더 경고는 실제 운영 서버와 다를 수 있습니다.
- Docker 컨테이너가 localhost에서 실행 중인 웹서버에 접근할 수 있어야 합니다. WSL/Linux 환경에선 호스트 네트워크 접근 설정이 추가로 필요할 수 있습니다.
- `timeoutSec`를 넘기면 SafeScan 프로세스가 검사 실행을 종료합니다. Docker 자식 컨테이너가 계속 남는지는 `docker ps`로 확인하세요.

## 코어 변경 요청 (필요 시)

1. 스캔 원본 HTML/JSON 아티팩트 영구 저장을 위한 공식 API.
2. URL 검사 대상 소유권 검증 및 승인/정책 관리.
3. Full Scan 결과의 실제 악용 검증 상태와 정보성 위험도를 별도 필드로 지원.
