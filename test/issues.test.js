import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { findIssue, issueId, loadIssues, saveIssues, syncIssues } from '../src/core/issues.js';
import { normalizeFinding } from '../src/core/schema.js';

let clock = 0;
const finding = (moduleId, ruleId, extra = {}) =>
  normalizeFinding({ ruleId, title: `제목 ${ruleId}`, severity: 'high', confidence: 0.8, location: { file: 'a.js', snippet: ruleId }, ...extra }, moduleId).finding;
const run = (modules) => ({
  runId: `run-${++clock}`,
  finishedAt: new Date(Date.UTC(2026, 9, 31, 0, 0, clock)).toISOString(),
  modules: modules.map(([moduleId, status, findings = []]) => ({ moduleId, status, findings })),
});
const emptyStore = () => ({ version: 1, updatedAt: null, issues: [] });

test('처음 검사: 결과마다 이슈를 만들고 발견됨 · 발견 기록 1개', () => {
  const store = emptyStore();
  const summary = syncIssues(store, run([['m', 'ok', [finding('m', 'r1'), finding('m', 'r2')]]]));
  assert.deepEqual(summary, { created: 2, changed: 0, reopened: 0, resolved: 0, open: 2 });
  for (const issue of store.issues) {
    assert.equal(issue.status, 'discovered');
    assert.deepEqual(issue.thread.map((t) => t.type), ['detected']);
  }
});

test('같은 결과로 재검사하면 이슈 · 타임라인이 늘지 않는다', () => {
  const store = emptyStore();
  syncIssues(store, run([['m', 'ok', [finding('m', 'r1')]]]));
  const summary = syncIssues(store, run([['m', 'ok', [finding('m', 'r1')]]]));
  assert.deepEqual(summary, { created: 0, changed: 0, reopened: 0, resolved: 0, open: 1 });
  assert.equal(store.issues.length, 1);
  assert.equal(store.issues[0].thread.length, 1);
  assert.equal(store.issues[0].lastSeenRunId, `run-${clock}`);
});

test('사라지면 조치 완료, 다시 나타나면 같은 이슈가 다시 열린다', () => {
  const store = emptyStore();
  syncIssues(store, run([['m', 'ok', [finding('m', 'r1'), finding('m', 'r2')]]]));
  const fixed = syncIssues(store, run([['m', 'ok', [finding('m', 'r2')]]]));
  assert.equal(fixed.resolved, 1);
  assert.equal(fixed.open, 1);
  const r1 = store.issues.find((i) => i.findings[0].ruleId === 'r1');
  assert.equal(r1.status, 'resolved');
  assert.equal(r1.findings.length, 1, '해결된 이슈는 마지막으로 본 결과를 남긴다');

  const again = syncIssues(store, run([['m', 'ok', [finding('m', 'r1'), finding('m', 'r2')]]]));
  assert.equal(again.reopened, 1);
  assert.equal(store.issues.length, 2);
  assert.equal(r1.status, 'discovered');
  assert.deepEqual(r1.thread.map((t) => t.type), ['detected', 'resolved', 'reopened']);
});

test('실패 · 건너뜀 모듈은 이슈를 해결로 옮기지 않고, 다른 모듈 이슈도 건드리지 않는다', () => {
  const store = emptyStore();
  syncIssues(store, run([['a', 'ok', [finding('a', 'r1')]], ['b', 'ok', [finding('b', 'r1')]]]));
  const summary = syncIssues(store, run([['a', 'failed'], ['b', 'skipped']]));
  assert.deepEqual(summary, { created: 0, changed: 0, reopened: 0, resolved: 0, open: 2 });
  // a 만 다시 돌렸을 때 b 의 이슈는 그대로
  syncIssues(store, run([['a', 'ok', []]]));
  assert.equal(store.issues.find((i) => i.moduleId === 'a').status, 'resolved');
  assert.equal(store.issues.find((i) => i.moduleId === 'b').status, 'discovered');
});

test('의존성 결과는 패키지 단위로 한 이슈(스레드)에 묶이고, 일부만 해결되면 변경으로 기록된다', () => {
  const dep = (ruleId, severity) => finding('npm', ruleId, {
    severity, location: { file: 'package-lock.json' }, dependency: { name: 'lodash', version: '4.17.20' },
  });
  const store = emptyStore();
  syncIssues(store, run([['npm', 'ok', [dep('GHSA-1', 'medium'), dep('GHSA-2', 'critical')]]]));
  assert.equal(store.issues.length, 1);
  const [issue] = store.issues;
  assert.equal(issue.title, 'lodash@4.17.20 보안 권고 2건');
  assert.equal(issue.severity, 'critical');
  assert.equal(issue.id, issueId('npm', 'dependency:package-lock.json:lodash'));

  const partial = syncIssues(store, run([['npm', 'ok', [dep('GHSA-1', 'medium')]]]));
  assert.equal(partial.changed, 1);
  assert.equal(issue.severity, 'medium');
  assert.match(issue.thread.at(-1).message, /사라짐 1건/);
});

test('저장 · 읽기와 id 앞부분으로 찾기', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'safescan-issues-'));
  try {
    assert.deepEqual((await loadIssues(dir)).issues, []);
    const store = emptyStore();
    syncIssues(store, run([['m', 'ok', [finding('m', 'r1')]]]));
    await saveIssues(dir, store);
    const loaded = await loadIssues(dir);
    assert.equal(loaded.issues.length, 1);
    assert.equal(findIssue(loaded, loaded.issues[0].id.slice(0, 6)).id, loaded.issues[0].id);
    assert.equal(findIssue(loaded, 'zzzz'), null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
