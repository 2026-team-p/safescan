// 정확도 벤치: 모듈을 fixtures/vulnerable 에 돌려 fixtures/expected.json 과 비교하고 기록을 쌓습니다.
// 기록(.safescan/bench/<id>.jsonl)으로 모듈 버전 · 도구 버전 · AI 모델 간 정확도와 비용을 비교합니다.
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PACKAGE_ROOT } from './registry.js';
import { runScan } from './runner.js';
import { scoreFindings, validateExpected } from './scoring.js';

export { scoreFindings, validateExpected };
export const BENCH_DIR = join(PACKAGE_ROOT, '.safescan', 'bench');

/** @returns {Promise<import('../sdk/types.js').ExpectedSet>} */
export async function readExpected(moduleDir) {
  const path = join(moduleDir, 'fixtures', 'expected.json');
  const expected = JSON.parse(await readFile(path, 'utf8'));
  const errors = validateExpected(expected);
  if (errors.length) throw new Error(`fixtures/expected.json: ${errors.join('; ')}`);
  return expected;
}

/**
 * 모듈 벤치 기록 전체 (오래된 것부터).
 * @param {string} id
 * @returns {Promise<any[]>}
 */
export async function readBenchHistory(id, historyDir = BENCH_DIR) {
  const text = await readFile(join(historyDir, `${id}.jsonl`), 'utf8').catch(() => '');
  return text.trim().split('\n').filter(Boolean).flatMap((line) => {
    try {
      return [JSON.parse(line)];
    } catch {
      return [];
    }
  });
}

/**
 * @param {import('./registry.js').ModuleEntry} entry
 * @param {{ aiProvider?: import('./ai.js').AiProvider, onEvent?: (e: any) => void, historyDir?: string|null }} [opts]
 */
export async function benchModule(entry, { aiProvider, onEvent, historyDir = BENCH_DIR } = {}) {
  const expected = await readExpected(entry.dir);
  const run = await runScan({
    projectRoot: join(entry.dir, 'fixtures', 'vulnerable'),
    modules: [entry],
    aiProvider,
    onEvent,
    strict: true,
    storeDir: null,
  });
  const mod = run.modules[0];
  const score = scoreFindings(mod.findings, expected);
  const record = {
    at: run.finishedAt,
    moduleId: entry.id,
    moduleVersion: mod.moduleVersion,
    status: mod.status,
    ...(mod.reason ? { reason: mod.reason } : {}),
    toolVersions: mod.toolVersions,
    aiModels: [...new Set(mod.aiCalls.map((c) => c.model))],
    options: mod.options,
    tp: score.tp, fp: score.fp, fn: score.fn,
    precision: score.precision, recall: score.recall, f1: score.f1,
    durationMs: mod.metrics.durationMs,
    aiCostUsd: mod.metrics.aiCostUsd,
    aiInputTokens: mod.metrics.aiInputTokens,
    aiOutputTokens: mod.metrics.aiOutputTokens,
  };

  let previous = null;
  if (historyDir) {
    const file = join(historyDir, `${entry.id}.jsonl`);
    const lines = (await readFile(file, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean);
    previous = lines.length ? JSON.parse(lines[lines.length - 1]) : null;
    await mkdir(historyDir, { recursive: true });
    await appendFile(file, JSON.stringify(record) + '\n');
  }
  return { record, previous, score, module: mod };
}
