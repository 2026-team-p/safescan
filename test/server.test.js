// 로컬 UI 서버 (API 키 방식): API · 보안 확인 · 검사 → 이슈 → AI 수정안(작업) → 적용 → 재검증 흐름
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createAiProvider } from '../src/core/ai.js';
import { PACKAGE_ROOT } from '../src/core/registry.js';
import { startServer } from '../src/server/index.js';
import { applyEdits, finalizeProposal, maskLines, prepareFile, unmask } from '../src/server/ai-tasks.js';

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));

// 가짜 AI: 추천에는 모듈 목록, 수정안에는 eval( 을 JSON.parse( 로 바꾼 파일을 돌려줍니다.
const mockAi = createAiProvider({
  provider: 'mock',
  model: 'claude-haiku-5-5',
  mockReply: (req) => {
    if (req.purpose === '모듈 자동 추천') {
      return JSON.stringify({ selected: ['fake-eval', 'no-such-module'], reasoning: '이 프로젝트는 express 서버로 판단됩니다. eval 검사를 켭니다.' });
    }
    if (req.purpose === '설명 보강') return JSON.stringify({ label: '분류됨' });
    const file = /```\n([\s\S]*)\n```/.exec(req.prompt)[1];
    return JSON.stringify({ explanation: 'eval 을 JSON.parse 로 바꿨습니다.', content: file.replace('eval(', 'JSON.parse(') });
  },
});

let server;
let work;

before(async () => {
  work = await mkdtemp(join(PACKAGE_ROOT, 'test', '.tmp-server-'));
  await cp(join(FIXTURES, 'project'), work, { recursive: true });
  await writeFile(join(work, 'src', 'parse.js'), 'const input = "{}";\r\nmodule.exports = eval(input);\r\n');
  server = await startServer({ projectRoot: work, port: 0, modulesDir: join(FIXTURES, 'modules'), aiProvider: mockAi, uiDir: join(work, 'no-ui') });
});

after(async () => {
  await server?.close();
  await rm(work, { recursive: true, force: true });
});

const json = (path, body) => fetch(server.url + path, {
  method: body === undefined ? 'GET' : 'POST',
  headers: { 'x-safescan-token': server.token, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
  body: body === undefined ? undefined : JSON.stringify(body),
}).then(async (r) => ({ status: r.status, data: await r.json() }));

async function untilClosed(runId) {
  const text = await fetch(`${server.url}/api/runs/${runId}/events?token=${server.token}`).then((r) => r.text());
  return text.trim().split('\n\n').map((block) => JSON.parse(block.split('\n').find((l) => l.startsWith('data: ')).slice(6)));
}

async function untilJobEnds(id) {
  for (let i = 0; i < 100; i += 1) {
    const { job } = (await json(`/api/jobs/${id}`)).data;
    if (!['queued', 'working'].includes(job.status)) return job;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('작업이 끝나지 않았습니다');
}

test('외부 Host · 다른 Origin · 토큰 없음 · JSON 이 아닌 요청은 막는다', async () => {
  const raw = (headers) => new Promise((ok) => {
    const req = request({ host: '127.0.0.1', port: server.port, path: '/api/state', headers }, (res) => {
      res.resume();
      ok(res.statusCode);
    });
    req.end();
  });
  assert.equal(await raw({ host: `evil.example:${server.port}` }), 403);
  assert.equal(await raw({ host: `localhost:${server.port}` }), 401, '토큰 없음');
  assert.equal(await raw({ host: `localhost:${server.port}`, 'x-safescan-token': 'f'.repeat(32) }), 401, '틀린 토큰');
  const cross = await fetch(`${server.url}/api/runs`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://evil.example', 'x-safescan-token': server.token }, body: '{}' });
  assert.equal(cross.status, 403);
  const form = await fetch(`${server.url}/api/runs`, { method: 'POST', headers: { 'Content-Type': 'text/plain', 'x-safescan-token': server.token }, body: '{}' });
  assert.equal(form.status, 415);
  assert.match(server.uiUrl, /\/\?token=[0-9a-f]{32}$/);
});

test('상태: 프로젝트 분석 · 모듈 준비 상태 · AI 방식', async () => {
  const { status, data } = await json('/api/state');
  assert.equal(status, 200);
  assert.ok(data.profile.frameworks.includes('express'));
  const evalModule = data.modules.find((m) => m.id === 'fake-eval');
  assert.equal(evalModule.ready, true);
  assert.match(evalModule.toolVersions.node, /^v\d+/);
  const missing = data.modules.find((m) => m.id === 'fake-missing-tool');
  assert.equal(missing.ready, false);
  assert.match(missing.blockedReason, /미설치/);
  assert.deepEqual(data.assistant, { mode: 'api', model: 'claude-haiku-5-5', client: null, autoDelivery: false, canPatch: true });
  assert.ok(data.patchOptions.stability);
});

test('AI 추천 작업: 실행 가능한 모듈만 고르고 비용을 남긴다', async () => {
  const { data } = await json('/api/recommend', {});
  assert.equal(data.job.via, 'api');
  const job = await untilJobEnds(data.job.id);
  assert.equal(job.status, 'done');
  assert.equal(job.result.source, 'ai');
  assert.deepEqual(job.result.selected, ['fake-eval']);
  assert.equal(job.aiCalls.length, 1);
  assert.ok(job.aiCalls[0].costUsd > 0);
});

test('검사 → 이슈 → AI 수정안 → 적용 → 재검사로 조치 완료', async () => {
  const started = await json('/api/runs', { modules: ['fake-eval'] });
  assert.equal(started.status, 200);
  assert.equal((await json('/api/runs', { modules: ['fake-eval'] })).status, 409, '검사 중에는 새 검사를 막는다');

  const events = await untilClosed(started.data.runId);
  assert.equal(events.at(-1).type, 'run:closed');
  assert.equal(events.find((e) => e.type === 'run:end').result.issues.created, 1);

  const issue = (await json('/api/issues')).data.issues.find((i) => i.moduleId === 'fake-eval');
  assert.equal(issue.status, 'discovered');

  const moved = await json(`/api/issues/${issue.id}/status`, { status: 'in_progress' });
  assert.equal(moved.data.issue.status, 'in_progress');
  assert.match(moved.data.issue.thread.at(-1).message, /해결 중으로/);

  const requested = await json(`/api/issues/${issue.id}/patch`, { options: ['stability', 'bogus'] });
  assert.equal(requested.status, 200, requested.data.error);
  const job = await untilJobEnds(requested.data.job.id);
  assert.equal(job.status, 'done', job.error);
  const { patch } = job.result;
  assert.match(patch.proposed, /JSON\.parse\(input\)/);
  assert.ok(patch.proposed.includes('\r\n'), '원본 줄바꿈(CRLF)을 지킨다');
  const thread = (await json('/api/issues')).data.issues.find((i) => i.id === issue.id).thread;
  assert.deepEqual(thread.slice(-2).map((t) => t.type), ['patch_requested', 'patch_proposed']);
  assert.deepEqual(thread.at(-2).data.options, ['안정성 최우선']);

  const accepted = await json(`/api/issues/${issue.id}/patch/${patch.id}/accept`, {});
  assert.equal(accepted.status, 200, accepted.data.error);
  await untilClosed(accepted.data.runId);
  assert.equal(await readFile(join(work, 'src', 'parse.js'), 'utf8'), patch.proposed);

  const final = (await json('/api/issues')).data.issues.find((i) => i.id === issue.id);
  assert.equal(final.status, 'resolved');
  assert.deepEqual(final.thread.map((t) => t.type), ['detected', 'status', 'patch_requested', 'patch_proposed', 'patch_accepted', 'resolved']);
});

test('그 사이 파일이 바뀌면 수정안을 적용하지 않는다', async () => {
  await writeFile(join(work, 'src', 'again.js'), 'module.exports = eval("1");\n');
  const run = await json('/api/runs', { modules: ['fake-eval'] });
  await untilClosed(run.data.runId);
  const issue = (await json('/api/issues')).data.issues.find((i) => i.status === 'discovered');
  const { data } = await json(`/api/issues/${issue.id}/patch`, {});
  const job = await untilJobEnds(data.job.id);
  await writeFile(join(work, 'src', 'again.js'), 'module.exports = eval("2");\n');
  const accepted = await json(`/api/issues/${issue.id}/patch/${job.result.patch.id}/accept`, {});
  assert.equal(accepted.status, 409);
  assert.equal(await readFile(join(work, 'src', 'again.js'), 'utf8'), 'module.exports = eval("2");\n');
});

test('모듈 옵션: 저장한 값이 검사에 쓰이고, 기본값으로 되돌리면 저장 파일에서 빠진다', async () => {
  assert.equal((await json('/api/settings/options', { moduleId: 'fake-ok', options: { nope: 1 } })).status, 400);
  const saved = await json('/api/settings/options', { moduleId: 'fake-ok', options: { label: '저장값' } });
  assert.deepEqual(saved.data.options, { label: '저장값' });
  assert.deepEqual((await json('/api/state')).data.settings.options['fake-ok'], { label: '저장값' });

  const { data } = await json('/api/runs', { modules: ['fake-ok'] });
  const end = (await untilClosed(data.runId)).find((e) => e.type === 'run:end');
  assert.deepEqual(end.result.modules[0].options, { label: '저장값' });
  const override = await json('/api/runs', { modules: ['fake-ok'], options: { 'fake-ok': { label: '이번만' } } });
  const end2 = (await untilClosed(override.data.runId)).find((e) => e.type === 'run:end');
  assert.deepEqual(end2.result.modules[0].options, { label: '이번만' }, '요청 값이 저장 값보다 우선');

  await json('/api/settings/options', { moduleId: 'fake-ok', options: { label: '기본' } });
  assert.equal((await json('/api/state')).data.settings.options['fake-ok'], undefined);
});

test('기록: 검사별 수치 요약 · 지난 검사 상세 · AI 작업과 모델별 수치', async () => {
  const { runs, aiJobs, models } = (await json('/api/history')).data;
  const scans = runs.filter((r) => r.modules.some((m) => m.id === 'fake-ok'));
  assert.ok(scans.length >= 2);
  const row = scans.at(-1);
  assert.equal(row.kind, 'scan');
  assert.equal(row.findings, 2);
  assert.equal(row.confidence, 0.75);
  assert.deepEqual(row.aiModels, ['claude-haiku-5-5']);
  assert.ok(row.tokens > 0 && row.costUsd > 0);
  assert.ok(runs.some((r) => r.kind === 'verify'), '수정 후 재검사도 기록에 남는다');

  const detail = (await json(`/api/runs/${row.runId}`)).data;
  assert.equal(detail.result.runId, row.runId);
  assert.ok('fake-ok' in detail.bench);
  assert.equal((await json('/api/runs/20200101-000000-0000')).status, 404);

  // 서버를 다시 켜 메모리에 없는 지난 검사도 저장된 이벤트로 다시 볼 수 있다
  const again = await startServer({ projectRoot: work, port: 0, modulesDir: join(FIXTURES, 'modules'), aiProvider: mockAi, uiDir: join(work, 'no-ui') });
  try {
    const text = await fetch(`${again.url}/api/runs/${row.runId}/events?token=${again.token}`).then((r) => r.text());
    const types = text.trim().split('\n\n').map((b) => JSON.parse(b.split('\n').find((l) => l.startsWith('data: ')).slice(6)).type);
    assert.equal(types[0], 'run:start');
    assert.ok(types.includes('run:end'));
    assert.equal(types.at(-1), 'run:closed');
    assert.equal((await fetch(`${again.url}/api/runs/20200101-000000-0000/events?token=${again.token}`)).status, 404);
  } finally {
    await again.close();
  }

  const patch = aiJobs.find((j) => j.kind === 'patch' && j.consumed === 'accepted');
  assert.equal(patch.via, 'api');
  assert.equal(patch.model, 'claude-haiku-5-5');
  assert.equal(patch.verify, 'resolved');
  assert.equal(patch.moduleId, 'fake-eval');
  assert.ok(aiJobs.some((j) => j.kind === 'recommend' && j.status === 'done'));
  const stat = models.find((m) => m.via === 'api');
  assert.ok(stat.patch >= 2 && stat.accepted === 1 && stat.resolved === 1 && stat.costUsd > 0);
});

test('비밀 값 가리기: 지정한 줄의 문자열만 자리 표시자로 바꾸고 되돌린다', () => {
  const text = "const a = 'keep';\nconst secret = 'abc123', other = \"x\\\"y\";\nconst b = 'keep2';";
  const { text: masked, masks } = maskLines(text, [2]);
  assert.ok(!masked.includes('abc123'));
  assert.ok(masked.includes("'keep'") && masked.includes("'keep2'"));
  assert.equal(masks.size, 2);
  assert.equal(unmask(masked, masks), text);
});

test('편집 적용: 가린 상태에서 고치고, 원래 비밀 값 · 줄바꿈으로 되돌린다', () => {
  const original = "const jwt = 'jwt-secret-1';\r\nconst pw = 'pw-secret-2';\r\n";
  const prepared = prepareFile('a.js', original, [1, 2]);
  assert.ok(!prepared.text.includes('secret'));
  const edited = applyEdits(prepared.text, [{ old_text: "const pw = '__SAFESCAN_SECRET_2__';", new_text: 'const pw = process.env.PW;' }]);
  assert.equal(finalizeProposal(prepared, edited), "const jwt = 'jwt-secret-1';\r\nconst pw = process.env.PW;\r\n");
  assert.throws(() => applyEdits(prepared.text, [{ old_text: 'const', new_text: 'let' }]), /2곳/);
  assert.throws(() => finalizeProposal(prepared, prepared.text.replace('__SAFESCAN_SECRET_1__', '__SAFESCAN_SECRET_1')), /깨졌습니다/);
  assert.throws(() => finalizeProposal(prepared, prepared.text), /바뀐 내용이 없습니다/);
});
