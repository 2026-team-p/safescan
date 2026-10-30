// SafeScan 모듈 계약: preprocess → tool → postprocess → verify
// 로컬에서만 검사하는 기본 구현입니다. 공개 운영 사이트에 대한 스캔은 별도 권한 확인 설계가 필요합니다.
import { defineModule } from 'safescan/sdk';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const IMAGE = 'ghcr.io/zaproxy/zaproxy:stable';
const ALLOWED_HOSTS = new Set(['localhost', '127.0.0.1', 'host.docker.internal']);
const SEVERITY = { '3': 'high', '2': 'medium', '1': 'low', '0': 'low' };
const CONFIDENCE = { '0': 0.1, '1': 0.45, '2': 0.65, '3': 0.85, '4': 0.95 };

const KOREAN = {
  '10038': {
    title: '콘텐츠 보안 정책(CSP) 누락',
    description: '응답에 콘텐츠 보안 정책이 없어 악성 스크립트 실행을 제한하는 추가 보호 장치가 부족할 수 있습니다.',
    remediation: '웹서버의 Content-Security-Policy 헤더를 설정하세요. 현재 사이트의 인라인 스크립트가 작동하는지 Report-Only 정책으로 먼저 점검하세요.'
  },
  '10020': {
    title: '클릭재킹 방어 헤더 누락',
    description: '다른 사이트가 이 화면을 iframe에 넣어 사용자가 의도하지 않은 동작을 하도록 유도할 수 있습니다.',
    remediation: "iframe 삽입이 필요 없다면 Content-Security-Policy의 frame-ancestors 'none' 또는 X-Frame-Options: DENY를 적용하세요."
  },
  '10021': {
    title: '콘텐츠 유형 보호 헤더 누락',
    description: '브라우저가 리소스의 콘텐츠 유형을 추측할 수 있습니다.',
    remediation: 'X-Content-Type-Options: nosniff 헤더를 설정하세요.'
  },
  '10036': {
    title: '웹서버 버전 정보 노출',
    description: 'Server 응답 헤더에 웹서버 종류나 버전이 공개되어 있습니다. 로컬 Python 테스트 서버에서 발생할 수 있습니다.',
    remediation: '배포 서버에서 자세한 버전 정보를 노출하지 않도록 설정하세요. 운영 환경에서도 같은 문제가 있는지 별도 확인하세요.'
  },
  '10063': {
    title: '브라우저 기능 권한 정책 누락',
    description: 'Permissions-Policy 응답 헤더가 설정되지 않았습니다.',
    remediation: '사이트가 사용하는 기능을 확인하고 필요하지 않은 카메라, 마이크 등 브라우저 기능을 Permissions-Policy로 제한하세요.'
  },
  '10109': {
    title: '동적 웹 애플리케이션 감지',
    description: 'JavaScript 중심의 웹 앱으로 추정됩니다. 보안 취약점이 확인되었다는 뜻은 아닙니다.',
    remediation: '조치할 필요는 없습니다. JavaScript 동작 분석을 추가하려면 별도 브라우저 기반 탐색을 고려하세요.'
  },
  '10049': {
    title: '캐시 가능한 웹 콘텐츠 발견',
    description: '브라우저 또는 중간 프록시에서 응답을 캐시할 수 있습니다. 민감정보를 포함하지 않으면 반드시 취약점은 아닙니다.',
    remediation: '민감한 데이터 응답이라면 Cache-Control 정책을 검토하세요. 정적 공개 파일에 일괄적으로 캐시 금지를 적용할 필요는 없습니다.'
  }
};

function explain(alert) {
  const name = String(alert.name ?? alert.alert ?? '');
  if (name.includes('Cross-Origin-Embedder-Policy')) {
    return { title: 'Cross-Origin-Embedder-Policy 설정 검토', description: '교차 출처 리소스 격리 정책이 미설정되었을 수 있습니다.', remediation: '외부 리소스가 필요한지 확인한 뒤 COEP 정책의 호환성과 필요성을 검토하세요.' };
  }
  if (name.includes('Cross-Origin-Opener-Policy')) {
    return { title: 'Cross-Origin-Opener-Policy 설정 검토', description: '브라우징 컨텍스트 격리 정책이 미설정되었을 수 있습니다.', remediation: '팝업 및 외부 인증 흐름에 영향이 없는지 검토한 후 COOP 정책을 선택하세요.' };
  }
  if (name.includes('Cross-Origin-Resource-Policy')) {
    return { title: 'Cross-Origin-Resource-Policy 설정 검토', description: '다른 출처에서 리소스를 불러올 수 있는 범위를 명시하지 않았습니다.', remediation: '사이트의 외부 리소스 사용 여부를 고려해 CORP 정책을 선택하세요.' };
  }
  return KOREAN[String(alert.pluginid)] ?? {
    title: name || '알 수 없는 경고',
    description: plainText(alert.desc).slice(0, 700),
    remediation: plainText(alert.solution).slice(0, 700) || '관련 공식 문서를 확인하고 추가 검증하세요.'
  };
}

function plainText(value) {
  return String(value ?? '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
}

function parseTarget(input) {
  let url;
  try { url = new URL(input); } catch { throw new Error('올바른 http/https URL을 입력하세요.'); }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) {
    throw new Error('URL은 http(s) 주소여야 하고 사용자 이름이나 비밀번호를 포함하면 안 됩니다.');
  }
  if (url.search || url.hash) throw new Error('검사 시작 URL에서 쿼리 문자열과 #을 제외해 주세요.');
  if (!ALLOWED_HOSTS.has(url.hostname)) {
    throw new Error('현재 버전은 로컬 테스트 사이트만 허용합니다. 공개 운영 사이트의 Full Scan은 차단됩니다.');
  }
  if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
    url.hostname = 'host.docker.internal';
  }
  return url.href;
}

export default defineModule({
  async preprocess(ctx) {
    let specifiedUrl = String(ctx.options.url ?? '').trim();
    // 벤치 예제에서는 .safescan-zap.json을 통해 테스트 URL을 지정할 수 있습니다.
    if (!specifiedUrl && await ctx.project.exists('.safescan-zap.json')) {
      const config = JSON.parse(await ctx.project.readText('.safescan-zap.json'));
      specifiedUrl = String(config.url ?? '').trim();
    }
    if (!specifiedUrl) ctx.skip('검사 URL이 없습니다. -o owasp-zap.url=http://localhost:5000 으로 지정하세요.');
    const mode = String(ctx.options.mode ?? 'baseline');
    if (!['baseline', 'full'].includes(mode)) throw new Error('검사 모드는 baseline 또는 full이어야 합니다.');
    if (mode === 'full' && ctx.options.confirmActive !== true) {
      throw new Error('Full Scan에는 -o owasp-zap.confirmActive=true 승인이 필요합니다.');
    }
    const minutes = Number(ctx.options.spiderMinutes ?? 2);
    if (!Number.isInteger(minutes) || minutes < 0 || minutes > 30) {
      throw new Error('탐색 시간은 0~30분 사이의 정수여야 합니다.');
    }
    const url = parseTarget(specifiedUrl);
    ctx.log.info(`검사 대상 ${url} · 모드 ${mode}`);
    return { url, mode, spiderMinutes: minutes };
  },

  async tool(ctx, input) {
    // requires 검사는 docker 명령의 존재만 확인하므로 데몬 실행 상태도 따로 점검합니다.
    try {
      await ctx.exec('docker', ['info', '--format', '{{.ServerVersion}}'], { quiet: true });
    } catch {
      throw new Error('Docker 엔진이 실행되지 않았습니다. Docker Desktop을 켠 후 재시도하세요.');
    }
    const inspect = await ctx.exec('docker', ['image', 'inspect', IMAGE], {
      okExitCodes: [0, 1], quiet: true
    });
    if (inspect.code !== 0) {
      ctx.log.info('OWASP ZAP 이미지가 없어 Docker로 다운로드합니다.');
      await ctx.exec('docker', ['pull', IMAGE], { quiet: false });
    }
    const script = input.mode === 'full' ? 'zap-full-scan.py' : 'zap-baseline.py';
    const args = [
      'run', '--rm',
      '-v', `${ctx.tmpDir}:/zap/wrk/:rw`,
      IMAGE, script,
      '-t', input.url,
      '-m', String(input.spiderMinutes),
      '-J', 'zap_raw.json',
      '-r', 'zap_report.html'
    ];
    const result = await ctx.exec('docker', args, {
      okExitCodes: [0, 1, 2], quiet: false
    });
    // ZAP 종료코드 1(Fail 경고), 2(Warn 경고)는 스캔 자체 오류가 아닙니다.
    let raw;
    try { raw = JSON.parse(await readFile(join(ctx.tmpDir, 'zap_raw.json'), 'utf8')); }
    catch (error) { throw new Error(`ZAP 보고서가 생성되지 않았거나 JSON이 잘못되었습니다: ${error.message}`); }
    if (!Array.isArray(raw.site)) throw new Error('ZAP JSON에 site 배열이 없습니다.');
    return { report: raw, zapExitCode: result.code };
  },

  postprocess(ctx, raw) {
    const findings = [];
    for (const site of raw.report.site) {
      for (const alert of site.alerts ?? []) {
        const translated = explain(alert);
        const urls = (alert.instances ?? []).map((item) => item.uri ?? item.url).filter(Boolean);
        const referenceMatches = String(alert.reference ?? '').match(/https?:\/\/[^\s<>"']+/g) ?? [];
        const risk = String(alert.riskcode ?? '0');
        findings.push({
          ruleId: String(alert.alertRef || alert.pluginid || 'zap-unknown'),
          title: translated.title,
          severity: SEVERITY[risk] ?? 'low',
          confidence: CONFIDENCE[String(alert.confidence ?? '2')] ?? 0.5,
          description: translated.description,
          remediation: translated.remediation,
          owasp: risk === '0' ? [] : ['A02:2025'],
          cwe: /^\d+$/.test(String(alert.cweid)) && Number(alert.cweid) > 0
            ? [`CWE-${alert.cweid}`] : [],
          references: referenceMatches.slice(0, 5),
          fingerprint: `zap:${alert.alertRef || alert.pluginid}:${translated.title}:${urls[0] || site['@name']}`,
          raw: {
            pluginId: alert.pluginid,
            originalTitle: alert.name ?? alert.alert,
            riskCode: risk,
            informational: risk === '0',
            zapConfidenceCode: alert.confidence,
            verificationStatus: 'needs_review',
            occurrenceCount: urls.length,
            affectedUrls: urls.slice(0, 20),
            scanMode: raw.scanMode
          }
        });
      }
    }
    return findings;
  },

  verify(ctx, { raw, findings }) {
    const groups = raw.report.site.reduce((sum, site) => sum + (site.alerts?.length ?? 0), 0);
    const codes = new Set(findings.map((f) => f.fingerprint));
    return {
      checks: [
        { name: 'ZAP 경고 유형 수 일치', passed: groups === findings.length, detail: `원본 ${groups}건, 변환 ${findings.length}건` },
        { name: '중복 결과 미발생', passed: codes.size === findings.length }
      ],
      notes: [
        'ZAP 경고는 공격 성공을 입증하지 않습니다. 판정 전에 재현과 맥락 확인이 필요합니다.',
        'ZAP 정보성 경고는 프레임워크 제약으로 low로 매핑하고 raw.informational=true로 보존합니다.',
        '현재 버전은 Docker에서 접근할 수 있는 로컬 테스트 사이트만 스캔합니다.'
      ]
    };
  }
});
