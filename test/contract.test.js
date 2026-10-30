// modules/ 의 모든 모듈이 계약을 지키는지 확인합니다. 새 모듈을 추가하면 자동으로 포함됩니다.
import assert from 'node:assert/strict';
import { access, mkdtemp, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { readExpected } from '../src/core/bench.js';
import { discoverModules, loadModule, PACKAGE_ROOT, scaffoldModule } from '../src/core/registry.js';

const entries = await discoverModules();

test('modules/ 에 모듈이 하나 이상 있다', () => {
  assert.ok(entries.length > 0);
});

for (const entry of entries) {
  test(`${entry.id}: 계약을 지킨다`, async () => {
    assert.deepEqual(entry.errors, []);
    await loadModule(entry);
    await access(join(entry.dir, 'README.md'));
    await readExpected(entry.dir);
    const files = await readdir(join(entry.dir, 'fixtures', 'vulnerable'));
    assert.ok(files.some((f) => f !== '.gitkeep'), 'fixtures/vulnerable 이 비어 있습니다');
  });
}

test('safescan new 로 만든 모듈은 바로 불러올 수 있다', async () => {
  // 'safescan/sdk' import 가 풀리도록 패키지 안에 임시 폴더를 만듭니다.
  const dir = await mkdtemp(join(PACKAGE_ROOT, 'test', '.tmp-'));
  try {
    await scaffoldModule({ id: 'demo-mod', name: '데모', category: 'sast', modulesDir: dir });
    const [entry] = await discoverModules(dir);
    assert.equal(entry.id, 'demo-mod');
    assert.deepEqual(entry.errors, []);
    assert.equal(entry.manifest.name, '데모');
    assert.equal(entry.manifest.category, 'sast');
    const def = await loadModule(entry);
    assert.equal(typeof def.verify, 'function');

    await assert.rejects(scaffoldModule({ id: 'demo-mod', modulesDir: dir }), /이미 있는/);
    await assert.rejects(scaffoldModule({ id: 'Bad_Id', modulesDir: dir }), /kebab/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
