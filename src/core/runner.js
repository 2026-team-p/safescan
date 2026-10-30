// 파이프라인 실행기: 모듈마다 전처리 → 툴 → 후처리 → 검증을 돌리고 이벤트를 내보냅니다.
// 모듈끼리는 서로 격리됩니다 — 하나가 실패해도 나머지는 계속 실행됩니다.
import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { SEVERITIES } from '../sdk/index.js';
import { createAiProvider } from './ai.js';
import { createContext, SkipSignal } from './context.js';
import { CommandNotFoundError, CommandTimeoutError, runCommand } from './exec.js';
import { createProjectApi, scanProject } from './project.js';
import { loadModule } from './registry.js';
import { normalizeFinding, resolveOptions } from './schema.js';

const DEFAULT_TIMEOUT_SEC = 300;

class ModuleTimeoutError extends Error {
  constructor(sec) {
    super(`제한 시간 ${sec}초를 넘었습니다`);
    this.name = 'ModuleTimeoutError';
  }
}

/**
 * @param {object} p
 * @param {string} p.projectRoot
 * @param {import('./registry.js').ModuleEntry[]} p.modules          실행할 모듈
 * @param {Record<string, Record<string, any>>} [p.options]          모듈별 사용자 옵션 { [moduleId]: {...} }
 * @param {number} [p.concurrency]                                   동시에 실행할 모듈 수 (기본 3)
 * @param {import('./ai.js').AiProvider} [p.aiProvider]
 * @param {(event: import('../sdk/types.js').RunEvent) => void} [p.onEvent]
 * @param {boolean} [p.strict]   true 면 잘못된 Finding 이 하나라도 있으면 모듈 실패 (bench · check 용)
 * @param {string|null} [p.storeDir]  결과 저장 위치. 기본 <projectRoot>/.safescan, null 이면 저장 안 함
 * @returns {Promise<import('../sdk/types.js').RunResult & { savedTo?: string }>}
 */
export async function runScan({
  projectRoot, modules, options = {}, concurrency = 3, aiProvider = createAiProvider(),
  onEvent = () => {}, strict = false, storeDir,
}) {
  const root = resolve(projectRoot);
  if (!(await stat(root).catch(() => null))?.isDirectory()) throw new Error(`폴더가 아닙니다: ${root}`);

  const runId = newRunId();
  const events = [];
  const emit = (event) => {
    const full = /** @type {import('../sdk/types.js').RunEvent} */ ({ runId, at: new Date().toISOString(), ...event });
    events.push(full);
    onEvent(full);
  };

  const startedAt = new Date().toISOString();
  const { profile, isIgnored } = await scanProject(root);
  const project = createProjectApi(root, profile, isIgnored);
  emit({ type: 'run:start', projectRoot: root, modules: modules.map((m) => m.id), profile });

  const results = await mapPool(modules, concurrency, (entry) =>
    runModule({ runId, entry, project, userOptions: options[entry.id], aiProvider, emit, strict }));

  /** @type {import('../sdk/types.js').RunResult} */
  const result = { runId, projectRoot: root, startedAt, finishedAt: new Date().toISOString(), profile, modules: results };
  emit({ type: 'run:end', result });

  const dir = storeDir === null ? null : join(storeDir ?? join(root, '.safescan'), 'runs', runId);
  if (dir) {
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'run.json'), JSON.stringify(result, null, 2));
    await writeFile(join(dir, 'events.jsonl'), events.map((e) => JSON.stringify(e)).join('\n') + '\n');
  }
  return dir ? { ...result, savedTo: dir } : result;
}

async function runModule({ runId, entry, project, userOptions, aiProvider, emit, strict }) {
  const { manifest } = entry;
  const moduleId = entry.id;
  const started = performance.now();
  const records = { ai: [], exec: [] };
  /** @type {import('../sdk/types.js').StageRecord[]} */
  const stages = [];
  /** @type {import('../sdk/types.js').NormalizedFinding[]} */
  let findings = [];
  /** @type {import('../sdk/types.js').VerifyReport} */
  let verify = {};
  /** @type {import('../sdk/types.js').ModuleStatus} */
  let status = 'ok';
  let reason;
  const toolVersions = {};
  const log = (level, message) => emit({ type: 'log', moduleId, stage: null, level, message });

  emit({ type: 'module:start', moduleId });

  const timeoutSec = manifest.timeoutSec ?? DEFAULT_TIMEOUT_SEC;
  const deadline = Date.now() + timeoutSec * 1000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new ModuleTimeoutError(timeoutSec)), timeoutSec * 1000);
  const { signal } = controller;
  let tmpDir;

  try {
    const definition = await loadModule(entry);
    const options = resolveOptions(manifest, userOptions);

    if (manifest.ai === 'required' && !aiProvider.available) {
      throw new SkipSignal('AI 가 필요한 모듈인데 AI 가 설정되지 않았습니다 (ANTHROPIC_API_KEY)');
    }
    for (const req of manifest.requires ?? []) {
      toolVersions[req.bin] = await probeTool(req, project.root, signal);
      log('info', `도구 확인: ${req.bin} ${toolVersions[req.bin]}`);
    }

    tmpDir = await mkdtemp(join(tmpdir(), `safescan-${moduleId}-`));
    const ctxFor = (stage) => createContext({
      runId, stage, entry, project, options, tmpDir, signal, deadline, aiProvider, emit, records,
    });
    const step = (stage, fn) => runStage({ stage, fn, ctx: ctxFor(stage), moduleId, emit, stages, signal });

    const input = await step('preprocess', (ctx) => definition.preprocess(ctx));
    const raw = await step('tool', (ctx) => definition.tool(ctx, input));
    const produced = await step('postprocess', async (ctx) => {
      const out = await definition.postprocess(ctx, raw, input);
      if (!Array.isArray(out)) throw new Error('postprocess 는 Finding 배열을 돌려줘야 합니다');
      return normalizeAll(out, moduleId, strict, ctx.log);
    });
    findings = produced;
    for (const finding of findings) emit({ type: 'finding', moduleId, finding });

    verify = await step('verify', async (ctx) => {
      const report = definition.verify ? await definition.verify(ctx, { input, raw, findings }) : {};
      return checkVerifyReport(report);
    });
  } catch (err) {
    if (err instanceof SkipSignal) {
      status = 'skipped';
      reason = err.message;
    } else if (signal.reason instanceof ModuleTimeoutError) {
      status = 'timeout';
      reason = signal.reason.message;
    } else if (err instanceof CommandTimeoutError) {
      status = 'timeout';
      reason = err.message;
    } else {
      status = 'failed';
      reason = err?.message ?? String(err);
    }
    log(status === 'skipped' ? 'warn' : 'error', reason);
  } finally {
    clearTimeout(timer);
    if (!signal.aborted) controller.abort(new Error('모듈 종료'));
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }

  if (status !== 'ok') findings = [];
  const metrics = computeMetrics({ started, records, findings, verify });
  emit({ type: 'module:end', moduleId, status, reason, metrics });

  return {
    moduleId,
    moduleVersion: manifest.version,
    status,
    ...(reason ? { reason } : {}),
    toolVersions,
    stages,
    findings,
    verify,
    metrics,
    aiCalls: records.ai,
    execCalls: records.exec,
  };
}

async function runStage({ stage, fn, ctx, moduleId, emit, stages, signal }) {
  emit({ type: 'stage:start', moduleId, stage });
  const t0 = performance.now();
  const end = (status, error) => {
    const durationMs = Math.round(performance.now() - t0);
    stages.push({ stage, status, durationMs, ...(error ? { error } : {}) });
    emit({ type: 'stage:end', moduleId, stage, status, durationMs, ...(error ? { error } : {}) });
  };
  try {
    // 모듈 코드가 signal 을 무시해도 제한 시간이 지나면 러너는 다음으로 넘어갑니다.
    const value = await Promise.race([Promise.resolve().then(() => fn(ctx)), rejectOnAbort(signal)]);
    end('ok');
    return value;
  } catch (err) {
    if (err instanceof SkipSignal) end('skipped', err.message);
    else end('failed', err?.message ?? String(err));
    throw err;
  }
}

function normalizeAll(list, moduleId, strict, log) {
  const byFingerprint = new Map();
  list.forEach((item, i) => {
    const { finding, errors } = normalizeFinding(item, moduleId);
    if (!finding) {
      const message = `Finding[${i}] 형식 오류: ${errors.join('; ')}`;
      if (strict) throw new Error(message);
      log.warn(`${message} — 버립니다`);
      return;
    }
    if (!byFingerprint.has(finding.fingerprint)) byFingerprint.set(finding.fingerprint, finding);
  });
  return [...byFingerprint.values()].sort((a, b) =>
    SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity) || b.confidence - a.confidence);
}

function checkVerifyReport(report) {
  if (!report || typeof report !== 'object') throw new Error('verify 는 객체를 돌려줘야 합니다');
  if (report.confidence !== undefined && !(report.confidence >= 0 && report.confidence <= 1)) {
    throw new Error('verify.confidence 는 0~1 이어야 합니다');
  }
  return report;
}

async function probeTool(req, cwd, signal) {
  try {
    const r = await runCommand(req.bin, req.versionArgs ?? ['--version'], { cwd, timeoutMs: 20_000, signal });
    return (r.stdout || r.stderr).trim().split('\n')[0].slice(0, 80) || 'unknown';
  } catch (err) {
    if (err instanceof CommandNotFoundError) throw new SkipSignal(`'${req.bin}' 이(가) 설치되어 있지 않습니다. 설치: ${req.install}`);
    throw err;
  }
}

function computeMetrics({ started, records, findings, verify }) {
  const sum = (key) => records.ai.reduce((acc, r) => acc + r[key], 0);
  const bySeverity = Object.fromEntries(SEVERITIES.map((s) => [s, 0]));
  for (const f of findings) bySeverity[f.severity] += 1;
  const avg = findings.length ? findings.reduce((acc, f) => acc + f.confidence, 0) / findings.length : null;
  return {
    durationMs: Math.round(performance.now() - started),
    aiCalls: records.ai.length,
    aiInputTokens: sum('inputTokens'),
    aiOutputTokens: sum('outputTokens'),
    aiCostUsd: Number(sum('costUsd').toFixed(6)),
    findingCount: findings.length,
    bySeverity,
    confidence: verify.confidence ?? (avg === null ? null : Number(avg.toFixed(3))),
  };
}

function rejectOnAbort(signal) {
  return new Promise((_, reject) => {
    if (signal.aborted) reject(signal.reason);
    else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
}

async function mapPool(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

function newRunId() {
  const iso = new Date().toISOString(); // 2026-10-31T02:46:00.000Z
  return `${iso.slice(0, 10).replaceAll('-', '')}-${iso.slice(11, 19).replaceAll(':', '')}-${randomBytes(2).toString('hex')}`;
}
