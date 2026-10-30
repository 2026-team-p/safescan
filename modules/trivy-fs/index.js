// Trivy JSON → SafeScan Finding[]. 원본 데이터는 tool 단계에서 그대로 반환합니다.
import { defineModule } from 'safescan/sdk';

const IMAGE = 'aquasec/trivy:0.76.1';
// 취약점 DB · 설정 규칙을 실행 사이에 다시 쓰도록 담아 두는 Docker 볼륨 (지우려면 docker volume rm safescan-trivy-cache)
const CACHE_VOLUME = 'safescan-trivy-cache';
const CACHE_DIR = '/root/.cache/trivy';
const SCANNERS = ['vuln', 'misconfig', 'secret'];
// severity 옵션 → Trivy 등급. 참고(low)에는 등급을 알 수 없는 UNKNOWN 도 넣습니다 (후처리에서 UNKNOWN → low).
const TRIVY_SEVERITY = { low: ['UNKNOWN', 'LOW'], medium: ['MEDIUM'], high: ['HIGH'], critical: ['CRITICAL'] };
const LEVELS = { CRITICAL: 'critical', HIGH: 'high', MEDIUM: 'medium', LOW: 'low', UNKNOWN: 'low' };
const posix = (value) => String(value ?? '').replace(/\\/g, '/').replace(/^\.\//, '');
function safePath(value) {
  let f = posix(value).replace(/^\/scan\/?/, '').replace(/^\/workspace\/?/, '');
  if (!f || f.startsWith('/') || /^[A-Za-z]:/.test(f) || f.split('/').includes('..')) return undefined;
  return f;
}
function link(url) { return typeof url === 'string' && /^https:\/\//.test(url) ? [url] : []; }
function severity(s) { return LEVELS[String(s ?? '').toUpperCase()] ?? 'low'; }
function toArray(value) { return Array.isArray(value) ? value : value ? [value] : []; }

export default defineModule({
  async preprocess(ctx) {
    const scanners = toArray(ctx.options.scanners).filter((s) => SCANNERS.includes(s));
    if (!scanners.length) ctx.skip('검사 항목을 하나 이상 고르세요');
    const levels = toArray(ctx.options.severity).flatMap((s) => TRIVY_SEVERITY[s] ?? []);
    if (!levels.length) ctx.skip('보고할 위험도를 하나 이상 고르세요');
    // 외부 도구가 프로젝트 디렉터리를 전체 검사하므로 파일 목록은 적용 가능성 확인에 사용합니다.
    const files = await ctx.project.findFiles({ limit: 5000 });
    if (!files.length) ctx.skip('검사할 프로젝트 파일이 없습니다');
    ctx.log.info(`검사 파일 발견: ${files.length}개 · 검사 항목 ${scanners.join(', ')} · 위험도 ${levels.join(', ')}`);
    return {
      root: ctx.project.root,
      scanners,
      severity: levels,
      ignoreUnfixed: ctx.options.ignoreUnfixed === true,
      skipDbUpdate: ctx.options.skipDbUpdate === true,
    };
  },

  async tool(ctx, input) {
    const args = [
      'run', '--rm', '--mount', `type=bind,source=${ctx.project.root},target=/scan,readonly`,
      // 취약점 DB 를 매번 내려받지 않도록 이름 있는 볼륨에 둡니다. Trivy 는 DB 가 오래됐을 때만 새로 받습니다.
      '--mount', `type=volume,source=${CACHE_VOLUME},target=${CACHE_DIR}`,
      IMAGE, 'fs', '--quiet', '--cache-dir', CACHE_DIR,
      '--scanners', input.scanners.join(','), '--severity', input.severity.join(','),
      '--format', 'json',
    ];
    if (input.ignoreUnfixed) args.push('--ignore-unfixed');
    if (input.skipDbUpdate) args.push('--skip-db-update', '--skip-java-db-update', '--skip-check-update');
    args.push('/scan');
    let stdout;
    try {
      ({ stdout } = await ctx.exec('docker', args, { quiet: true }));
    } catch (err) {
      if (!input.skipDbUpdate) throw err;
      throw new Error(`${err.message}\n받아 둔 취약점 DB 가 없을 수 있습니다. 'DB 업데이트 건너뛰기' 를 끄고 한 번 검사한 뒤 다시 켜세요.`);
    }
    try { return JSON.parse(stdout); }
    catch { throw new Error('Trivy가 유효한 JSON을 출력하지 않았습니다. Docker 실행 및 취약점 DB 상태를 확인하세요.'); }
  },

  postprocess(ctx, raw) {
    const findings = [];
    let ignored = 0;
    for (const report of raw.Results ?? []) {
      const file = safePath(report.Target);
      // Trivy 는 폴더 전체를 훑으므로 사용자 제외 규칙(.safescanignore · 기본 제외 폴더)은 여기서 거릅니다.
      if (file && ctx.project.isIgnored(file)) {
        ignored += countOf(report);
        continue;
      }
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
    if (ignored) ctx.log.info(`제외 경로(.safescanignore · 기본 제외 폴더)의 결과 ${ignored}건은 뺐습니다`);
    return findings;
  },

  verify(ctx, { input, raw, findings }) {
    const reports = raw.Results ?? [];
    const expected = reports.reduce((n, r) => n + countOf(r), 0);
    const ignored = reports.filter((r) => {
      const file = safePath(r.Target);
      return file && ctx.project.isIgnored(file);
    }).reduce((n, r) => n + countOf(r), 0);
    return {
      checks: [{ name: 'Trivy 탐지 항목 수 일치', passed: expected === findings.length + ignored, detail: `원본 ${expected} = 변환 ${findings.length} + 제외 경로 ${ignored}` }],
      notes: [
        '공개 취약점 DB 및 규칙과의 일치만 확인했습니다. 실제 악용 가능성은 검증하지 않았습니다.',
        '원본 Trivy JSON에는 민감한 일치 문자열이 포함될 수 있으므로 별도 보관과 공유 제한이 필요합니다.',
        'Trivy 는 제외 경로까지 훑은 뒤 결과에서만 거릅니다. 검사 시간은 줄지 않습니다.',
        ...(input.ignoreUnfixed ? ['수정 버전이 없는 취약점은 뺐습니다 (ignoreUnfixed).'] : []),
      ],
    };
  },
});

function countOf(report) {
  return (report.Vulnerabilities?.length ?? 0) + (report.Misconfigurations?.length ?? 0) + (report.Secrets?.length ?? 0);
}
