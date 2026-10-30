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
