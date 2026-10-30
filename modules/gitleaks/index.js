// gitleaks — 하드코딩된 비밀 값 검사. 규칙: docs/MODULE_GUIDE.md
import { createHash } from 'node:crypto';
import { defineModule } from 'safescan/sdk';

const REDACTED = 'REDACTED';
const TITLES = {
  'generic-api-key': 'API 키 · 비밀 값 하드코딩',
  jwt: 'JWT 토큰 하드코딩',
  'private-key': '개인 키 하드코딩',
};
// 노출되면 곧바로 인프라 권한이 넘어가는 종류는 크리티컬로 올립니다.
const CRITICAL = /^(private-key|aws-|gcp-|azure-|github-(pat|app|oauth)|gitlab-pat|slack-)/;

export default defineModule({
  // 1) 전처리: 검사할 파일이 있는지, 프로젝트 자체 gitleaks 설정이 있는지 확인합니다.
  async preprocess(ctx) {
    const files = await ctx.project.findFiles({ limit: 1 });
    if (!files.length) ctx.skip('검사할 파일이 없습니다');
    const projectConfig = await ctx.project.exists('.gitleaks.toml');
    if (projectConfig) ctx.log.info('프로젝트의 .gitleaks.toml 규칙을 사용합니다');
    return { projectConfig };
  },

  // 2) 툴: 프로젝트 폴더를 훑습니다. --redact 로 비밀 값 원문이 결과에 남지 않게 합니다.
  async tool(ctx) {
    const args = [
      'dir', '.',
      '--report-format', 'json', '--report-path', '-',
      '--redact', '--no-banner', '--log-level', 'warn',
      '--max-target-megabytes', String(ctx.options.maxFileMB),
    ];
    // 비밀 값을 찾으면 종료 코드 1
    const { stdout } = await ctx.exec('gitleaks', args, { okExitCodes: [0, 1], quiet: true });
    const leaks = JSON.parse(stdout || '[]');
    if (!Array.isArray(leaks)) throw new Error('gitleaks 보고서 형식이 예상과 다릅니다');
    return leaks;
  },

  // 3) 후처리: 누출 1건 = Finding 1건. gitleaks 는 폴더를 스스로 훑으므로 사용자 제외 규칙은 여기서 거릅니다.
  postprocess(ctx, leaks) {
    const seen = new Map();
    return leaks
      .map((leak) => ({ ...leak, File: toRelative(ctx.project.root, leak.File) }))
      .filter((leak) => !ctx.project.isIgnored(leak.File))
      .map((leak) => {
        // 같은 파일에 같은 모양(예: password: 'REDACTED')이 여러 번 나와도 서로 다른 이슈가 되도록 순번을 붙입니다.
        // 줄 번호를 쓰지 않으므로 코드가 위아래로 밀려도 같은 이슈로 이어집니다.
        const key = `${leak.File}\u0000${leak.RuleID}\u0000${leak.Match}`;
        const nth = (seen.get(key) ?? 0) + 1;
        seen.set(key, nth);
        const generic = leak.RuleID === 'generic-api-key';
        return {
          ruleId: leak.RuleID,
          title: TITLES[leak.RuleID] ?? `비밀 값 하드코딩 (${leak.RuleID})`,
          severity: CRITICAL.test(leak.RuleID) ? 'critical' : 'high',
          // generic 규칙은 키워드 + 엔트로피로 추정하므로 낮게, 형식이 정해진 규칙은 높게 둡니다.
          confidence: generic ? (leak.Entropy >= 4.5 ? 0.7 : 0.55) : 0.85,
          description: leak.Description,
          location: { file: leak.File, startLine: leak.StartLine, endLine: leak.EndLine, snippet: leak.Match },
          owasp: ['A07:2025'],
          cwe: ['CWE-798'],
          remediation: '비밀 값을 코드에서 지우고 환경 변수나 비밀 관리 도구로 옮기세요. 이미 커밋된 값은 유출된 것으로 보고 폐기 · 재발급해야 합니다.',
          references: ['https://cwe.mitre.org/data/definitions/798.html'],
          fingerprint: createHash('sha1').update(`${key}\u0000${nth}`).digest('hex').slice(0, 16),
          raw: { gitleaksFingerprint: leak.Fingerprint, entropy: leak.Entropy, column: leak.StartColumn },
        };
      });
  },

  // 4) 검증: 비밀 값이 정말 가려졌는지, 도구 결과가 빠짐없이 옮겨졌는지 확인합니다.
  verify(ctx, { raw, findings }) {
    const ignored = raw.filter((leak) => ctx.project.isIgnored(toRelative(ctx.project.root, leak.File))).length;
    const unredacted = raw.filter((leak) => leak.Secret !== REDACTED).length;
    return {
      checks: [
        { name: '비밀 값 원문 미포함', passed: unredacted === 0, detail: `가려지지 않은 값 ${unredacted}건` },
        { name: '도구 결과 수 일치', passed: raw.length === findings.length + ignored, detail: `gitleaks ${raw.length}건 = 결과 ${findings.length}건 + 제외 경로 ${ignored}건` },
      ],
      notes: ['generic-api-key 는 키워드 · 엔트로피 기반이라 흔한 단어가 들어간 값은 놓칠 수 있습니다', 'git 커밋 기록은 보지 않습니다 (현재 파일만)'],
    };
  },
});

/** gitleaks 는 실행 위치에 따라 상대 · 절대 경로를 섞어 돌려주므로 프로젝트 기준 상대 경로(/ 구분)로 맞춥니다. */
function toRelative(root, file) {
  const norm = (p) => p.replaceAll('\\', '/');
  const rootPosix = norm(root).replace(/\/$/, '');
  const f = norm(file).replace(/^\.\//, '');
  return f.toLowerCase().startsWith(`${rootPosix.toLowerCase()}/`) ? f.slice(rootPosix.length + 1) : f;
}
