// 정확도 벤치: 모듈을 fixtures/vulnerable 에 돌려 fixtures/expected.json 과 비교하고 기록을 쌓습니다.
// 기록(.safescan/bench/<id>.jsonl)으로 모듈 버전 · 도구 버전 · AI 모델 간 정확도와 비용을 비교합니다.
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PACKAGE_ROOT } from './registry.js';
import { runScan } from './runner.js';

export const BENCH_DIR = join(PACKAGE_ROOT, '.safescan', 'bench');
const MATCHER_KEYS = new Set(['ruleId', 'file', 'line', 'severity', 'dependency']);
const LINE_TOLERANCE = 2;

/**
 * @typedef {object} Expected
 * @property {string} [description]
 * @property {boolean} [allowExtra]  true 면 기대 목록에 없는 결과를 오탐으로 세지 않습니다 (정밀도 계산 안 함)
 * @property {Array<{ ruleId?: string, file?: string, line?: number, severity?: string, dependency?: string }>} findings
 */

/** @returns {Promise<Expected>} */
export async function readExpected(moduleDir) {
  const path = join(moduleDir, 'fixtures', 'expected.json');
  const expected = JSON.parse(await readFile(path, 'utf8'));
  const errors = validateExpected(expected);
  if (errors.length) throw new Error(`fixtures/expected.json: ${errors.join('; ')}`);
  return expected;
}

export function validateExpected(expected) {
  if (!expected || !Array.isArray(expected.findings)) return ['findings 배열이 필요합니다'];
  const errors = [];
  expected.findings.forEach((m, i) => {
    const keys = Object.keys(m ?? {});
    if (!keys.length) errors.push(`findings[${i}] 가 비어 있습니다`);
    for (const k of keys) if (!MATCHER_KEYS.has(k)) errors.push(`findings[${i}] 알 수 없는 키: ${k}`);
  });
  return errors;
}

/**
 * 기대 항목 하나는 결과 하나에만 짝지어집니다.
 * @param {import('../sdk/types.js').NormalizedFinding[]} findings
 * @param {Expected} expected
 */
export function scoreFindings(findings, expected) {
  const used = new Set();
  const missed = [];
  for (const matcher of expected.findings) {
    const idx = findings.findIndex((f, i) => !used.has(i) && matches(f, matcher));
    if (idx >= 0) used.add(idx);
    else missed.push(matcher);
  }
  const extra = findings.filter((_, i) => !used.has(i));
  const tp = used.size;
  const fn = missed.length;
  const fp = expected.allowExtra ? null : extra.length;
  const precision = fp === null || tp + fp === 0 ? null : tp / (tp + fp);
  const recall = expected.findings.length ? tp / expected.findings.length : null;
  const f1 = precision !== null && recall !== null && precision + recall > 0
    ? (2 * precision * recall) / (precision + recall) : null;
  const round = (v) => (v === null ? null : Number(v.toFixed(3)));
  return {
    tp, fp, fn,
    precision: round(precision),
    recall: round(recall),
    f1: round(f1),
    missed,
    extra: extra.map((f) => ({ ruleId: f.ruleId, file: f.location?.file, line: f.location?.startLine, title: f.title })),
  };
}

function matches(f, m) {
  if (m.ruleId !== undefined && f.ruleId !== m.ruleId) return false;
  if (m.severity !== undefined && f.severity !== m.severity) return false;
  if (m.dependency !== undefined && f.dependency?.name !== m.dependency) return false;
  if (m.file !== undefined && f.location?.file !== m.file) return false;
  if (m.line !== undefined && !(Math.abs((f.location?.startLine ?? -999) - m.line) <= LINE_TOLERANCE)) return false;
  return true;
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
