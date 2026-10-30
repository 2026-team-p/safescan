# 모듈 후보

병렬로 나눠 만들 수 있는 모듈 후보입니다. 서로 의존하지 않으므로 아무 순서로나 시작해도 됩니다.
작업 규칙은 [MODULE_GUIDE.md](./MODULE_GUIDE.md) §8 을 따릅니다.

| id (제안) | 분류 | 핵심 도구 | OWASP 2025 | 적용 조건 (appliesWhen) | 메모 |
|---|---|---|---|---|---|
| `npm-audit` | dependency | npm audit | A03 | package-lock.json | **완료** — 기준 예시 |
| `osv-scanner` | dependency | OSV-Scanner | A03 | yarn.lock, pnpm-lock.yaml, requirements.txt, pom.xml, go.mod … | npm 외 생태계 의존성 |
| `semgrep-injection` | sast | Semgrep CE | A05 | *.js, *.ts, *.py, *.java | SQLi · XSS · 명령 주입. 규칙은 모듈 폴더에 고정 |
| `semgrep-exception` | sast | Semgrep CE | A10 | *.js, *.ts, *.py, *.java | 빈 catch, 스택 트레이스 노출, 실패 시 열림(fail-open) |
| `gitleaks` | secrets | Gitleaks | A07 | (항상) | 하드코딩된 키 · 토큰. 결과에 비밀 값 원문을 남기지 않기 |
| `eslint-security` | sast | eslint-plugin-security | A05 | package.json | JS 전용 가벼운 정적 분석 |
| `bandit` | sast | Bandit | A05 | *.py | Python 백엔드 |
| `retire-js` | dependency | Retire.js | A03 | *.js | 번들 · 정적 파일에 섞인 오래된 프론트 라이브러리 |
| `trivy-config` | iac | Trivy (config) | A02 | Dockerfile, docker-compose.yml, *.tf | 설정 누락 |
| `zap-baseline` | dast | OWASP ZAP baseline | A02 | (항상, `targetUrl` 옵션 필요) | 실행 중인 앱 대상. docker 필요 |
| `http-observatory` | dast | MDN HTTP Observatory CLI | A02 | (항상, `targetUrl` 옵션 필요) | 보안 헤더 · 쿠키 설정 |

## 고를 때 기준
- 툴 단계의 도구는 **공개되어 있고, 널리 쓰이며, 결과를 기계가 읽을 수 있는 형식(JSON · SARIF)으로 내야** 합니다.
- 같은 도구를 여러 모듈이 쓸 수 있습니다 (예: Semgrep). 대신 모듈마다 규칙 · 대상을 분명히 나눠, 결과가 겹치지 않게 합니다.
- DAST 모듈은 실행 중인 앱 주소가 필요하므로 `options.targetUrl` 을 두고, 값이 없으면 `ctx.skip()` 합니다.
