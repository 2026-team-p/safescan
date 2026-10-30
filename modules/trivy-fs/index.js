// Trivy JSON → SafeScan Finding[]. 원본 데이터는 tool 단계에서 그대로 반환합니다.
import { defineModule } from 'safescan/sdk';

const LEVELS = { CRITICAL: 'critical', HIGH: 'high', MEDIUM: 'medium', LOW: 'low', UNKNOWN: 'low' };
const posix = (value) => String(value ?? '').replace(/\\/g, '/').replace(/^\.\//, '');
function safePath(value) {
  let f = posix(value).replace(/^\/scan\/?/, '').replace(/^\/workspace\/?/, '');
  if (!f || f.startsWith('/') || /^[A-Za-z]:/.test(f) || f.split('/').includes('..')) return undefined;
  return f;
}
function link(url) { return typeof url === 'string' && /^https:\/\//.test(url) ? [url] : []; }
function severity(s) { return LEVELS[String(s ?? '').toUpperCase()] ?? 'low'; }

export default defineModule({
  async preprocess(ctx) {
    // 외부 도구가 프로젝트 디렉터리를 전체 검사하므로 파일 목록은 적용 가능성 확인에 사용합니다.
    const files = await ctx.project.findFiles({ limit: 5000 });
    if (!files.length) ctx.skip('검사할 프로젝트 파일이 없습니다');
    ctx.log.info(`검사 파일 발견: ${files.length}개`);
    return { root: ctx.project.root };
  },

  async tool(ctx) {
    const scopes = { all: 'vuln,misconfig,secret', vuln: 'vuln', misconfig: 'misconfig', secret: 'secret' };
    const args = [
      'run', '--rm', '--mount', `type=bind,source=${ctx.project.root},target=/scan,readonly`,
      'aquasec/trivy:0.76.1', 'fs', '--quiet', '--scanners', scopes[ctx.options.scannerSet] ?? scopes.all,
      '--format', 'json', '/scan',
    ];
    const { stdout } = await ctx.exec('docker', args, { quiet: true });
    try { return JSON.parse(stdout); }
    catch { throw new Error('Trivy가 유효한 JSON을 출력하지 않았습니다. Docker 실행 및 취약점 DB 상태를 확인하세요.'); }
  },

  postprocess(ctx, raw) {
    const findings = [];
    for (const report of raw.Results ?? []) {
      const file = safePath(report.Target);
      for (const v of report.Vulnerabilities ?? []) {
        const ruleId = v.VulnerabilityID ?? 'trivy-vulnerability';
        const pkg = v.PkgName ?? 'unknown';
        findings.push({
          ruleId, title: v.Title || `${pkg}: ${ruleId}`,
          severity: severity(v.Severity), confidence: 0.9,
          description: v.Description || `${pkg} ${v.InstalledVersion ?? ''}에서 알려진 취약점이 보고되었습니다. 실제 도달 가능성은 미검증입니다.`,
          ...(file ? { location: { file } } : {}),
          dependency: { name: pkg, ...(v.InstalledVersion ? { version: v.InstalledVersion } : {}), ...(v.FixedVersion ? { fixedIn: v.FixedVersion } : {}) },
          owasp: ['A03:2025'], cwe: (v.CweIDs ?? []).filter((x) => /^CWE-\d+$/.test(x)),
          remediation: v.FixedVersion ? `수정 버전 ${v.FixedVersion}으로 업데이트를 검토하세요.` : '권고문과 의존성 사용 여부를 점검하세요.',
          references: link(v.PrimaryURL),
          raw: { target: report.Target, installedVersion: v.InstalledVersion, fixedVersion: v.FixedVersion },
        });
      }
      for (const m of report.Misconfigurations ?? []) {
        const loc = safePath(m.CauseMetadata?.Resource || report.Target);
        const startLine = Number(m.CauseMetadata?.StartLine);
        findings.push({
          ruleId: m.ID ?? 'trivy-misconfig', title: m.Title || m.ID || '설정 오류',
          severity: severity(m.Severity), confidence: 0.8,
          description: m.Message || m.Description || '설정 점검 규칙과 일치하지 않습니다.',
          ...(loc ? { location: { file: loc, ...(startLine > 0 ? { startLine } : {}) } } : {}),
          owasp: ['A02:2025'], remediation: m.Resolution || '설정 파일을 검토하세요.',
          references: link(m.PrimaryURL), raw: { target: report.Target, id: m.ID },
        });
      }
      for (const s of report.Secrets ?? []) {
        const loc = safePath(report.Target);
        findings.push({
          ruleId: s.RuleID || 'trivy-secret', title: s.Title || '비밀정보 노출 의심',
          severity: severity(s.Severity), confidence: 0.6,
          description: '비밀정보와 유사한 패턴이 탐지됐습니다. 결과에 원문 비밀 값은 저장하지 않습니다.',
          ...(loc ? { location: { file: loc, ...(s.StartLine ? { startLine: s.StartLine } : {}) } } : {}),
          owasp: ['A02:2025'], remediation: '실제 비밀정보인지 확인하고 노출되었다면 교체·폐기 및 안전한 저장소로 이동하세요.',
          raw: { ruleId: s.RuleID },
        });
      }
    }
    return findings;
  },

  verify(ctx, { raw, findings }) {
    const expected = (raw.Results ?? []).reduce((n, r) => n + (r.Vulnerabilities?.length ?? 0) + (r.Misconfigurations?.length ?? 0) + (r.Secrets?.length ?? 0), 0);
    return {
      checks: [{ name: 'Trivy 탐지 항목 수 일치', passed: expected === findings.length, detail: `원본 ${expected} / 변환 ${findings.length}` }],
      notes: ['공개 취약점 DB 및 규칙과의 일치만 확인했습니다. 실제 악용 가능성은 검증하지 않았습니다.', '원본 Trivy JSON에는 민감한 일치 문자열이 포함될 수 있으므로 별도 보관과 공유 제한이 필요합니다.', 'Docker 기반 전체 폴더 검사에는 SafeScan의 .safescanignore 패턴이 직접 전달되지 않습니다.'],
    };
  },
});
