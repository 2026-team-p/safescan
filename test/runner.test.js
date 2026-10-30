import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createAiProvider } from '../src/core/ai.js';
import { discoverModules } from '../src/core/registry.js';
import { runScan } from '../src/core/runner.js';

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
const PROJECT = join(FIXTURES, 'project');
const entries = await discoverModules(join(FIXTURES, 'modules'));
const mockAi = () => createAiProvider({
  provider: 'mock',
  model: 'claude-haiku-5-5',
  mockReply: () => '```json\n{"label":"분류됨"}\n```',
});

async function scan(ids, opts = {}) {
  const events = [];
  const result = await runScan({
    projectRoot: PROJECT,
    modules: ids.map((id) => entries.find((e) => e.id === id)),
    aiProvider: mockAi(),
    onEvent: (e) => events.push(e),
    storeDir: null,
    ...opts,
  });
  return { result, events, mod: (id) => result.modules.find((m) => m.moduleId === id) };
}

test('테스트용 모듈의 매니페스트가 올바르다', () => {
  for (const e of entries) assert.deepEqual(e.errors, [], e.id);
});

test('4단계를 순서대로 실행하고 결과 · 기록을 남긴다', async () => {
  const { result, events, mod } = await scan(['fake-ok']);
  const m = mod('fake-ok');
  assert.equal(m.status, 'ok', m.reason);
  assert.deepEqual(m.stages.map((s) => `${s.stage}:${s.status}`), ['preprocess:ok', 'tool:ok', 'postprocess:ok', 'verify:ok']);
  assert.deepEqual(
    events.filter((e) => e.type.startsWith('stage:')).map((e) => `${e.type}/${e.stage}`),
    ['start/preprocess', 'end/preprocess', 'start/tool', 'end/tool', 'start/postprocess', 'end/postprocess', 'start/verify', 'end/verify']
      .map((s) => `stage:${s}`),
  );
  assert.equal(events[0].type, 'run:start');
  assert.deepEqual(events[0].profile.ignore, ['generated/']);
  assert.equal(events.at(-1).type, 'run:end');

  // 같은 fingerprint 는 하나로 합치고, 위험도 순으로 정렬
  assert.deepEqual(m.findings.map((f) => f.ruleId), ['fake.xss', 'fake.low']);
  assert.equal(m.findings[0].title, '가짜 분류됨 기본');
  assert.equal(m.findings[0].location.file, 'src/app.js');
  assert.match(m.findings[0].fingerprint, /^[0-9a-f]{16}$/);
  assert.equal(events.filter((e) => e.type === 'finding').length, 2);

  // 검증 단계: 모듈 자체 점검 + 프레임워크 자동 기록
  assert.equal(m.verify.checks[0].passed, true);
  assert.equal(m.metrics.confidence, 0.75);
  assert.deepEqual(m.metrics.bySeverity, { critical: 0, high: 1, medium: 0, low: 1 });
  assert.equal(m.aiCalls.length, 1);
  assert.equal(m.aiCalls[0].stage, 'postprocess');
  assert.equal(m.aiCalls[0].purpose, '설명 보강');
  assert.ok(m.metrics.aiCostUsd > 0);
  assert.equal(m.execCalls.length, 1);
  assert.equal(m.execCalls[0].code, 0);
  assert.match(m.toolVersions.node, /^v\d+/);

  assert.ok(result.profile.frameworks.includes('express'));
  assert.ok(result.profile.languages.includes('javascript'));
});

test('모듈 옵션은 기본값 위에 덮이고, 정의되지 않은 옵션은 실패', async () => {
  const ok = await scan(['fake-ok'], { options: { 'fake-ok': { label: '사용자' } } });
  assert.equal(ok.mod('fake-ok').findings[0].title, '가짜 분류됨 사용자');
  const bad = await scan(['fake-ok'], { options: { 'fake-ok': { nope: 1 } } });
  assert.equal(bad.mod('fake-ok').status, 'failed');
});

test('실행 결과에 쓴 옵션 · 검사 종류 · AI 정보를 남긴다', async () => {
  const { result, mod } = await scan(['fake-ok'], { options: { 'fake-ok': { label: '사용자' } }, kind: 'verify' });
  assert.deepEqual(mod('fake-ok').options, { label: '사용자' });
  assert.equal(result.kind, 'verify');
  assert.deepEqual(result.ai, { available: true, provider: 'mock', model: 'claude-haiku-5-5' });
  assert.equal(mod('fake-ok').accuracy, undefined, '정답표가 없으면 정확도를 재지 않는다');
});

test('프로젝트 정답표(safescan.expected.json)가 있으면 이번 검사의 정확도를 잰다', async () => {
  const root = await mkdtemp(join(tmpdir(), 'safescan-expected-'));
  try {
    await cp(PROJECT, root, { recursive: true });
    await writeFile(join(root, 'safescan.expected.json'), JSON.stringify({
      modules: { 'fake-ok': { findings: [{ ruleId: 'fake.xss', file: 'src/app.js', line: 3 }, { ruleId: 'fake.missing' }] } },
    }));
    const { result, mod } = await scan(['fake-ok', 'fake-skip'], { projectRoot: root });
    const a = mod('fake-ok').accuracy;
    assert.equal(result.expectedFile, 'safescan.expected.json');
    assert.deepEqual([a.source, a.tp, a.fp, a.fn, a.precision, a.recall, a.f1], ['project', 1, 1, 1, 0.5, 0.5, 0.5]);
    assert.deepEqual(a.missed, [{ ruleId: 'fake.missing' }]);
    assert.equal(a.extra[0].ruleId, 'fake.low');
    assert.equal(mod('fake-skip').accuracy, undefined, '정답표에 없는 모듈 · 건너뛴 모듈은 재지 않는다');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('한 모듈의 실패 · 건너뜀이 다른 모듈에 영향을 주지 않는다', async () => {
  const ids = ['fake-skip', 'fake-fail', 'fake-ok', 'fake-missing-tool'];
  const { result, mod } = await scan(ids, { concurrency: 2 });
  assert.deepEqual(result.modules.map((m) => m.moduleId), ids);

  assert.equal(mod('fake-skip').status, 'skipped');
  assert.equal(mod('fake-skip').reason, '대상 없음');
  assert.equal(mod('fake-fail').status, 'failed');
  assert.match(mod('fake-fail').reason, /도구 고장/);
  assert.equal(mod('fake-fail').stages.at(-1).stage, 'tool');
  assert.equal(mod('fake-ok').status, 'ok');
  assert.equal(mod('fake-missing-tool').status, 'skipped');
  assert.match(mod('fake-missing-tool').reason, /설치 안내 문구/);
});

test('AI 가 필요한 모듈은 AI 가 없으면 건너뛴다', async () => {
  const none = await scan(['fake-ai-required'], { aiProvider: createAiProvider({ provider: 'none' }) });
  assert.equal(none.mod('fake-ai-required').status, 'skipped');
  const withAi = await scan(['fake-ai-required']);
  assert.equal(withAi.mod('fake-ai-required').status, 'ok');
});

test('잘못된 Finding: 일반 실행은 버리고, strict 는 실패', async () => {
  const loose = (await scan(['fake-bad-finding'])).mod('fake-bad-finding');
  assert.equal(loose.status, 'ok');
  assert.deepEqual(loose.findings.map((f) => f.ruleId), ['good']);

  const strict = (await scan(['fake-bad-finding'], { strict: true })).mod('fake-bad-finding');
  assert.equal(strict.status, 'failed');
  assert.match(strict.reason, /severity/);
});

test('제한 시간을 넘으면 timeout 으로 끝난다', async () => {
  const started = Date.now();
  const { mod } = await scan(['fake-timeout']);
  assert.equal(mod('fake-timeout').status, 'timeout');
  assert.ok(Date.now() - started < 10_000);
});

test('결과를 run.json · events.jsonl 로 저장한다', async () => {
  const storeDir = await mkdtemp(join(tmpdir(), 'safescan-test-'));
  try {
    const { result, events } = await scan(['fake-ok'], { storeDir });
    assert.ok(result.savedTo);
    const saved = JSON.parse(await readFile(join(result.savedTo, 'run.json'), 'utf8'));
    assert.equal(saved.runId, result.runId);
    assert.equal(saved.modules[0].findings.length, 2);
    const lines = (await readFile(join(result.savedTo, 'events.jsonl'), 'utf8')).trim().split('\n');
    assert.equal(lines.length, events.length);
  } finally {
    await rm(storeDir, { recursive: true, force: true });
  }
});
