// semgrep-injection — Semgrep CE 로 인젝션 계열 취약점을 찾습니다. 규칙은 rules/injection.yml 에 고정되어 있습니다.
import { defineModule } from 'safescan/sdk';
import { join } from 'node:path';

const EXTS = ['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.py', '.java'];
// 명령줄 길이 제한을 피하려고 파일을 나눠서 넘깁니다.
const BATCH_SIZE = 100;
// 곧바로 서버 장악 · 데이터 유출로 이어질 수 있는 CWE
const CRITICAL_CWE = new Set(['CWE-89', 'CWE-78', 'CWE-95', 'CWE-1336']);
/** @type {Record<string, 'high' | 'medium' | 'low'>} */
const SEVERITY = { ERROR: 'high', WARNING: 'medium', INFO: 'low' };
/** @type {Record<string, number>} */
const CONFIDENCE = { HIGH: 0.85, MEDIUM: 0.6, LOW: 0.4 };

export default defineModule({
  // 1) 전처리: 검사할 소스 파일 목록을 만듭니다. (.safescanignore 는 findFiles 가 적용합니다)
  async preprocess(ctx) {
    const files = await ctx.project.findFiles({ exts: EXTS });
    if (!files.length) ctx.skip('JS · TS · Python · Java 소스 파일이 없습니다');
    ctx.log.info(`대상 파일 ${files.length}개`);
    return { files };
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

  // 3) 후처리: Semgrep 결과 1건 = Finding 1건
  postprocess(ctx, raw) {
    return raw.results.map((r) => {
      const meta = r.extra.metadata ?? {};
      /** @type {string[]} */
      const cwe = toArray(meta.cwe).flatMap((c) => /CWE-\d+/.exec(c)?.[0] ?? []);
      const severity = SEVERITY[r.extra.severity] ?? 'low';
      return {
        ruleId: shortRuleId(r.check_id),
        title: r.extra.message.split(/(?<=[.。])\s/)[0],
        severity: severity === 'high' && cwe.some((c) => CRITICAL_CWE.has(c)) ? 'critical' : severity,
        confidence: CONFIDENCE[String(meta.confidence).toUpperCase()] ?? 0.5,
        description: r.extra.message,
        location: {
          file: r.path.replaceAll('\\', '/'),
          startLine: r.start.line,
          endLine: r.end.line,
          snippet: r.extra.lines?.trim() || undefined,
        },
        owasp: toArray(meta.owasp),
        cwe,
        remediation: r.extra.message,
        references: [],
        raw: { checkId: r.check_id, semgrepSeverity: r.extra.severity },
      };
    });
  },

  // 4) 검증: Semgrep 이 파싱 · 규칙 오류를 냈는지, 결과 수가 원본과 맞는지 확인합니다.
  verify(ctx, { raw, findings }) {
    const checks = [
      { name: 'Semgrep 오류 없음', passed: raw.errors.length === 0, detail: `오류 ${raw.errors.length}건` },
      { name: '결과 수 일치', passed: raw.results.length === findings.length, detail: `Semgrep ${raw.results.length}건 / 결과 ${findings.length}건` },
    ];
    return {
      checks,
      notes: [
        '패턴 매칭 기반이라 변수를 거쳐 전달된 값의 흐름은 대부분 추적하지 못합니다 (XSS 규칙만 taint 분석)',
        '같은 파일 안의 흐름만 봅니다 (파일 간 추적 없음)',
      ],
    };
  },
});

/** Semgrep 은 규칙 파일 경로를 check_id 앞에 붙입니다. 규칙 이름("safescan.…")만 남깁니다. */
function shortRuleId(/** @type {string} */ checkId) {
  const i = checkId.lastIndexOf('safescan.');
  return i < 0 ? checkId : checkId.slice(i);
}

/** @param {any} value */
function toArray(value) {
  return Array.isArray(value) ? value : value ? [value] : [];
}
