// semgrep-exception — Semgrep CE 로 예외 처리 결함을 찾습니다. 규칙은 rules/exception.yml 에 고정되어 있습니다.
import { defineModule } from 'safescan/sdk';
import { join } from 'node:path';

const EXTS = ['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.py', '.java'];
// 명령줄 길이 제한을 피하려고 파일을 나눠서 넘깁니다.
const BATCH_SIZE = 100;
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
  async postprocess(ctx, raw) {
    // 로그인하지 않은 Semgrep 은 extra.lines 에 코드 대신 "requires login" 을 넣습니다. 소스에서 직접 읽습니다.
    /** @type {Map<string, string[]>} */
    const sources = new Map();
    for (const file of new Set(raw.results.map((r) => toPosix(r.path)))) {
      sources.set(file, (await ctx.project.readText(file)).split(/\r?\n/));
    }

    return raw.results.map((r) => {
      const meta = r.extra.metadata ?? {};
      const file = toPosix(r.path);
      const snippet = sources.get(file)?.slice(r.start.line - 1, r.end.line).join('\n').trim();
      /** @type {string[]} */
      const cwe = toArray(meta.cwe).flatMap((c) => /CWE-\d+/.exec(c)?.[0] ?? []);
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
        cwe,
        remediation: r.extra.message,
        references: [],
        raw: { semgrepSeverity: r.extra.severity },
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
        'fail-open 규칙은 함수 이름(auth · verify · valid · check · token 등)으로 인증 · 검증 함수를 추정합니다',
        '일반 function 선언 · 메서드만 보며, 화살표 함수에 할당된 함수는 놓칠 수 있습니다',
      ],
    };
  },
});

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
