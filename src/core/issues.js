// 이슈 아이템: 검사 결과(Finding)를 칸반 카드 + 스레드로 이어 붙입니다.
// 같은 group 의 결과는 이슈 하나로 묶이고, 재검사 때마다 같은 이슈의 타임라인에 기록이 쌓입니다.
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { SEVERITIES } from '../sdk/index.js';

/** @typedef {import('../sdk/types.js').Issue} Issue */
/** @typedef {import('../sdk/types.js').NormalizedFinding} NormalizedFinding */

const FILE = 'issues.json';
const STATUS_ORDER = ['discovered', 'in_progress', 'resolved'];

export const issueId = (moduleId, group) =>
  createHash('sha1').update(`${moduleId}\u0000${group}`).digest('hex').slice(0, 12);

/** @returns {Promise<{ version: 1, updatedAt: string|null, issues: Issue[] }>} */
export async function loadIssues(storeDir) {
  try {
    return JSON.parse(await readFile(join(storeDir, FILE), 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return { version: 1, updatedAt: null, issues: [] };
    throw new Error(`${FILE} 을 읽을 수 없습니다: ${err.message}`);
  }
}

export async function saveIssues(storeDir, store) {
  await mkdir(storeDir, { recursive: true });
  const sorted = [...store.issues].sort((a, b) =>
    STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status)
    || SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity)
    || a.createdAt.localeCompare(b.createdAt));
  const tmp = join(storeDir, `${FILE}.tmp`);
  await writeFile(tmp, JSON.stringify({ ...store, issues: sorted }, null, 2));
  await rename(tmp, join(storeDir, FILE));
}

/**
 * 검사 결과를 이슈 저장소에 반영합니다 (저장소 객체를 직접 고침).
 * 정상(ok)으로 끝난 모듈만 반영합니다 — 실패 · 건너뜀 모듈은 결과가 없어도 이슈를 해결로 옮기지 않습니다.
 * @param {{ issues: Issue[], updatedAt: string|null }} store
 * @param {import('../sdk/types.js').RunResult} run
 * @returns {import('../sdk/types.js').IssueSyncSummary}
 */
export function syncIssues(store, run) {
  const at = run.finishedAt;
  const runId = run.runId;
  const byId = new Map(store.issues.map((issue) => [issue.id, issue]));
  const summary = { created: 0, changed: 0, reopened: 0, resolved: 0, open: 0 };

  for (const mod of run.modules) {
    if (mod.status !== 'ok') continue;
    const seen = new Set();

    for (const [group, findings] of groupBy(mod.findings, (f) => f.group)) {
      const id = issueId(mod.moduleId, group);
      seen.add(id);
      const issue = byId.get(id);
      const head = { title: titleOf(findings), severity: maxSeverity(findings), findings, updatedAt: at, lastSeenRunId: runId };

      if (!issue) {
        const created = {
          id, moduleId: mod.moduleId, group, status: /** @type {const} */ ('discovered'), createdAt: at, ...head,
          thread: [entry(at, runId, 'detected', `${mod.moduleId} 모듈이 ${findings.length}건을 발견했습니다: ${listTitles(findings)}`)],
        };
        store.issues.push(created);
        byId.set(id, created);
        summary.created += 1;
        continue;
      }

      const before = new Set(issue.findings.map((f) => f.fingerprint));
      const after = new Set(findings.map((f) => f.fingerprint));
      const added = [...after].filter((fp) => !before.has(fp)).length;
      const removed = [...before].filter((fp) => !after.has(fp)).length;

      if (issue.status === 'resolved') {
        issue.status = 'discovered';
        issue.thread.push(entry(at, runId, 'reopened', `해결됐던 문제가 다시 발견되었습니다 (${findings.length}건)`));
        summary.reopened += 1;
      } else if (added || removed) {
        issue.thread.push(entry(at, runId, 'changed', `재검사 결과가 바뀌었습니다: 새로 ${added}건, 사라짐 ${removed}건 (현재 ${findings.length}건)`));
        summary.changed += 1;
      }
      Object.assign(issue, head);
    }

    for (const issue of store.issues) {
      if (issue.moduleId !== mod.moduleId || issue.status === 'resolved' || seen.has(issue.id)) continue;
      issue.status = 'resolved';
      issue.updatedAt = at;
      issue.thread.push(entry(at, runId, 'resolved', `${mod.moduleId} 재검사에서 더 이상 발견되지 않아 조치 완료로 옮겼습니다`));
      summary.resolved += 1;
    }
  }

  store.updatedAt = at;
  summary.open = store.issues.filter((issue) => issue.status !== 'resolved').length;
  return summary;
}

/** 실행 결과를 <storeDir>/issues.json 에 반영하고 요약을 돌려줍니다. */
export async function syncIssueStore(storeDir, run) {
  const store = await loadIssues(storeDir);
  const summary = syncIssues(store, run);
  await saveIssues(storeDir, store);
  return summary;
}

/** id 앞부분만으로도 찾습니다. 여러 개가 맞으면 에러 */
export function findIssue(store, idPrefix) {
  const matches = store.issues.filter((issue) => issue.id.startsWith(idPrefix));
  if (matches.length > 1) throw new Error(`'${idPrefix}' 로 시작하는 이슈가 ${matches.length}개입니다. 더 길게 입력하세요`);
  return matches[0] ?? null;
}

/** @param {NormalizedFinding[]} findings */
function titleOf(findings) {
  const [first] = findings;
  if (findings.length === 1) return first.title;
  if (first.dependency) {
    const { name, version } = first.dependency;
    return `${name}${version ? `@${version}` : ''} 보안 권고 ${findings.length}건`;
  }
  return `${first.title} 외 ${findings.length - 1}건`;
}

const maxSeverity = (findings) => SEVERITIES.find((s) => findings.some((f) => f.severity === s)) ?? 'low';

function listTitles(findings) {
  const titles = findings.slice(0, 3).map((f) => f.title);
  return titles.join(', ') + (findings.length > 3 ? ` 외 ${findings.length - 3}건` : '');
}

function entry(at, runId, type, message) {
  return { at, type, actor: /** @type {const} */ ('safescan'), runId, message };
}

function groupBy(items, keyOf) {
  const map = new Map();
  for (const item of items) {
    const key = keyOf(item);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }
  return map;
}
