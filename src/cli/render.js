// 터미널 출력. 러너 이벤트를 받아 그립니다 (로컬 UI 도 같은 이벤트를 받게 됩니다).
import { relative } from 'node:path';

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code) => (text) => (useColor ? `\x1b[${code}m${text}\x1b[0m` : String(text));

export const c = {
  sky: paint('38;5;117'),
  dim: paint('2'),
  bold: paint('1'),
  ok: paint('38;5;114'),
  warn: paint('38;5;221'),
  err: paint('38;5;203'),
};

const SEVERITY_LABEL = {
  critical: paint('38;5;196')('크리티컬'),
  high: paint('38;5;208')('위험    '),
  medium: paint('38;5;220')('주의    '),
  low: paint('38;5;75')('참고    '),
};

const STAGE_LABEL = { preprocess: '전처리', tool: '툴', postprocess: '후처리', verify: '검증' };
const STATUS_MARK = { ok: c.ok('✓'), skipped: c.warn('–'), failed: c.err('✗'), timeout: c.err('⏱') };

/** 한글 · CJK 를 2칸으로 세어 오른쪽을 채웁니다. */
export function pad(text, width) {
  let cols = 0;
  for (const ch of String(text)) cols += /[ᄀ-ᇿ　-鿿가-힣＀-￯]/.test(ch) ? 2 : 1;
  return String(text) + ' '.repeat(Math.max(0, width - cols));
}

export const fmtMs = (ms) => (ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`);
export const fmtUsd = (usd) => `$${usd.toFixed(4)}`;

export function banner() {
  return c.sky(c.bold('◆ SafeScan'));
}

/**
 * @param {{ verbose?: boolean, idWidth: number }} opts
 * @returns {(event: import('../sdk/types.js').RunEvent) => void}
 */
export function createRenderer({ verbose = false, idWidth }) {
  const tag = (id) => c.sky(id.padEnd(idWidth));
  return (e) => {
    switch (e.type) {
      case 'run:start':
        console.log(`\n${banner()}  ${c.dim(`run ${e.runId}`)}`);
        console.log(`${c.dim('대상')}  ${e.projectRoot}`);
        if (e.profile.ignore.length) console.log(`${c.dim('제외')}  ${e.profile.ignore.join(', ')} ${c.dim('(.safescanignore)')}`);
        console.log(`${c.dim('모듈')}  ${e.modules.join(', ') || '(없음)'}\n`);
        break;
      case 'stage:end':
        console.log(`${tag(e.moduleId)}  ${STATUS_MARK[e.status]} ${pad(STAGE_LABEL[e.stage], 6)} ${c.dim(fmtMs(e.durationMs))}${e.error ? ` ${c.err(e.error)}` : ''}`);
        break;
      case 'log':
        if (e.level === 'debug' && !verbose) break;
        console.log(`${tag(e.moduleId)}  ${c.dim('│')} ${e.level === 'warn' ? c.warn(e.message) : e.level === 'error' ? c.err(e.message) : c.dim(e.message)}`);
        break;
      case 'ai:call':
        console.log(`${tag(e.moduleId)}  ${c.dim('│')} ${c.dim(`AI ${e.model} · ${e.inputTokens}+${e.outputTokens} tok · ${fmtUsd(e.costUsd)} · ${fmtMs(e.durationMs)}${e.purpose ? ` · ${e.purpose}` : ''}`)}`);
        break;
      case 'module:end':
        console.log(`${tag(e.moduleId)}  ${STATUS_MARK[e.status]} ${c.bold(e.status)} ${c.dim(`· ${e.metrics.findingCount}건 · ${fmtMs(e.metrics.durationMs)} · AI ${fmtUsd(e.metrics.aiCostUsd)}`)}`);
        break;
      default:
        break;
    }
  };
}

/** @param {import('../sdk/types.js').RunResult & { savedTo?: string }} result */
export function printSummary(result) {
  const width = Math.max(6, ...result.modules.map((m) => m.moduleId.length));
  console.log(`\n${c.bold('결과')}`);
  console.log(c.dim([pad('모듈', width), pad('  상태', 11), ' 크리 위험 주의 참고', '  ', pad('시간', 8), pad('AI 비용', 10), '신뢰도'].join('')));
  for (const m of result.modules) {
    const s = m.metrics.bySeverity;
    console.log([
      m.moduleId.padEnd(width),
      `  ${STATUS_MARK[m.status]} ${m.status.padEnd(7)}`,
      [s.critical, s.high, s.medium, s.low].map((n) => String(n).padStart(5)).join(''),
      '  ',
      fmtMs(m.metrics.durationMs).padEnd(8),
      fmtUsd(m.metrics.aiCostUsd).padEnd(10),
      m.metrics.confidence === null ? '-' : m.metrics.confidence.toFixed(2),
    ].join(' '));
    if (m.reason) console.log(c.dim(`${' '.repeat(width)}   ${m.reason}`));
  }

  const findings = result.modules.flatMap((m) => m.findings);
  if (findings.length) console.log('');
  for (const f of findings) {
    const where = f.location ? `${f.location.file}${f.location.startLine ? `:${f.location.startLine}` : ''}` : '';
    const dep = f.dependency ? `${f.dependency.name}${f.dependency.version ? `@${f.dependency.version}` : ''}${f.dependency.fixedIn ? ` → ${f.dependency.fixedIn}` : ''}` : '';
    console.log(`${SEVERITY_LABEL[f.severity]}  ${f.title} ${c.dim(`(${f.ruleId})`)}`);
    console.log(c.dim(`          ${[f.moduleId, where, dep].filter(Boolean).join(' · ')}`));
  }
  if (result.savedTo) console.log(`\n${c.dim('저장:')} ${relative(process.cwd(), result.savedTo) || result.savedTo}`);
}
