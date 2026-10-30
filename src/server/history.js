// 기록 화면용 자료: 지난 검사(.safescan/runs/<id>/run.json)와 AI 작업(.safescan/ai-jobs.jsonl)을 수치로 요약합니다.
import { appendFile, mkdir, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { SEVERITIES } from '../sdk/index.js';
import { readBenchHistory } from '../core/bench.js';

const RUN_ID_RE = /^\d{8}-\d{6}-[0-9a-f]{4}$/;
const AI_LOG = 'ai-jobs.jsonl';
const round3 = (v) => (v === null ? null : Number(v.toFixed(3)));

/** @returns {Promise<import('../sdk/types.js').RunResult | null>} */
export async function readRun(storeDir, runId) {
  if (!RUN_ID_RE.test(runId)) return null;
  try {
    return JSON.parse(await readFile(join(storeDir, 'runs', runId, 'run.json'), 'utf8'));
  } catch {
    return null;
  }
}

/** 모듈 버전마다 가장 최근 벤치 정확도 (같은 버전의 기록만). 요청 하나 동안 파일을 한 번씩만 읽습니다. */
export function createBenchLookup() {
  const cache = new Map();
  return async (moduleId, version) => {
    if (!cache.has(moduleId)) cache.set(moduleId, readBenchHistory(moduleId));
    const hit = (await cache.get(moduleId)).filter((r) => r.moduleVersion === version && r.status === 'ok').pop();
    return hit ? { source: 'bench', at: hit.at, tp: hit.tp, fp: hit.fp, fn: hit.fn, precision: hit.precision, recall: hit.recall, f1: hit.f1 } : null;
  };
}

/**
 * 정답표 정확도를 모듈 전체로 합칩니다 (TP · FP · FN 을 더해서 계산). 재현율은 모든 모듈로,
 * 정밀도는 오탐을 셀 수 있는 모듈(allowExtra 가 아닌 것)로만 계산하고, F1 은 모든 모듈의 정밀도를 잴 수 있을 때만 냅니다.
 * ui/src/lib/metrics.js 의 같은 함수와 계산을 맞춥니다.
 * @param {Array<{ tp: number, fp: number | null, fn: number }>} list
 */
export function combineAccuracy(list) {
  if (!list.length) return null;
  const sum = (xs, k) => xs.reduce((a, x) => a + x[k], 0);
  const tp = sum(list, 'tp');
  const fn = sum(list, 'fn');
  const measurable = list.filter((x) => x.fp !== null);
  const pTp = sum(measurable, 'tp');
  const fp = measurable.length ? sum(measurable, 'fp') : null;
  const precision = fp === null || pTp + fp === 0 ? null : pTp / (pTp + fp);
  const recall = tp + fn ? tp / (tp + fn) : null;
  const all = measurable.length === list.length;
  const f1 = all && precision !== null && recall !== null && precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : null;
  return { tp, fp, fn, precision: round3(precision), recall: round3(recall), f1: round3(f1), precisionModules: measurable.length, modules: list.length };
}

/**
 * 검사 하나를 기록 목록 한 줄로 요약합니다.
 * @param {import('../sdk/types.js').RunResult} run
 * @param {ReturnType<typeof createBenchLookup>} benchFor
 */
export async function summarizeRun(run, benchFor) {
  const modules = await Promise.all(run.modules.map(async (m) => {
    const metrics = m.metrics ?? /** @type {any} */ ({});
    const { missed, extra, ...accuracy } = m.accuracy ?? /** @type {any} */ ({});
    return {
      id: m.moduleId,
      version: m.moduleVersion,
      status: m.status,
      ...(m.reason ? { reason: m.reason } : {}),
      findings: metrics.findingCount ?? m.findings.length,
      bySeverity: metrics.bySeverity ?? {},
      confidence: metrics.confidence ?? null,
      durationMs: metrics.durationMs ?? 0,
      aiCalls: metrics.aiCalls ?? 0,
      tokens: (metrics.aiInputTokens ?? 0) + (metrics.aiOutputTokens ?? 0),
      costUsd: metrics.aiCostUsd ?? 0,
      aiModels: [...new Set((m.aiCalls ?? []).map((c) => c.model))],
      accuracy: m.accuracy ? accuracy : null,
      benchAccuracy: await benchFor(m.moduleId, m.moduleVersion),
      options: m.options ?? null,
      toolVersions: m.toolVersions ?? {},
    };
  }));

  const ran = modules.filter((m) => m.status === 'ok');
  const bySeverity = Object.fromEntries(SEVERITIES.map((s) => [s, modules.reduce((a, m) => a + (m.bySeverity[s] ?? 0), 0)]));
  const scores = ran.map((m) => m.confidence).filter((v) => typeof v === 'number');
  return {
    runId: run.runId,
    kind: run.kind ?? 'scan',
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    durationMs: Date.parse(run.finishedAt) - Date.parse(run.startedAt),
    ai: run.ai ?? null,
    expectedFile: run.expectedFile ?? null,
    issues: run.issues ?? null,
    statusCount: Object.fromEntries(['ok', 'skipped', 'failed', 'timeout'].map((s) => [s, modules.filter((m) => m.status === s).length])),
    findings: modules.reduce((a, m) => a + m.findings, 0),
    bySeverity,
    confidence: scores.length ? round3(scores.reduce((a, b) => a + b, 0) / scores.length) : null,
    accuracy: combineAccuracy(modules.filter((m) => m.accuracy).map((m) => m.accuracy)),
    aiCalls: modules.reduce((a, m) => a + m.aiCalls, 0),
    tokens: modules.reduce((a, m) => a + m.tokens, 0),
    costUsd: Number(modules.reduce((a, m) => a + m.costUsd, 0).toFixed(6)),
    aiModels: [...new Set(modules.flatMap((m) => m.aiModels))],
    modules,
  };
}

/** 최근 검사부터 요약 목록 */
export async function listRunSummaries(storeDir, limit = 100) {
  const ids = (await readdir(join(storeDir, 'runs')).catch(() => [])).filter((id) => RUN_ID_RE.test(id)).sort().reverse().slice(0, limit);
  const benchFor = createBenchLookup();
  const runs = await Promise.all(ids.map((id) => readRun(storeDir, id)));
  return Promise.all(runs.filter(Boolean).map((run) => summarizeRun(run, benchFor)));
}

// ───────── AI 작업 기록 ─────────

/**
 * 작업이 끝날 때 한 줄, 그 뒤 결과(적용 · 거절 · 재검사)가 생길 때마다 한 줄씩 덧붙입니다. 읽을 때 jobId 로 합칩니다.
 * @param {string} storeDir
 * @param {{ jobId: string } & Record<string, any>} record
 */
export async function appendAiJob(storeDir, record) {
  await mkdir(storeDir, { recursive: true });
  await appendFile(join(storeDir, AI_LOG), JSON.stringify({ loggedAt: new Date().toISOString(), ...record }) + '\n');
}

/** 최근 작업부터 */
export async function readAiJobs(storeDir, limit = 200) {
  const text = await readFile(join(storeDir, AI_LOG), 'utf8').catch(() => '');
  /** @type {Map<string, any>} */
  const byId = new Map();
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const { loggedAt, ...r } = JSON.parse(line);
      byId.set(r.jobId, { ...(byId.get(r.jobId) ?? {}), ...r });
    } catch { /* 깨진 줄은 건너뜀 */ }
  }
  return [...byId.values()].filter((j) => j.kind).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, limit);
}

/** 처리 방식 · 모델별 수치: 요청 수, 결과, 토큰, 비용, 평균 소요 시간 */
export function modelStats(jobs) {
  /** @type {Map<string, any>} */
  const groups = new Map();
  for (const j of jobs) {
    const key = `${j.via}:${j.model ?? j.client?.name ?? ''}`;
    const g = groups.get(key) ?? {
      via: j.via, model: j.model ?? null, client: j.client ?? null,
      jobs: 0, recommend: 0, patch: 0, done: 0, failed: 0, cancelled: 0, accepted: 0, rejected: 0, resolved: 0, stillFound: 0,
      inputTokens: 0, outputTokens: 0, costUsd: 0, totalMs: 0,
    };
    g.jobs += 1;
    g[j.kind] = (g[j.kind] ?? 0) + 1;
    if (j.status in g) g[j.status] += 1;
    if (j.consumed === 'accepted') g.accepted += 1;
    if (j.consumed === 'rejected') g.rejected += 1;
    if (j.verify === 'resolved') g.resolved += 1;
    if (j.verify === 'still_found') g.stillFound += 1;
    g.inputTokens += j.inputTokens ?? 0;
    g.outputTokens += j.outputTokens ?? 0;
    g.costUsd += j.costUsd ?? 0;
    g.totalMs += j.durationMs ?? 0;
    groups.set(key, g);
  }
  return [...groups.values()].map(({ totalMs, ...g }) => ({ ...g, costUsd: Number(g.costUsd.toFixed(6)), avgDurationMs: g.jobs ? Math.round(totalMs / g.jobs) : null }));
}
