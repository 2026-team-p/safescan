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
// excludeTests 옵션으로 빼는 경로: 테스트 · 예제 폴더, *.test.* · test_*.py · *.example 같은 파일
const TEST_DIR = /(^|\/)(tests?|__tests__|__mocks__|specs?|fixtures?|examples?|samples?|mocks?|testdata|e2e)\//i;
const TEST_FILE = /[._-](test|spec)\.[^/]+$|(^|\/)test_[^/]+$|\.(example|sample)(\.[^/]+)?$/i;
const JAVA_TEST_FILE = /[A-Za-z0-9](Test|Tests|IT)\.java$/;

export default defineModule({
  // 1) 전처리: 검사할 파일이 있는지, 프로젝트 자체 gitleaks 설정이 있는지, 커밋 기록을 볼 수 있는지 확인합니다.
  async preprocess(ctx) {
    const files = await ctx.project.findFiles({ limit: 1 });
    if (!files.length) ctx.skip('검사할 파일이 없습니다');
    const projectConfig = await ctx.project.exists('.gitleaks.toml');
    if (projectConfig) ctx.log.info('프로젝트의 .gitleaks.toml 규칙을 사용합니다');

    let history = ctx.options.scope === 'history';
    if (history && !(await ctx.project.exists('.git'))) {
      ctx.log.warn('프로젝트 폴더가 git 저장소가 아니라서 커밋 기록은 검사하지 않습니다 (현재 파일만 검사)');
      history = false;
    }
    const maxCommits = Math.max(0, Math.floor(Number(ctx.options.maxCommits ?? 0)));
    if (history) ctx.log.info(`커밋 기록도 검사합니다 (${maxCommits ? `최근 ${maxCommits}개` : '전체'})`);
    return { projectConfig, history, maxCommits };
  },

  // 2) 툴: 프로젝트 폴더를 훑고, 옵션이 켜져 있으면 커밋 기록도 훑습니다.
  //    --redact 로 비밀 값 원문이 결과에 남지 않게 합니다.
  async tool(ctx, input) {
    const common = [
      '--report-format', 'json', '--report-path', '-',
      '--redact', '--no-banner', '--log-level', 'warn',
      '--max-target-megabytes', String(ctx.options.maxFileMB),
    ];
    const files = await runGitleaks(ctx, ['dir', '.', ...common]);
    let history = null;
    if (input.history) {
      const args = ['git', '.', ...common];
      // 개수를 제한할 때도 기본 동작과 같게 모든 브랜치의 기록을 봅니다 (--log-opts 를 주면 gitleaks 기본 옵션이 빠짐).
      if (input.maxCommits > 0) args.push('--log-opts', `--full-history --all --diff-filter=tuxdb -n ${input.maxCommits}`);
      history = await runGitleaks(ctx, args);
    }
    return { files, history };
  },

  // 3) 후처리: 누출 1건 = Finding 1건. gitleaks 는 폴더를 스스로 훑으므로 사용자 제외 규칙은 여기서 거릅니다.
  postprocess(ctx, raw) {
    const seen = new Map();
    return select(ctx, raw).kept.map(({ leak, fromHistory }) => {
      // 같은 파일에 같은 모양(예: password: 'REDACTED')이 여러 번 나와도 서로 다른 이슈가 되도록 순번을 붙입니다.
      // 줄 번호를 쓰지 않으므로 코드가 위아래로 밀려도 같은 이슈로 이어집니다. 커밋 기록 결과는 커밋으로 구분합니다.
      const key = [fromHistory ? `history:${leak.Commit}` : '', leak.File, leak.RuleID, leak.Match].join('\u0000');
      const nth = (seen.get(key) ?? 0) + 1;
      seen.set(key, nth);
      const generic = leak.RuleID === 'generic-api-key';
      const title = TITLES[leak.RuleID] ?? `비밀 값 하드코딩 (${leak.RuleID})`;
      const commit = String(leak.Commit ?? '').slice(0, 8);
      return {
        ruleId: leak.RuleID,
        title: fromHistory ? `${title} (커밋 기록)` : title,
        severity: CRITICAL.test(leak.RuleID) ? 'critical' : 'high',
        // generic 규칙은 키워드 + 엔트로피로 추정하므로 낮게, 형식이 정해진 규칙은 높게 둡니다.
        confidence: generic ? (leak.Entropy >= 4.5 ? 0.7 : 0.55) : 0.85,
        description: fromHistory
          ? `${leak.Description}\n커밋 ${commit} (${String(leak.Date ?? '').slice(0, 10)}) 에 들어간 값입니다. 지금 파일에서 지웠더라도 저장소를 받은 사람은 git 기록에서 볼 수 있습니다.`
          : leak.Description,
        location: { file: leak.File, startLine: leak.StartLine, endLine: leak.EndLine, snippet: leak.Match },
        owasp: ['A07:2025'],
        cwe: ['CWE-798'],
        remediation: fromHistory
          ? '이 값은 유출된 것으로 보고 폐기 · 재발급하세요. 기록에서도 지워야 한다면 git filter-repo 같은 도구로 기록을 다시 쓰고 강제 푸시해야 합니다.'
          : '비밀 값을 코드에서 지우고 환경 변수나 비밀 관리 도구로 옮기세요. 이미 커밋된 값은 유출된 것으로 보고 폐기 · 재발급해야 합니다.',
        references: ['https://cwe.mitre.org/data/definitions/798.html'],
        fingerprint: createHash('sha1').update(`${key}\u0000${nth}`).digest('hex').slice(0, 16),
        // 작성자 이름 · 이메일은 개인정보라 담지 않습니다.
        raw: {
          gitleaksFingerprint: leak.Fingerprint, entropy: leak.Entropy, column: leak.StartColumn,
          ...(fromHistory ? { commit, date: leak.Date } : {}),
        },
      };
    });
  },

  // 4) 검증: 비밀 값이 정말 가려졌는지, 도구 결과가 빠짐없이 옮겨졌는지 확인합니다.
  verify(ctx, { input, raw, findings }) {
    const all = [...raw.files, ...(raw.history ?? [])];
    const unredacted = all.filter((leak) => leak.Secret !== REDACTED).length;
    const { dropped } = select(ctx, raw);
    const parts = [`결과 ${findings.length}건`, `제외 경로 ${dropped.ignored}건`];
    if (ctx.options.excludeTests) parts.push(`테스트 · 예제 ${dropped.tests}건`);
    if (raw.history) parts.push(`현재 파일과 겹치는 기록 ${dropped.duplicate}건`);
    const droppedTotal = dropped.ignored + dropped.tests + dropped.duplicate;
    return {
      checks: [
        { name: '비밀 값 원문 미포함', passed: unredacted === 0, detail: `가려지지 않은 값 ${unredacted}건` },
        { name: '도구 결과 수 일치', passed: all.length === findings.length + droppedTotal, detail: `gitleaks ${all.length}건 = ${parts.join(' + ')}` },
      ],
      notes: [
        'generic-api-key 는 키워드 · 엔트로피 기반이라 흔한 단어가 들어간 값은 놓칠 수 있습니다',
        input.history
          ? '커밋 기록은 각 커밋에서 추가된 줄만 봅니다. 현재 파일과 같은 값(파일 · 규칙 · 가린 일치 문자열이 같음)은 한 번만 보고합니다'
          : 'git 커밋 기록은 보지 않습니다 (현재 파일만 — 검사 범위 옵션으로 켤 수 있음)',
      ],
    };
  },
});

async function runGitleaks(ctx, args) {
  // 비밀 값을 찾으면 종료 코드 1
  const { stdout } = await ctx.exec('gitleaks', args, { okExitCodes: [0, 1], quiet: true });
  const leaks = JSON.parse(stdout || '[]');
  if (!Array.isArray(leaks)) throw new Error('gitleaks 보고서 형식이 예상과 다릅니다');
  return leaks;
}

/**
 * 도구 결과에서 보고할 것만 고릅니다. 후처리와 검증이 같은 기준을 씁니다.
 * - 사용자 제외 규칙(.safescanignore · 기본 제외 폴더)에 맞는 경로
 * - excludeTests 가 켜져 있으면 테스트 · 예제 경로
 * - 커밋 기록 결과 중 현재 파일에도 그대로 있는 값 (현재 파일 결과로 한 번만 보고)
 */
function select(ctx, raw) {
  const dropped = { ignored: 0, tests: 0, duplicate: 0 };
  const kept = [];
  const rel = (leak) => ({ ...leak, File: toRelative(ctx.project.root, leak.File) });
  const sameValue = (leak) => `${leak.File}\u0000${leak.RuleID}\u0000${leak.Match}`;
  const current = raw.files.map(rel);
  const inCurrent = new Set(current.map(sameValue));
  const consider = (leak, fromHistory) => {
    if (ctx.project.isIgnored(leak.File)) dropped.ignored += 1;
    else if (ctx.options.excludeTests && isTestPath(leak.File)) dropped.tests += 1;
    else if (fromHistory && inCurrent.has(sameValue(leak))) dropped.duplicate += 1;
    else kept.push({ leak, fromHistory });
  };
  for (const leak of current) consider(leak, false);
  for (const leak of (raw.history ?? []).map(rel)) consider(leak, true);
  return { kept, dropped };
}

function isTestPath(file) {
  return TEST_DIR.test(file) || TEST_FILE.test(file) || JAVA_TEST_FILE.test(file);
}

/** gitleaks 는 실행 위치에 따라 상대 · 절대 경로를 섞어 돌려주므로 프로젝트 기준 상대 경로(/ 구분)로 맞춥니다. */
function toRelative(root, file) {
  const norm = (p) => p.replaceAll('\\', '/');
  const rootPosix = norm(root).replace(/\/$/, '');
  const f = norm(file).replace(/^\.\//, '');
  return f.toLowerCase().startsWith(`${rootPosix.toLowerCase()}/`) ? f.slice(rootPosix.length + 1) : f;
}
