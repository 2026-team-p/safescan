// semgrep-exception — Semgrep CE 로 예외 처리 결함을 찾습니다. 규칙은 rules/exception.yml 에 고정되어 있습니다.
import { defineModule } from 'safescan/sdk';
import { join } from 'node:path';

// languages 옵션 → 검사할 확장자
/** @type {Record<string, string[]>} */
const LANG_EXTS = {
  javascript: ['.js', '.jsx', '.mjs', '.cjs'],
  typescript: ['.ts', '.tsx'],
  python: ['.py'],
  java: ['.java'],
};
// checks 옵션 → 규칙 메타데이터의 CWE. 목록에 없는 CWE 의 규칙은 항상 보고합니다.
/** @type {Record<string, string>} */
const CHECK_CWE = { 'empty-catch': 'CWE-390', 'stack-trace': 'CWE-209', 'fail-open': 'CWE-636' };
// excludeTests 옵션으로 빼는 테스트 폴더 · 파일
const TEST_DIR = /(^|\/)(tests?|__tests__|__mocks__|specs?|e2e|testdata)\//i;
const TEST_FILE = /[._-](test|spec)\.[cm]?[jt]sx?$|(^|\/)(test_[^/]+|[^/]+_test|conftest)\.py$/i;
const JAVA_TEST_FILE = /[A-Za-z0-9](Test|Tests|IT)\.java$/;
// 명령줄 길이 제한을 피하려고 파일을 나눠서 넘깁니다.
const BATCH_SIZE = 100;
/** @type {Record<string, 'high' | 'medium' | 'low'>} */
const SEVERITY = { ERROR: 'high', WARNING: 'medium', INFO: 'low' };
/** @type {Record<string, number>} */
const CONFIDENCE = { HIGH: 0.85, MEDIUM: 0.6, LOW: 0.4 };

export default defineModule({
  // 1) 전처리: 고른 언어의 소스 파일 목록을 만듭니다. (.safescanignore 는 findFiles 가 적용합니다)
  async preprocess(ctx) {
    const checks = toArray(ctx.options.checks);
    if (!checks.length) ctx.skip('찾을 결함을 하나 이상 고르세요');
    const languages = toArray(ctx.options.languages);
    const exts = languages.flatMap((lang) => LANG_EXTS[lang] ?? []);
    if (!exts.length) ctx.skip('검사할 언어를 하나 이상 고르세요');

    let files = await ctx.project.findFiles({ exts });
    if (ctx.options.excludeTests) {
      const before = files.length;
      files = files.filter((f) => !isTestPath(f));
      if (before > files.length) ctx.log.info(`테스트 파일 ${before - files.length}개는 검사하지 않습니다`);
    }
    if (!files.length) ctx.skip(`검사할 소스 파일이 없습니다 (언어: ${languages.join(', ')})`);
    ctx.log.info(`대상 파일 ${files.length}개 · 언어 ${languages.join(', ')} · 결함 ${checks.join(', ')}`);
    return { files, checks };
  },

  // 2) 툴: 고정 규칙으로 Semgrep 을 실행합니다. 원본 JSON 을 그대로 넘깁니다.
  async tool(ctx, { files }) {
    const rules = join(ctx.module.dir, 'rules');
    const results = [];
    const errors = [];
    let version;
    for (let i = 0; i < files.length; i += BATCH_SIZE) {
      const batch = files.slice(i, i + BATCH_SIZE);
      const args = ['scan', '--json', '--quiet', '--metrics=off', '--disable-version-check', '--config', rules, ...batch];
      const { stdout } = await ctx.exec('semgrep', args, {
        okExitCodes: [0, 1],
        quiet: true,
        env: { PYTHONUTF8: '1' }, // Windows 에서 한글 경로 · 출력이 깨지지 않게
      });
      let report;
      try {
        report = JSON.parse(stdout);
      } catch {
        throw new Error('Semgrep 출력을 JSON 으로 읽지 못했습니다');
      }
      results.push(...(report.results ?? []));
      errors.push(...(report.errors ?? []));
      version ??= report.version;
    }
    return { results, errors, version };
  },

  // 3) 후처리: Semgrep 결과 1건 = Finding 1건. 고르지 않은 종류(checks)의 규칙 결과는 뺍니다.
  async postprocess(ctx, raw, { checks }) {
    const results = raw.results.filter((r) => wanted(r, checks));
    // 로그인하지 않은 Semgrep 은 extra.lines 에 코드 대신 "requires login" 을 넣습니다. 소스에서 직접 읽습니다.
    /** @type {Map<string, string[]>} */
    const sources = new Map();
    for (const file of new Set(results.map((r) => toPosix(r.path)))) {
      sources.set(file, (await ctx.project.readText(file)).split(/\r?\n/));
    }

    return results.map((r) => {
      const meta = r.extra.metadata ?? {};
      const file = toPosix(r.path);
      const snippet = sources.get(file)?.slice(r.start.line - 1, r.end.line).join('\n').trim();
      return {
        ruleId: shortRuleId(r.check_id),
        title: r.extra.message.split(/(?<=[.。])\s/)[0],
        severity: SEVERITY[r.extra.severity] ?? 'low',
        confidence: CONFIDENCE[String(meta.confidence).toUpperCase()] ?? 0.5,
        description: r.extra.message,
        location: {
          file,
          startLine: r.start.line,
          endLine: r.end.line,
          snippet: snippet || undefined,
        },
        owasp: toArray(meta.owasp),
        cwe: cweOf(r),
        remediation: r.extra.message,
        references: [],
        raw: { semgrepSeverity: r.extra.severity },
      };
    });
  },

  // 4) 검증: Semgrep 이 파싱 · 규칙 오류를 냈는지, 결과 수가 원본과 맞는지 확인합니다.
  verify(ctx, { input, raw, findings }) {
    const unselected = raw.results.filter((r) => !wanted(r, input.checks)).length;
    const checks = [
      { name: 'Semgrep 오류 없음', passed: raw.errors.length === 0, detail: `오류 ${raw.errors.length}건` },
      {
        name: '결과 수 일치',
        passed: raw.results.length === findings.length + unselected,
        detail: `Semgrep ${raw.results.length}건 = 결과 ${findings.length}건 + 고르지 않은 종류 ${unselected}건`,
      },
    ];
    return {
      checks,
      notes: [
        'fail-open 규칙은 함수 이름(auth · verify · valid · check · token 등)으로 인증 · 검증 함수를 추정합니다',
        '일반 function 선언 · 메서드만 보며, 화살표 함수에 할당된 함수는 놓칠 수 있습니다',
      ],
    };
  },
});

/** 규칙 CWE 가 고른 종류(checks)에 들어가는지. 종류를 알 수 없는 규칙은 보고합니다. */
function wanted(/** @type {any} */ r, /** @type {string[]} */ checks) {
  const cwe = cweOf(r);
  const kinds = Object.keys(CHECK_CWE).filter((k) => cwe.includes(CHECK_CWE[k]));
  return !kinds.length || kinds.some((k) => checks.includes(k));
}

/** @returns {string[]} */
function cweOf(/** @type {any} */ r) {
  return toArray(r.extra?.metadata?.cwe).flatMap((c) => /CWE-\d+/.exec(c)?.[0] ?? []);
}

function isTestPath(/** @type {string} */ file) {
  return TEST_DIR.test(file) || TEST_FILE.test(file) || JAVA_TEST_FILE.test(file);
}

function toPosix(/** @type {string} */ p) {
  return p.replaceAll('\\', '/');
}

/** Semgrep 은 규칙 파일 경로를 check_id 앞에 붙입니다. 규칙 이름("safescan.…")만 남깁니다. */
function shortRuleId(/** @type {string} */ checkId) {
  const i = checkId.lastIndexOf('safescan.');
  return i < 0 ? checkId : checkId.slice(i);
}

/** @param {any} value */
function toArray(value) {
  return Array.isArray(value) ? value : value ? [value] : [];
}
