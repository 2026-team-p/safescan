import { useEffect, useReducer, useRef } from 'react';
import { subscribeRun } from '../api.js';

const MAX_LOGS = 3000;
const initial = { runId: null, modules: {}, order: [], logs: [], startedAt: null, finishedAt: null, result: null, error: null, closed: false, aiCost: 0 };

function emptyModule(id) {
  return { id, status: 'pending', stages: {}, stageMs: {}, findings: 0, metrics: null, reason: null };
}

function reducer(state, e) {
  if (e.type === 'reset') return { ...initial, runId: e.runId };
  const mod = (id, patch) => ({ ...state.modules, [id]: { ...(state.modules[id] ?? emptyModule(id)), ...patch(state.modules[id] ?? emptyModule(id)) } });
  const log = (entry) => [...state.logs, { at: e.at, ...entry }].slice(-MAX_LOGS);
  switch (e.type) {
    case 'run:start':
      return { ...state, startedAt: e.at, order: e.modules, modules: Object.fromEntries(e.modules.map((id) => [id, emptyModule(id)])) };
    case 'module:start':
      return { ...state, modules: mod(e.moduleId, () => ({ status: 'running' })) };
    case 'stage:start':
      return { ...state, modules: mod(e.moduleId, (m) => ({ stages: { ...m.stages, [e.stage]: 'running' } })) };
    case 'stage:end':
      return {
        ...state,
        modules: mod(e.moduleId, (m) => ({ stages: { ...m.stages, [e.stage]: e.status }, stageMs: { ...m.stageMs, [e.stage]: e.durationMs } })),
        logs: e.error ? log({ moduleId: e.moduleId, stage: e.stage, level: e.status === 'skipped' ? 'warn' : 'error', message: e.error }) : state.logs,
      };
    case 'log':
      return { ...state, logs: log({ moduleId: e.moduleId, stage: e.stage, level: e.level, message: e.message }) };
    case 'ai:call':
      return {
        ...state,
        aiCost: state.aiCost + e.costUsd,
        logs: log({ moduleId: e.moduleId, stage: e.stage, level: 'ai', message: `AI ${e.model} · ${e.inputTokens}+${e.outputTokens} tok · $${e.costUsd.toFixed(4)}${e.purpose ? ` · ${e.purpose}` : ''}` }),
      };
    case 'finding':
      return { ...state, modules: mod(e.moduleId, (m) => ({ findings: m.findings + 1 })) };
    case 'module:end':
      return { ...state, modules: mod(e.moduleId, () => ({ status: e.status, metrics: e.metrics, reason: e.reason ?? null })) };
    case 'run:end':
      return { ...state, finishedAt: e.at, result: e.result };
    case 'run:error':
      return { ...state, error: e.message, finishedAt: e.at };
    case 'run:closed':
      return { ...state, closed: true, finishedAt: state.finishedAt ?? e.at };
    default:
      return state;
  }
}

/**
 * 검사 하나의 진행 상태. onEvent 는 매 이벤트마다 (텔레메트리 · 이슈 새로고침용) 호출됩니다.
 * @param {string|null} runId
 * @param {(event: object) => void} [onEvent]
 */
export function useRun(runId, onEvent) {
  const [state, dispatch] = useReducer(reducer, initial);
  const callback = useRef(onEvent);
  callback.current = onEvent;

  useEffect(() => {
    dispatch({ type: 'reset', runId });
    if (!runId) return undefined;
    return subscribeRun(runId, (event) => {
      dispatch(event);
      callback.current?.(event);
    });
  }, [runId]);

  return state;
}

/** 실행 중인 검사의 텔레메트리 값 */
export function telemetryOf(run, now) {
  if (!run.startedAt) return { elapsedMs: null, confidence: null };
  const end = run.finishedAt ? Date.parse(run.finishedAt) : now;
  const scores = Object.values(run.modules).map((m) => m.metrics?.confidence).filter((v) => typeof v === 'number');
  return {
    elapsedMs: Math.max(0, end - Date.parse(run.startedAt)),
    confidence: scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null,
  };
}
