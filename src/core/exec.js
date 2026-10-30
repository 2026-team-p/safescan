// 외부 도구 실행. Windows 의 .cmd/.bat (npm 등)을 셸 없이 안전하게 실행하려고 cross-spawn 을 씁니다.
import spawn from 'cross-spawn';

export class CommandNotFoundError extends Error {
  constructor(cmd) {
    super(`명령을 찾을 수 없습니다: ${cmd}`);
    this.code = 'ENOENT';
  }
}

export class CommandTimeoutError extends Error {
  constructor(cmd, timeoutMs) {
    super(`'${cmd}' 이(가) ${Math.round(timeoutMs / 1000)}초 안에 끝나지 않았습니다`);
    this.code = 'ETIMEDOUT';
  }
}

/** 로그 표시용 명령 문자열 */
export function formatCommand(cmd, args = []) {
  return [cmd, ...args].map((a) => (/[\s"]/.test(a) ? JSON.stringify(a) : a)).join(' ');
}

/**
 * @param {string} cmd
 * @param {string[]} args
 * @param {{ cwd?: string, env?: Record<string,string>, timeoutMs?: number, input?: string,
 *           signal?: AbortSignal, onLine?: (stream: 'stdout'|'stderr', line: string) => void }} [opts]
 * @returns {Promise<{ code: number, stdout: string, stderr: string, durationMs: number }>}
 */
export function runCommand(cmd, args = [], { cwd, env, timeoutMs, input, signal, onLine } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason ?? new Error('취소되었습니다'));

    const started = performance.now();
    const child = spawn(cmd, args, {
      cwd,
      env: childEnv(env),
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });

    const chunks = { stdout: [], stderr: [] };
    const partial = { stdout: '', stderr: '' };
    let settled = false;
    let timer;

    const finish = (fn) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      fn();
    };
    const onAbort = () => {
      killTree(child);
      finish(() => reject(signal.reason ?? new Error('취소되었습니다')));
    };

    for (const stream of /** @type {const} */ (['stdout', 'stderr'])) {
      child[stream].setEncoding('utf8');
      child[stream].on('data', (text) => {
        chunks[stream].push(text);
        if (!onLine) return;
        const lines = (partial[stream] + text).split(/\r?\n/);
        partial[stream] = lines.pop();
        for (const line of lines) onLine(stream, line);
      });
    }

    child.on('error', (err) => {
      finish(() => reject(err.code === 'ENOENT' ? new CommandNotFoundError(cmd) : err));
    });
    child.on('close', (code) => {
      if (onLine) for (const stream of /** @type {const} */ (['stdout', 'stderr'])) if (partial[stream]) onLine(stream, partial[stream]);
      finish(() => resolve({
        code: code ?? -1,
        stdout: chunks.stdout.join(''),
        stderr: chunks.stderr.join(''),
        durationMs: Math.round(performance.now() - started),
      }));
    });

    if (timeoutMs) {
      timer = setTimeout(() => {
        killTree(child);
        finish(() => reject(new CommandTimeoutError(cmd, timeoutMs)));
      }, timeoutMs);
    }
    signal?.addEventListener('abort', onAbort, { once: true });

    child.stdin.on('error', () => {}); // 자식이 stdin 을 읽기 전에 끝나는 경우
    child.stdin.end(input ?? '');
  });
}

/**
 * 자식 프로세스 환경. Windows 에서 PATH 항목에 따옴표가 섞여 있으면(예: C:\Program Files\dotnet")
 * cmd.exe 가 그 뒤 항목을 찾지 못해 npm 전역 설치 도구(.cmd)를 실행하지 못하므로, 자식에게 줄 PATH 에서만 따옴표를 뺍니다.
 */
export function childEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  if (process.platform !== 'win32') return env;
  for (const key of Object.keys(env)) {
    if (key.toUpperCase() === 'PATH' && env[key]) {
      env[key] = env[key].split(';').map((p) => p.replaceAll('"', '').trim()).filter(Boolean).join(';');
    }
  }
  return env;
}

const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;

/**
 * 버전 확인 명령의 출력에서 버전 한 줄만 뽑습니다. 색 코드를 지우고, 앞에 붙는 안내 줄보다 버전 숫자가 있는 줄을 고릅니다.
 * 예: nuclei -version → "[INF] Nuclei Engine Version: v3.11.1"
 */
export function versionLine(output, max = 80) {
  const lines = String(output ?? '').replace(ANSI, '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const line = lines.find((l) => /\d+\.\d+/.test(l)) ?? lines[0] ?? '';
  return line.replace(/^\[\w+\]\s*/, '').slice(0, max);
}

// Windows 에서 .cmd 는 cmd.exe 를 거쳐 실행되므로 자식 프로세스까지 함께 끝내야 합니다.
function killTree(child) {
  if (child.exitCode !== null || !child.pid) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
  } else {
    child.kill('SIGKILL');
  }
}
