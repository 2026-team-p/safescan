// 단계 함수에 넘기는 ctx 만들기. 모듈이 하는 모든 외부 작업(로그 · 도구 실행 · AI)은 여기서 기록됩니다.
import { meterAi } from './ai.js';
import { formatCommand, runCommand } from './exec.js';

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;

/** ctx.skip() 이 던지는 신호. 러너가 받아 모듈을 '건너뜀'으로 끝냅니다. */
export class SkipSignal extends Error {
  constructor(reason) {
    super(reason);
    this.name = 'SkipSignal';
  }
}

/**
 * @param {object} p
 * @param {string} p.runId
 * @param {import('../sdk/types.js').Stage} p.stage
 * @param {import('./registry.js').ModuleEntry} p.entry
 * @param {import('../sdk/types.js').ProjectApi} p.project
 * @param {Record<string, any>} p.options
 * @param {string} p.tmpDir
 * @param {AbortSignal} p.signal
 * @param {number} p.deadline           Date.now() 기준 모듈 마감 시각
 * @param {import('./ai.js').AiProvider} p.aiProvider
 * @param {(event: object) => void} p.emit
 * @param {{ ai: import('../sdk/types.js').AiCallRecord[], exec: import('../sdk/types.js').ExecCallRecord[] }} p.records
 * @returns {import('../sdk/types.js').ModuleContext}
 */
export function createContext({ runId, stage, entry, project, options, tmpDir, signal, deadline, aiProvider, emit, records }) {
  const moduleId = entry.id;
  const logAt = (level) => (message) => emit({ type: 'log', moduleId, stage, level, message: String(message) });
  const log = Object.freeze({ debug: logAt('debug'), info: logAt('info'), warn: logAt('warn'), error: logAt('error') });

  async function exec(cmd, args = [], opts = {}) {
    const command = formatCommand(cmd, args);
    const cwd = opts.cwd ? project.resolve(opts.cwd) : project.root;
    const timeoutMs = opts.timeoutMs ?? Math.max(1000, deadline - Date.now());
    const okExitCodes = opts.okExitCodes ?? [0];
    log.info(`$ ${command}`);

    const record = { stage, command, code: /** @type {number|null} */ (null), durationMs: 0 };
    records.exec.push(record);
    const started = performance.now();
    try {
      const result = await runCommand(cmd, args, {
        cwd,
        env: opts.env,
        input: opts.input,
        timeoutMs,
        signal,
        onLine: (stream, line) => {
          if (stream === 'stdout' && opts.quiet) return;
          // 도구가 넣는 터미널 색상 코드는 콘솔 · UI 에서 깨져 보이므로 지웁니다.
          const text = line.replace(ANSI, '');
          if (text.trim()) log.debug(text);
        },
      });
      record.code = result.code;
      record.durationMs = result.durationMs;
      if (!okExitCodes.includes(result.code)) {
        const tail = result.stderr.trim().split('\n').slice(-5).join('\n');
        throw new Error(`'${cmd}' 종료 코드 ${result.code}${tail ? `\n${tail}` : ''}`);
      }
      return result;
    } finally {
      record.durationMs ||= Math.round(performance.now() - started);
    }
  }

  return Object.freeze({
    runId,
    stage,
    module: Object.freeze({ id: moduleId, dir: entry.dir, manifest: entry.manifest }),
    project,
    options: Object.freeze({ ...options }),
    tmpDir,
    signal,
    log,
    exec,
    ai: meterAi(aiProvider, {
      stage,
      signal,
      onCall: (rec) => {
        records.ai.push(rec);
        emit({ type: 'ai:call', moduleId, ...rec });
      },
    }),
    skip(reason) {
      throw new SkipSignal(reason);
    },
  });
}
