// 검사 실행 관리: 한 번에 하나의 검사를 돌리고, 이벤트를 쌓아 두었다가 UI(SSE)로 흘려보냅니다.
import { newRunId, runScan } from '../core/runner.js';

const KEEP_RUNS = 20;

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export class RunManager {
  /** @param {{ projectRoot: string, aiProvider: import('../core/ai.js').AiProvider }} opts */
  constructor({ projectRoot, aiProvider }) {
    this.projectRoot = projectRoot;
    this.aiProvider = aiProvider;
    /** @type {string|null} */
    this.active = null;
    /** @type {Map<string, { events: object[], listeners: Set<(e: object|null, id: number) => void>, done: boolean }>} */
    this.runs = new Map();
  }

  /**
   * 검사를 시작하고 runId 를 바로 돌려줍니다. 끝나면 afterRun 을 실행한 뒤 'run:closed' 를 보냅니다.
   * @param {{ modules: import('../core/registry.js').ModuleEntry[], options?: object, kind?: 'scan' | 'verify',
   *           afterRun?: (result: import('../sdk/types.js').RunResult) => Promise<void> }} p
   */
  start({ modules, options, kind = 'scan', afterRun }) {
    if (this.active) throw new HttpError(409, '이미 검사가 진행 중입니다');
    if (!modules.length) throw new HttpError(400, '실행할 모듈을 골라 주세요');

    const runId = newRunId();
    const record = { events: [], listeners: new Set(), done: false };
    this.runs.set(runId, record);
    this.active = runId;
    const push = (event) => {
      record.events.push(event);
      for (const listener of record.listeners) listener(event, record.events.length - 1);
    };

    runScan({ projectRoot: this.projectRoot, modules, options, kind, aiProvider: this.aiProvider, runId, onEvent: push })
      .then(async (result) => afterRun?.(result))
      .catch((err) => push({ type: 'run:error', runId, at: new Date().toISOString(), message: err.message }))
      .finally(() => {
        push({ type: 'run:closed', runId, at: new Date().toISOString() });
        record.done = true;
        for (const listener of record.listeners) listener(null, -1);
        record.listeners.clear();
        this.active = null;
        this.prune();
      });
    return runId;
  }

  /**
   * 지난 이벤트를 먼저 보내고 이후 이벤트를 이어서 보냅니다. listener(null) 은 끝 신호입니다.
   * @param {string} runId
   * @param {number} fromIndex  이 번호부터 보냄 (EventSource 재접속 시 Last-Event-ID + 1)
   */
  subscribe(runId, fromIndex, listener) {
    const record = this.runs.get(runId);
    if (!record) throw new HttpError(404, `검사 기록이 없습니다: ${runId}`);
    record.events.slice(fromIndex).forEach((event, i) => listener(event, fromIndex + i));
    if (record.done) {
      listener(null, -1);
      return () => {};
    }
    record.listeners.add(listener);
    return () => record.listeners.delete(listener);
  }

  prune() {
    const finished = [...this.runs.keys()].filter((id) => this.runs.get(id).done);
    for (const id of finished.slice(0, Math.max(0, finished.length - KEEP_RUNS))) this.runs.delete(id);
  }
}
