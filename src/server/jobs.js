// UI 가 AI 에게 맡기는 일(모듈 추천 · 수정안)을 '작업'으로 관리합니다.
// 처리하는 쪽은 셋 중 하나입니다: 연결된 Claude 세션(claude), API 키(api), 규칙(rules).
import { EventEmitter } from 'node:events';
import { randomBytes } from 'node:crypto';
import { HttpError } from './runs.js';

const KEEP_FINISHED = 50;
const OPEN = new Set(['queued', 'working']);

/**
 * @typedef {'recommend' | 'patch'} JobKind
 * @typedef {'queued' | 'working' | 'done' | 'failed' | 'cancelled'} JobStatus
 * @typedef {object} Job
 * @property {string} id
 * @property {JobKind} kind
 * @property {JobStatus} status
 * @property {'claude' | 'api' | 'rules'} via
 * @property {string} [issueId]
 * @property {string[]} [options]       사용자가 고른 옵션 이름
 * @property {string} [lang]            답변 언어 (화면 언어)
 * @property {string} createdAt
 * @property {string} [startedAt]
 * @property {string} [finishedAt]
 * @property {number} [durationMs]      만든 때부터 끝날 때까지
 * @property {'channel' | 'chat'} [pickedBy]   Claude 가 채널 알림으로 가져갔는지, 채팅 요청으로 가져갔는지
 * @property {object} [result]
 * @property {string} [error]
 * @property {object[]} [aiCalls]       API 로 처리했을 때 비용 기록
 */

export class JobManager extends EventEmitter {
  constructor() {
    super();
    /** @type {Map<string, Job>} */
    this.jobs = new Map();
    /** @type {Map<string, object>} 작업마다 UI 에 보내지 않는 내부 자료 (파일 원문 등) */
    this.private = new Map();
  }

  /**
   * @param {{ kind: JobKind, via: Job['via'], issueId?: string, options?: string[], lang?: string, internal?: object }} p
   * @returns {Job}
   */
  create({ kind, via, issueId, options, lang, internal }) {
    const job = {
      id: randomBytes(4).toString('hex'),
      kind,
      status: /** @type {JobStatus} */ ('queued'),
      via,
      ...(issueId ? { issueId } : {}),
      ...(options ? { options } : {}),
      ...(lang ? { lang } : {}),
      createdAt: new Date().toISOString(),
    };
    this.jobs.set(job.id, job);
    if (internal) this.private.set(job.id, internal);
    this.emit('update', job);
    return job;
  }

  get(id) {
    const job = this.jobs.get(id);
    if (!job) throw new HttpError(404, `작업을 찾을 수 없습니다: ${id}`);
    return job;
  }

  internal(id) {
    return this.private.get(id);
  }

  /** 가장 오래 기다린 Claude 작업 */
  next() {
    return [...this.jobs.values()].find((j) => j.via === 'claude' && j.status === 'queued') ?? null;
  }

  queued() {
    return [...this.jobs.values()].filter((j) => OPEN.has(j.status));
  }

  /** 화면을 새로 열어도 끝난 작업(아직 적용 안 한 수정안 포함)을 다시 보여 줄 수 있게 최근 작업을 모두 돌려줍니다. */
  recent() {
    return [...this.jobs.values()];
  }

  /** 수정안을 적용 · 거절했다고 표시합니다. 화면은 표시된 수정안을 다시 띄우지 않습니다. */
  markConsumed(id, how) {
    const job = this.jobs.get(id);
    if (!job?.result?.patch || job.result.patch.consumed) return;
    job.result.patch.consumed = how;
    this.emit('update', job);
  }

  start(id, pickedBy) {
    const job = this.get(id);
    this.assertOpen(job);
    if (job.status === 'queued') {
      Object.assign(job, { status: 'working', startedAt: new Date().toISOString(), ...(pickedBy ? { pickedBy } : {}) });
      this.emit('update', job);
    }
    return job;
  }

  finish(id, result, extra = {}) {
    const job = this.get(id);
    this.assertOpen(job);
    this.close(job, { status: 'done', result, ...extra });
    return job;
  }

  fail(id, error, extra = {}) {
    const job = this.get(id);
    if (!OPEN.has(job.status)) return job;
    this.close(job, { status: 'failed', error, ...extra });
    return job;
  }

  cancel(id) {
    const job = this.get(id);
    if (OPEN.has(job.status)) this.close(job, { status: 'cancelled' });
    return job;
  }

  assertOpen(job) {
    if (job.status === 'cancelled') throw new HttpError(409, `작업 #${job.id} 은 사용자가 취소했습니다`);
    if (!OPEN.has(job.status)) throw new HttpError(409, `작업 #${job.id} 은 이미 끝났습니다 (${job.status})`);
  }

  close(job, patch) {
    const finishedAt = new Date().toISOString();
    Object.assign(job, patch, { finishedAt, durationMs: Date.parse(finishedAt) - Date.parse(job.createdAt) });
    this.private.delete(job.id);
    this.emit('update', job);
    const finished = [...this.jobs.values()].filter((j) => !OPEN.has(j.status));
    for (const old of finished.slice(0, Math.max(0, finished.length - KEEP_FINISHED))) this.jobs.delete(old.id);
  }
}
