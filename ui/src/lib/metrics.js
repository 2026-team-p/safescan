// 검사 결과(run.json) 하나에서 화면에 보일 수치를 뽑습니다. 서버 기록 요약(src/server/history.js)과 같은 계산입니다.
import { SEVERITY_ORDER } from './format.js';

const round3 = (v) => (v === null ? null : Math.round(v * 1000) / 1000);

/** 실행된 모듈들의 신뢰도 평균 */
export function meanConfidence(modules) {
  const scores = modules.filter((m) => m.status === 'ok').map((m) => m.metrics?.confidence).filter((v) => typeof v === 'number');
  return scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
}

/**
 * 정답표 정확도를 합칩니다 (TP · FP · FN 을 더해서 계산). 재현율은 모든 모듈로,
 * 정밀도는 오탐을 셀 수 있는 모듈(allowExtra 가 아닌 것)로만 계산하고, F1 은 모든 모듈의 정밀도를 잴 수 있을 때만 냅니다.
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

/** 벤치 정확도의 평균 (정답표가 없는 프로젝트에서 모듈들이 평소 얼마나 정확한지) */
export function meanBench(list) {
  const pick = (k) => list.map((b) => b?.[k]).filter((v) => typeof v === 'number');
  const avg = (vs) => (vs.length ? vs.reduce((a, b) => a + b, 0) / vs.length : null);
  return { precision: avg(pick('precision')), recall: avg(pick('recall')), f1: avg(pick('f1')), measured: list.filter((b) => b && (b.f1 ?? b.recall) != null).length };
}

export function severityTotals(modules) {
  return Object.fromEntries(SEVERITY_ORDER.map((s) => [s, modules.reduce((a, m) => a + (m.metrics?.bySeverity?.[s] ?? 0), 0)]));
}

/** 쓴 AI 모델과 토큰 · 비용 */
export function aiUsage(modules) {
  const calls = modules.flatMap((m) => m.aiCalls ?? []);
  return {
    calls: calls.length,
    models: [...new Set(calls.map((c) => c.model))],
    tokens: calls.reduce((a, c) => a + c.inputTokens + c.outputTokens, 0),
    costUsd: calls.reduce((a, c) => a + c.costUsd, 0),
  };
}

/** 신뢰도 구간별 결과 수. 모듈 기준(criteria.confidence)이 없으면 공통 구간을 씁니다. */
export const DEFAULT_BANDS = [{ min: 0.85 }, { min: 0.7 }, { min: 0.5 }, { min: 0 }];
export function confidenceBands(findings, bands) {
  const sorted = [...(bands?.length ? bands : DEFAULT_BANDS)].sort((a, b) => b.min - a.min);
  const counts = sorted.map((b) => ({ ...b, count: 0 }));
  for (const f of findings) {
    const band = counts.find((b) => f.confidence >= b.min) ?? counts[counts.length - 1];
    band.count += 1;
  }
  return counts;
}

/** 1234 → 1.2K */
export function compactNumber(n) {
  if (n == null) return '—';
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}K` : String(n);
}
