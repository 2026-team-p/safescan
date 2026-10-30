// safescan mcp: Claude Code 대신 MCP 클라이언트를 붙여, 화면 버튼 → 채널 알림 → 도구로 처리 → 화면 반영 흐름을 확인합니다.
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createAiProvider } from '../src/core/ai.js';
import { PACKAGE_ROOT } from '../src/core/registry.js';
import { startMcp } from '../src/mcp/index.js';

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
const BIN = join(PACKAGE_ROOT, 'bin', 'safescan.js');

let work;
let client;
let mcp;
const notes = [];
const opened = [];

before(async () => {
  work = await mkdtemp(join(PACKAGE_ROOT, 'test', '.tmp-mcp-'));
  await cp(join(FIXTURES, 'project'), work, { recursive: true });
  await writeFile(join(work, 'src', 'parse.js'), 'const input = "{}";\nmodule.exports = eval(input);\n');
  await writeFile(join(work, 'src', 'other.js'), 'module.exports = eval("1 + 1");\n');

  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  mcp = await startMcp({
    projectRoot: work, port: 0, transport: serverSide, modulesDir: join(FIXTURES, 'modules'),
    aiProvider: createAiProvider({ provider: 'none' }), openUrl: (url) => opened.push(url),
  });
  client = new Client({ name: 'claude-code-test', version: '9.9.9' });
  client.fallbackNotificationHandler = async (n) => {
    notes.push(n);
  };
  await client.connect(clientSide);
});

after(async () => {
  await client?.close();
  await mcp?.close();
  await rm(work, { recursive: true, force: true });
});

const http = (path, body) => fetch(mcp.server.url + path, {
  method: body === undefined ? 'GET' : 'POST',
  headers: { 'x-safescan-token': mcp.server.token, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
  body: body === undefined ? undefined : JSON.stringify(body),
}).then(async (r) => ({ status: r.status, data: await r.json() }));

const call = async (name, args = {}) => {
  const res = await client.callTool({ name, arguments: args });
  return { error: Boolean(res.isError), text: res.content.map((c) => c.text).join('\n') };
};

const waitFor = async (check, label) => {
  for (let i = 0; i < 100; i += 1) {
    const value = await check();
    if (value) return value;
    await new Promise((r) => setTimeout(r, 30));
  }
  throw new Error(`기다리다 시간 초과: ${label}`);
};

test('채널 · 도구 기능을 알리고, 연결된 Claude 를 화면에 보여 준다', async () => {
  assert.deepEqual(client.getServerCapabilities().experimental, { 'claude/channel': {} });
  assert.match(client.getInstructions(), /get_job/);
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), [
    'fail_job', 'get_issue', 'get_job', 'list_issues', 'next_job', 'open_ui', 'run_scan', 'status', 'submit_patch', 'submit_recommendation',
  ]);
  const { data } = await http('/api/state');
  assert.equal(data.assistant.mode, 'claude');
  assert.equal(data.assistant.client.name, 'claude-code-test');
  assert.equal(data.assistant.canPatch, true);
});

test('화면 API 는 접속 토큰이 있어야 한다', async () => {
  const res = await fetch(`${mcp.server.url}/api/state`);
  assert.equal(res.status, 401);
  const status = await call('status');
  assert.ok(status.text.includes(mcp.server.uiUrl));
  await call('open_ui');
  assert.deepEqual(opened, [mcp.server.uiUrl]);
});

test('run_scan 도구로 검사하면 이슈가 쌓인다', async () => {
  const { text } = await call('run_scan', { modules: ['fake-eval'] });
  assert.match(text, /fake-eval: ok · 2건/);
  assert.match(text, /새로 2/);
  const list = await call('list_issues');
  assert.match(list.text, /<safescan-data>/);
  assert.match(list.text, /eval 사용/);
});

test('✨ 추천: 화면 버튼 → 채널 알림 → get_job → submit_recommendation → 화면에 결과', async () => {
  const { data } = await http('/api/recommend', {});
  assert.equal(data.job.via, 'claude');
  const note = await waitFor(() => notes.find((n) => n.params?.meta?.job_id === data.job.id), '채널 알림');
  assert.equal(note.method, 'notifications/claude/channel');
  assert.equal(note.params.meta.job_kind, 'recommend');
  assert.ok(!note.params.content.includes('{'), '알림에는 작업 번호만 담는다');

  const job = await call('get_job', { job_id: data.job.id });
  assert.match(job.text, /검사 모듈 추천/);
  assert.match(job.text, /"ready": true/);
  assert.equal((await http('/api/state')).data.assistant.autoDelivery, true, '채널로 가져가면 자동 전달이 확인된다');

  const bad = await call('submit_recommendation', { job_id: data.job.id, selected: ['fake-missing-tool'], reasoning: 'x' });
  assert.equal(bad.error, true);
  assert.match(bad.text, /실행할 수 없는 모듈/);
  const ok = await call('submit_recommendation', { job_id: data.job.id, selected: ['fake-eval'], reasoning: '이 프로젝트는 Express 서버로 판단됩니다. eval 검사를 켭니다.' });
  assert.equal(ok.error, false, ok.text);

  const done = (await http(`/api/jobs/${data.job.id}`)).data.job;
  assert.equal(done.status, 'done');
  assert.deepEqual(done.result, { source: 'claude', selected: ['fake-eval'], reasoning: '이 프로젝트는 Express 서버로 판단됩니다. eval 검사를 켭니다.' });
});

test('🪄 수정안: next_job(채팅) → 잘못된 편집은 다시 받기 → 제출 → 적용 → 재검사로 조치 완료', async () => {
  const issues = (await http('/api/issues')).data.issues;
  const issue = issues.find((i) => i.findings[0].location.file === 'src/parse.js');
  const { data } = await http(`/api/issues/${issue.id}/patch`, { options: ['stability'] });
  assert.equal(data.job.status, 'queued');

  const job = await call('next_job');
  assert.match(job.text, /이슈 수정안/);
  assert.match(job.text, /안정성 최우선/);
  assert.match(job.text, /----- 파일 내용 시작 -----\nconst input = "\{\}";\nmodule\.exports = eval\(input\);/);
  assert.equal((await http(`/api/jobs/${data.job.id}`)).data.job.pickedBy, 'chat');

  const wrong = await call('submit_patch', { job_id: data.job.id, explanation: 'x', edits: [{ old_text: 'nope', new_text: 'y' }] });
  assert.equal(wrong.error, true);
  assert.match(wrong.text, /찾을 수 없습니다/);
  assert.equal((await http(`/api/jobs/${data.job.id}`)).data.job.status, 'working', '잘못 제출해도 작업은 열려 있다');

  const ok = await call('submit_patch', {
    job_id: data.job.id,
    explanation: 'eval 대신 JSON.parse 를 씁니다.',
    edits: [{ old_text: 'module.exports = eval(input);', new_text: 'module.exports = JSON.parse(input);' }],
  });
  assert.equal(ok.error, false, ok.text);
  const done = (await http(`/api/jobs/${data.job.id}`)).data.job;
  assert.equal(done.status, 'done');
  assert.equal(done.result.patch.proposed, 'const input = "{}";\nmodule.exports = JSON.parse(input);\n');
  assert.equal(await readFile(join(work, 'src', 'parse.js'), 'utf8'), 'const input = "{}";\nmodule.exports = eval(input);\n', '제출만으로는 파일을 바꾸지 않는다');

  const accepted = await http(`/api/issues/${issue.id}/patch/${done.result.patch.id}/accept`, {});
  assert.equal(accepted.status, 200, accepted.data.error);
  await waitFor(async () => (await http('/api/issues')).data.issues.find((i) => i.id === issue.id).status === 'resolved', '재검사');
  const final = (await http('/api/issues')).data.issues.find((i) => i.id === issue.id);
  assert.deepEqual(final.thread.map((t) => t.type), ['detected', 'patch_requested', 'patch_proposed', 'patch_accepted', 'status', 'resolved']);
});

test('처리할 수 없으면 fail_job, 화면에서 취소하면 제출을 거절한다', async () => {
  const issue = (await http('/api/issues')).data.issues.find((i) => i.status === 'discovered');
  const first = (await http(`/api/issues/${issue.id}/patch`, {})).data.job;
  const failed = await call('fail_job', { job_id: first.id, reason: '맥락이 부족합니다' });
  assert.equal(failed.error, false);
  assert.equal((await http(`/api/jobs/${first.id}`)).data.job.status, 'failed');

  const second = (await http(`/api/issues/${issue.id}/patch`, {})).data.job;
  await http(`/api/jobs/${second.id}/cancel`, {});
  const late = await call('submit_patch', { job_id: second.id, explanation: 'x', edits: [{ old_text: 'eval', new_text: 'x' }] });
  assert.equal(late.error, true);
  assert.match(late.text, /취소/);

  const thread = (await http('/api/issues')).data.issues.find((i) => i.id === issue.id).thread.map((t) => t.type);
  assert.deepEqual(thread.slice(-3), ['patch_failed', 'patch_requested', 'patch_rejected']);
});

test('stdio 로 실행해도 stdout 에는 MCP 메시지만 나온다', async () => {
  const transport = new StdioClientTransport({ command: process.execPath, args: [BIN, 'mcp', '-p', '0'], cwd: work, stderr: 'pipe' });
  const stdio = new Client({ name: 'stdio-test', version: '1.0.0' });
  await stdio.connect(transport);
  try {
    const { tools } = await stdio.listTools();
    assert.ok(tools.some((t) => t.name === 'get_job'));
    const status = await stdio.callTool({ name: 'status', arguments: {} });
    assert.match(status.content[0].text, /http:\/\/localhost:\d+\/\?token=[0-9a-f]{32}/);
  } finally {
    await stdio.close();
  }
});
