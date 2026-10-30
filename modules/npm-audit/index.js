// npm-audit — 4단계 계약을 보여 주는 기준 예시 모듈. 규칙: docs/MODULE_GUIDE.md
import { defineModule } from 'safescan/sdk';

const SEVERITY = { critical: 'critical', high: 'high', moderate: 'medium', low: 'low', info: 'low' };
const RANK = { low: 0, medium: 1, high: 2, critical: 3 };
const TOP_LEVEL_KEY = /^\s*"(node_modules\/(?:@[^/"]+\/)?[^/"]+)":\s*\{/;

export default defineModule({
  // 1) 전처리: lockfile 을 찾고, npm audit 결과에 없는 설치 버전과 줄 번호를 미리 뽑아 둡니다.
  async preprocess(ctx) {
    const lockfiles = await ctx.project.findFiles({ names: ['package-lock.json', 'npm-shrinkwrap.json'] });
    if (!lockfiles.length) ctx.skip('package-lock.json 이 없습니다');
    ctx.log.info(`lockfile ${lockfiles.length}개: ${lockfiles.join(', ')}`);

    const targets = [];
    for (const file of lockfiles) {
      const text = await ctx.project.readText(file);
      const slash = file.lastIndexOf('/');
      targets.push({
        file,
        dir: slash < 0 ? '.' : file.slice(0, slash),
        versions: installedVersions(JSON.parse(text)),
        lines: lineNumbers(text),
      });
    }
    return { targets };
  },

  // 2) 툴: npm audit 를 lockfile 마다 실행합니다. 원본 JSON 을 그대로 넘깁니다.
  async tool(ctx, { targets }) {
    const reports = [];
    for (const target of targets) {
      const args = ['audit', '--json', '--package-lock-only'];
      if (ctx.options.omitDev) args.push('--omit=dev');
      // 취약점이 있으면 종료 코드가 1 이므로 정상으로 봅니다.
      const { stdout } = await ctx.exec('npm', args, { cwd: target.dir, okExitCodes: [0, 1], quiet: true });
      let report;
      try {
        report = JSON.parse(stdout);
      } catch {
        throw new Error(`npm audit 출력을 JSON 으로 읽지 못했습니다 (${target.file})`);
      }
      if (report.error) throw new Error(`npm audit 오류 (${target.file}): ${report.error.summary ?? report.error.code}`);
      reports.push({ file: target.file, report });
    }
    return reports;
  },

  // 3) 후처리: 보안 권고 1건 = Finding 1건. 최소 위험도 · 직접 의존성 옵션에 맞지 않는 권고는 뺍니다.
  postprocess(ctx, reports, { targets }) {
    const findings = [];
    let skipped = 0;
    for (const { file, report } of reports) {
      const target = targets.find((t) => t.file === file);
      for (const vuln of Object.values(report.vulnerabilities ?? {})) {
        const fix = vuln.fixAvailable;
        const fixedIn = typeof fix === 'object' && fix.name === vuln.name ? fix.version : undefined;
        for (const via of vuln.via) {
          // 문자열은 "다른 패키지를 거쳐 들어온 취약점" 표시입니다. 원인 패키지 항목에서 따로 보고됩니다.
          if (typeof via === 'string') continue;
          if (!wanted(ctx.options, vuln, via)) {
            skipped += 1;
            continue;
          }
          findings.push({
            ruleId: via.url?.match(/GHSA-[\w-]+$/)?.[0] ?? `npm-${via.source}`,
            title: via.title,
            severity: SEVERITY[via.severity] ?? 'low',
            // 권고 DB 는 신뢰도가 높지만, 실제로 그 함수를 호출하는지(도달 가능성)는 보지 않습니다.
            confidence: vuln.isDirect ? 0.9 : 0.75,
            description: `${via.name} ${via.range} 범위의 버전이 설치되어 있습니다.`,
            location: { file, startLine: target?.lines[`node_modules/${via.name}`] },
            dependency: { name: via.name, version: target?.versions[via.name], fixedIn },
            owasp: ['A03:2025'],
            cwe: via.cwe ?? [],
            remediation: fixedIn
              ? `${via.name}@${fixedIn} 이상으로 올리세요 (npm audit fix)`
              : fix ? 'npm audit fix 로 해결할 수 있습니다' : '아직 수정 버전이 없습니다. 대체 패키지를 검토하세요',
            references: via.url ? [via.url] : [],
            raw: { source: via.source, range: via.range, cvss: via.cvss, isDirect: vuln.isDirect },
          });
        }
      }
    }
    if (skipped) ctx.log.info(`옵션(최소 위험도 · 직접 의존성)에 맞지 않는 권고 ${skipped}건은 뺐습니다`);
    return findings;
  },

  // 4) 검증: npm 이 보고한 취약 패키지 수와 결과가 맞는지 스스로 확인합니다.
  verify(ctx, { raw, findings }) {
    const checks = raw.map(({ file, report }) => {
      const expected = Object.values(report.vulnerabilities ?? {})
        .filter((v) => v.via.some((x) => typeof x === 'object' && wanted(ctx.options, v, x))).length;
      const actual = new Set(findings.filter((f) => f.location?.file === file).map((f) => f.dependency?.name)).size;
      return { name: `${file} 패키지 수 일치`, passed: expected === actual, detail: `npm ${expected}개 / 결과 ${actual}개` };
    });
    return { checks, notes: ['도달 가능성(실제 호출 여부)은 확인하지 않습니다'] };
  },
});

/** 옵션으로 고른 범위의 권고인지: 최소 위험도 이상이고, directOnly 면 package.json 에 직접 적은 패키지 */
function wanted(options, vuln, via) {
  if (options.directOnly && !vuln.isDirect) return false;
  return RANK[SEVERITY[via.severity] ?? 'low'] >= (RANK[options.minSeverity] ?? 0);
}

/** lockfile v2/v3 는 packages, v1 은 dependencies 에서 최상위 설치 버전을 읽습니다. */
function installedVersions(lock) {
  const versions = {};
  for (const [key, pkg] of Object.entries(lock.packages ?? {})) {
    const m = /^node_modules\/((?:@[^/]+\/)?[^/]+)$/.exec(key);
    if (m && pkg.version) versions[m[1]] = pkg.version;
  }
  for (const [name, dep] of Object.entries(lock.dependencies ?? {})) {
    versions[name] ??= dep.version;
  }
  return versions;
}

function lineNumbers(text) {
  const lines = {};
  text.split('\n').forEach((line, i) => {
    const m = TOP_LEVEL_KEY.exec(line);
    if (m) lines[m[1]] ??= i + 1;
  });
  return lines;
}
