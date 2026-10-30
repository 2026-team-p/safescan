// 정답표와 결과를 맞춰 정확도(정밀도 · 재현율 · F1)를 셉니다.
// 모듈 벤치(fixtures/expected.json)와 프로젝트 정답표(safescan.expected.json)가 함께 씁니다.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const MATCHER_KEYS = new Set(['ruleId', 'file', 'line', 'severity', 'dependency']);
const LINE_TOLERANCE = 2;
export const PROJECT_EXPECTED_FILE = 'safescan.expected.json';

/** @param {any} expected */
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
 * @param {import('../sdk/types.js').ExpectedSet} expected
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
 * 프로젝트 루트의 정답표. 일부러 문제를 심어 둔 예제 프로젝트에서 검사 한 번의 정확도를 재는 데 씁니다.
 * { "modules": { "<모듈 id>": { "allowExtra"?, "findings": [...] } } }
 * @returns {Promise<{ file: string, modules: Record<string, import('../sdk/types.js').ExpectedSet> } | null>}
 */
export async function readProjectExpected(root) {
  const text = await readFile(join(root, PROJECT_EXPECTED_FILE), 'utf8').catch(() => null);
  if (text === null) return null;
  const data = JSON.parse(text);
  if (!data?.modules || typeof data.modules !== 'object') throw new Error(`${PROJECT_EXPECTED_FILE}: modules 객체가 필요합니다`);
  for (const [id, set] of Object.entries(data.modules)) {
    const errors = validateExpected(set);
    if (errors.length) throw new Error(`${PROJECT_EXPECTED_FILE} modules.${id}: ${errors.join('; ')}`);
  }
  return { file: PROJECT_EXPECTED_FILE, modules: data.modules };
}
