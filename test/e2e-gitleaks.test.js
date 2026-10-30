// 처음부터 끝까지: 더미 프로젝트 → gitleaks 모듈 검사 → 이슈 생성 → 코드 수정 → 재검사로 해결 · 재발견
// gitleaks 가 설치되어 있지 않으면 건너뜁니다.
import assert from 'node:assert/strict';
import { cp, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { createAiProvider } from '../src/core/ai.js';
import { runCommand } from '../src/core/exec.js';
import { loadIssues } from '../src/core/issues.js';
import { discoverModules, PACKAGE_ROOT } from '../src/core/registry.js';
import { runScan } from '../src/core/runner.js';

const hasGitleaks = await runCommand('gitleaks', ['version'], { timeoutMs: 20_000 }).then(() => true, () => false);
const SECRETS = ['q7Rk2Vt9LmX4pZs8Wn3Yb6Hc1Jd5Fg0A', 'PgSh0p2026x9Lq7Vz4Rt', 'Xq3vLm9Tz2Rb7Wn4Ys8Kc1Dp6Hg5Jf0A'];

test('gitleaks: 더미 프로젝트 검사 → 이슈 생성 → 수정 후 재검사', { skip: !hasGitleaks && 'gitleaks 미설치' }, async () => {
  const entry = (await discoverModules()).find((e) => e.id === 'gitleaks');
  // Windows 경로 길이 제한을 피하려고 저장소 안의 짧은 임시 폴더를 씁니다 (.gitignore 대상)
  const work = await mkdtemp(join(PACKAGE_ROOT, 'test', '.tmp-e2e-'));
  await cp(join(entry.dir, 'fixtures', 'vulnerable'), work, { recursive: true });
  const scan = () => runScan({ projectRoot: work, modules: [entry], aiProvider: createAiProvider({ provider: 'none' }) });
  const config = join(work, 'src', 'config.js');

  try {
    // 1) 첫 검사: 심어 둔 비밀 값 3건 → 이슈 3개
    const first = await scan();
    const mod = first.modules[0];
    assert.equal(mod.status, 'ok', mod.reason);
    assert.ok(mod.verify.checks.every((c) => c.passed), JSON.stringify(mod.verify.checks));
    assert.deepEqual(first.issues, { created: 3, changed: 0, reopened: 0, resolved: 0, open: 3 });
    assert.deepEqual(mod.findings.map((f) => f.location.file).sort(), ['scripts/seed-admin.js', 'src/config.js', 'src/config.js']);

    // 2) 그대로 재검사: 이슈가 늘지 않음
    assert.deepEqual((await scan()).issues, { created: 0, changed: 0, reopened: 0, resolved: 0, open: 3 });

    // 3) 비밀번호를 환경 변수로 옮기고 맨 위에 줄을 추가(줄 밀림) → 비밀번호 이슈만 해결, 나머지는 그대로 이어짐
    const original = await readFile(config, 'utf8');
    await writeFile(config, `// 수정됨\n${original.replace("'PgSh0p2026x9Lq7Vz4Rt'", 'process.env.DB_PASSWORD')}`);
    const fixed = await scan();
    assert.deepEqual(fixed.issues, { created: 0, changed: 0, reopened: 0, resolved: 1, open: 2 });

    const store = await loadIssues(join(work, '.safescan'));
    const resolved = store.issues.find((i) => i.status === 'resolved');
    assert.match(resolved.findings[0].location.snippet, /password/);
    assert.deepEqual(resolved.thread.map((t) => t.type), ['detected', 'resolved']);
    const jwtSecret = store.issues.find((i) => i.findings[0].location.snippet.startsWith('jwtSecret'));
    assert.equal(jwtSecret.status, 'discovered');
    assert.equal(jwtSecret.findings[0].location.startLine, 5, '줄이 밀린 위치로 갱신');
    assert.equal(jwtSecret.thread.length, 1, '줄만 밀렸을 때는 새 기록을 남기지 않음');

    // 4) 되돌리면 같은 이슈가 다시 열림
    await writeFile(config, original);
    assert.deepEqual((await scan()).issues, { created: 0, changed: 0, reopened: 1, resolved: 0, open: 3 });

    // 5) 저장된 어떤 파일에도 비밀 값 원문이 없어야 함
    const storeDir = join(work, '.safescan');
    const files = await readdir(storeDir, { recursive: true, withFileTypes: true });
    for (const f of files.filter((d) => d.isFile())) {
      const text = await readFile(join(f.parentPath, f.name), 'utf8');
      for (const secret of SECRETS) assert.ok(!text.includes(secret), `${f.name} 에 비밀 값 원문이 있습니다`);
    }
  } finally {
    await rm(work, { recursive: true, force: true });
  }
});
