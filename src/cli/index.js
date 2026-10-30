import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { createAiProvider } from '../core/ai.js';
import { benchModule, readExpected } from '../core/bench.js';
import { findIssue, loadIssues } from '../core/issues.js';
import { CommandNotFoundError, runCommand } from '../core/exec.js';
import { appliesTo, scanProject } from '../core/project.js';
import { discoverModules, loadModule, PACKAGE_ROOT, scaffoldModule } from '../core/registry.js';
import { runScan } from '../core/runner.js';
import { loadSettings, optionsFor } from '../core/settings.js';
import { CATEGORIES } from '../sdk/index.js';
import { banner, c, createRenderer, fmtMs, fmtUsd, pad, printIssue, printIssueBoard, printSummary } from './render.js';

const HELP = `
${banner()}  웹 개발자를 위한 보안 검사 프레임워크

사용법
  safescan run   [경로] [-p 3000]       로컬 UI 실행 (http://localhost:3000)
  safescan setup [--apply]              Claude Code · Codex 에 SafeScan 을 연결하는 방법 (--apply: Claude Code 에 바로 등록)
  safescan mcp   [-p 3000]              MCP 서버 (Claude Code 가 실행합니다. 로컬 UI 도 함께 켜짐)
  safescan list  [경로]                 모듈 목록 (경로를 주면 적용 여부도 표시)
  safescan scan  [경로] [옵션]          검사 실행 (기본: 프로젝트에 맞는 모듈 자동 선택)
      -m, --modules a,b                 실행할 모듈 지정
          --all                         모든 모듈 실행
      -o, --option 모듈.키=값            모듈 옵션 (여러 번 사용 가능)
      -v, --verbose                     도구 출력까지 모두 표시
          --json                        결과를 JSON 으로 출력
          --no-save                     .safescan/runs 에 저장하지 않음
  safescan issues [경로] [--all] [--show id] [--json]
                                        검사 결과로 쌓인 이슈 (발견됨 · 해결 중 · 조치 완료)
  safescan new   <id> [--name 이름] [--category ${CATEGORIES.join('|')}]
                                        템플릿으로 새 모듈 만들기
  safescan check [id...]                모듈 계약 검사 (매니페스트 · 코드 · fixtures · 필요 도구)
  safescan bench [id...] [-v]           fixtures 로 정확도 측정 후 기록 (.safescan/bench)

AI 설정 (선택)
  ANTHROPIC_API_KEY                     있으면 AI 를 쓰는 모듈이 Claude 를 사용
  SAFESCAN_AI_PROVIDER                  anthropic | mock | none
  SAFESCAN_AI_MODEL                     기본 claude-opus-5-5
`;

export async function main(argv) {
  const [command = 'help', ...rest] = argv;
  const commands = { run, setup, mcp, list, scan, issues, new: create, check, bench, help: async () => console.log(HELP) };
  const handler = commands[command] ?? (command === '-h' || command === '--help' ? commands.help : null);
  if (!handler) {
    console.error(c.err(`알 수 없는 명령: ${command}`));
    console.log(HELP);
    return 1;
  }
  try {
    return (await handler(rest)) ?? 0;
  } catch (err) {
    console.error(c.err(`오류: ${err.message}`));
    return 1;
  }
}

const LOGO = [
  '╔═╗┌─┐┌─┐┌─┐  ╔═╗┌─┐┌─┐┌┐┌',
  '╚═╗├─┤├┤ ├┤   ╚═╗│  ├─┤│││',
  '╚═╝┴ ┴└  └─┘  ╚═╝└─┘┴ ┴┘└┘',
];

async function run(args) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: { port: { type: 'string', short: 'p' } },
  });
  const root = resolve(positionals[0] ?? '.');
  if (!(await isDir(root))) fail(`폴더가 아닙니다: ${root}`);
  const { startServer, UI_DIR } = await import('../server/index.js');
  if (!(await isFile(join(UI_DIR, 'index.html')))) {
    console.log(c.warn('! UI 가 아직 빌드되지 않았습니다. safescan 폴더에서 npm run build:ui 를 먼저 실행하세요.'));
  }
  const server = await startServer({
    projectRoot: root,
    port: values.port ? Number(values.port) : 3000,
    strictPort: Boolean(values.port),
    aiProvider: createAiProvider(),
  });

  // 지원하는 터미널에서는 링크를 바로 클릭할 수 있습니다 (OSC 8). 주소에는 이번 실행의 접속 토큰이 들어 있습니다.
  const link = process.stdout.isTTY ? `\x1b]8;;${server.uiUrl}\x1b\\${server.uiUrl}\x1b]8;;\x1b\\` : server.uiUrl;
  console.log(`\n${LOGO.map((line) => `  ${c.sky(line)}`).join('\n')}\n`);
  console.log(`  ${c.dim('대상')}  ${root}`);
  console.log(`  ${c.dim('UI  ')}  ${c.bold(c.sky(link))}`);
  console.log(`  ${c.dim('AI  ')}  ${createAiProvider().available ? 'API 키' : '없음 (규칙 기반 추천만) — Claude 에 연결하려면 safescan setup'}`);
  console.log(c.dim('\n  Ctrl+C 로 종료합니다'));

  await new Promise((done) => {
    const stop = () => server.close().then(done);
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  });
  return 0;
}

/** Claude Code 가 띄우는 MCP 서버. stdout 은 MCP 통신 전용이라 화면 출력은 모두 stderr 로 보냅니다. */
async function mcp(args) {
  console.log = console.error;
  const { values } = parseArgs({ args, allowPositionals: false, options: { port: { type: 'string', short: 'p' } } });
  const { startMcp } = await import('../mcp/index.js');
  const { server, close } = await startMcp({
    port: values.port ? Number(values.port) : 3000,
    strictPort: Boolean(values.port),
  });
  console.error(`SafeScan MCP: ${server.uiUrl} (${process.cwd()})`);
  await new Promise((done) => {
    const stop = () => close().then(done);
    process.stdin.once('end', stop); // Claude Code 가 끝나면 stdin 이 닫힙니다
    process.stdin.once('close', stop);
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  });
  return 0;
}

/** Claude Code · Codex 에 SafeScan 을 연결하는 명령을 알려 주거나(--apply) 직접 등록합니다. */
async function setup(args) {
  const { values } = parseArgs({ args, allowPositionals: false, options: { apply: { type: 'boolean' } } });
  const bin = join(PACKAGE_ROOT, 'bin', 'safescan.js').replaceAll('\\', '/');
  const claudeAdd = ['mcp', 'add', '--scope', 'user', 'safescan', '--', 'node', bin, 'mcp'];
  const quote = (a) => (/[\s"]/.test(a) ? JSON.stringify(a) : a);

  console.log(`\n${banner()}  Claude 에 연결하기\n`);
  console.log(`${c.bold('1. Claude Code 에 등록')} ${c.dim('(한 번만, 모든 프로젝트에서 사용)')}`);
  console.log(`   claude ${claudeAdd.map(quote).join(' ')}`);
  console.log(`\n${c.bold('2. 사용')}`);
  console.log(`   ${c.sky('자동 (터미널 CLI)')}  프로젝트 폴더에서  claude --dangerously-load-development-channels server:safescan`);
  console.log(c.dim('                      화면 버튼을 누르면 이 Claude 세션이 바로 작업합니다 (채널 · 연구 미리보기)'));
  console.log(`   ${c.sky('채팅 (데스크톱 앱)')}  평소처럼 세션을 열고, 화면에서 버튼을 누른 뒤 "SafeScan 요청 처리해 줘" 라고 입력`);
  console.log(`   ${c.sky('화면 열기')}          Claude 에게 "SafeScan 열어 줘"`);
  console.log(`\n${c.bold('Codex')}  codex mcp add safescan -- node ${quote(bin)} mcp`);
  console.log(c.dim('\n채널이 연결되지 않으면 MCP_PROTOCOL_NEGOTIATION=legacy 로 Claude Code 를 실행해 보세요.'));

  if (!values.apply) return 0;
  try {
    const existing = await runCommand('claude', ['mcp', 'get', 'safescan'], { timeoutMs: 30_000 }).catch(() => null);
    if (existing?.code === 0) {
      console.log(`\n${c.ok('✓')} 이미 등록되어 있습니다 (claude mcp get safescan)`);
      return 0;
    }
    const added = await runCommand('claude', claudeAdd, { timeoutMs: 30_000 });
    if (added.code !== 0) fail(`claude mcp add 실패: ${(added.stderr || added.stdout).trim()}`);
    console.log(`\n${c.ok('✓')} Claude Code 에 safescan 을 등록했습니다. 새 Claude 세션부터 적용됩니다.`);
    return 0;
  } catch (err) {
    if (err instanceof CommandNotFoundError) fail('claude 명령을 찾을 수 없습니다. Claude Code CLI 를 설치하거나 위 명령을 직접 실행하세요');
    throw err;
  }
}

async function list(args) {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: { json: { type: 'boolean' } } });
  const entries = await discoverModules();
  const index = positionals[0] ? (await scanProject(resolve(positionals[0]))).index : null;
  const rows = entries.map((e) => ({
    id: e.id,
    name: e.manifest.name,
    category: e.manifest.category,
    tool: e.manifest.tool?.name,
    ai: e.manifest.ai ?? 'none',
    status: e.manifest.status ?? 'experimental',
    applies: index && !e.errors.length ? appliesTo(e.manifest, index) : null,
    errors: e.errors,
  }));
  if (values.json) {
    console.log(JSON.stringify(rows, null, 2));
    return 0;
  }
  const w = Math.max(4, ...rows.map((r) => r.id.length));
  console.log(c.dim(`${'id'.padEnd(w)}  ${pad('분류', 10)} ${pad('도구', 14)} ${'AI'.padEnd(8)} 상태`));
  for (const r of rows) {
    const applies = r.applies ? (r.applies.applies ? c.ok(' 적용') : c.dim(' 해당 없음')) : '';
    const broken = r.errors.length ? c.err(` 매니페스트 오류 ${r.errors.length}건`) : '';
    console.log(`${c.sky(r.id.padEnd(w))}  ${String(r.category).padEnd(10)} ${String(r.tool).padEnd(14)} ${r.ai.padEnd(8)} ${r.status}${applies}${broken}`);
  }
  return 0;
}

async function scan(args) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      modules: { type: 'string', short: 'm' },
      all: { type: 'boolean' },
      option: { type: 'string', short: 'o', multiple: true },
      verbose: { type: 'boolean', short: 'v' },
      json: { type: 'boolean' },
      'no-save': { type: 'boolean' },
    },
  });
  const root = resolve(positionals[0] ?? '.');
  const entries = await discoverModules();
  for (const e of entries) if (e.errors.length) console.error(c.warn(`! ${e.id}: module.json 오류로 제외 — ${e.errors[0]}`));
  const valid = entries.filter((e) => !e.errors.length);

  let selected;
  if (values.modules) {
    const ids = values.modules.split(',').map((s) => s.trim()).filter(Boolean);
    selected = ids.map((id) => valid.find((e) => e.id === id) ?? fail(`모듈을 찾을 수 없습니다: ${id}`));
  } else if (values.all) {
    selected = valid;
  } else {
    const { index } = await scanProject(root);
    selected = valid.filter((e) => appliesTo(e.manifest, index).applies);
  }
  if (!selected.length) {
    console.log('실행할 모듈이 없습니다. safescan list <경로> 로 적용 여부를 확인하거나 -m 으로 지정하세요.');
    return 0;
  }

  // 화면에서 저장한 모듈 옵션 위에 -o 값을 덮어 씁니다.
  const saved = (await loadSettings(join(root, '.safescan'))).options;
  const result = await runScan({
    projectRoot: root,
    modules: selected,
    options: optionsFor(selected, saved, parseModuleOptions(values.option ?? [])),
    aiProvider: createAiProvider(),
    onEvent: values.json ? undefined : createRenderer({ verbose: values.verbose, idWidth: Math.max(...selected.map((e) => e.id.length)) }),
    storeDir: values['no-save'] ? null : undefined,
  });

  if (values.json) console.log(JSON.stringify(result, null, 2));
  else printSummary(result);
  return result.modules.some((m) => m.status === 'failed' || m.status === 'timeout') ? 1 : 0;
}

async function issues(args) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: { all: { type: 'boolean' }, show: { type: 'string' }, json: { type: 'boolean' } },
  });
  const store = await loadIssues(join(resolve(positionals[0] ?? '.'), '.safescan'));

  if (values.show) {
    const issue = findIssue(store, values.show) ?? fail(`이슈를 찾을 수 없습니다: ${values.show}`);
    if (values.json) console.log(JSON.stringify(issue, null, 2));
    else printIssue(issue);
    return 0;
  }
  const list = values.all ? store.issues : store.issues.filter((i) => i.status !== 'resolved');
  if (values.json) console.log(JSON.stringify(list, null, 2));
  else if (!store.issues.length) console.log('아직 이슈가 없습니다. safescan scan 으로 검사하면 결과가 이슈로 쌓입니다.');
  else printIssueBoard(store.issues, { showResolved: values.all });
  return 0;
}

async function create(args) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: { name: { type: 'string' }, category: { type: 'string' } },
  });
  const id = positionals[0] ?? fail('모듈 id 가 필요합니다. 예: safescan new semgrep-xss --category sast');
  const dir = await scaffoldModule({ id, name: values.name, category: values.category });
  const rel = (relative(process.cwd(), dir) || dir).replaceAll('\\', '/');
  console.log(`${c.ok('✓')} 모듈을 만들었습니다: ${c.sky(rel)}`);
  console.log(c.dim(`
  다음 순서로 채우세요 (자세한 규칙: docs/MODULE_GUIDE.md)
    1. ${rel}/module.json          설명 · 도구 · requires · appliesWhen
    2. ${rel}/index.js             preprocess → tool → postprocess → verify
    3. ${rel}/fixtures/vulnerable/ 취약한 예제 프로젝트
    4. ${rel}/fixtures/expected.json  찾아야 하는 결과
    5. safescan check ${id} && safescan bench ${id}`));
  return 0;
}

async function check(args) {
  const { positionals } = parseArgs({ args, allowPositionals: true, options: {} });
  const entries = await discoverModules();
  const targets = positionals.length
    ? positionals.map((id) => entries.find((e) => e.id === id) ?? fail(`모듈을 찾을 수 없습니다: ${id}`))
    : entries;

  let failed = 0;
  for (const entry of targets) {
    const errors = [...entry.errors];
    const warnings = [];
    if (!errors.length) {
      await loadModule(entry).catch((err) => errors.push(`index.js: ${err.message}`));
    }
    if (!(await isFile(join(entry.dir, 'README.md')))) errors.push('README.md 가 없습니다');
    const vulnDir = join(entry.dir, 'fixtures', 'vulnerable');
    if (!(await isDir(vulnDir)) || !(await readdir(vulnDir)).some((n) => n !== '.gitkeep')) {
      errors.push('fixtures/vulnerable/ 에 예제 프로젝트가 없습니다');
    }
    await readExpected(entry.dir).catch((err) => errors.push(err.message));
    for (const req of entry.manifest.requires ?? []) {
      try {
        await runCommand(req.bin, req.versionArgs ?? ['--version'], { timeoutMs: 20_000 });
      } catch (err) {
        warnings.push(err instanceof CommandNotFoundError ? `'${req.bin}' 미설치 — ${req.install}` : `'${req.bin}' 확인 실패: ${err.message}`);
      }
    }
    for (const rel of ['module.json', 'index.js', 'README.md', 'fixtures/expected.json']) {
      const text = await readFile(join(entry.dir, rel), 'utf8').catch(() => '');
      if (text.includes('TODO')) warnings.push(`${rel} 에 TODO 가 남아 있습니다`);
    }

    if (errors.length) failed += 1;
    console.log(`${errors.length ? c.err('✗') : c.ok('✓')} ${c.sky(entry.id)}`);
    for (const e of errors) console.log(`    ${c.err('·')} ${e}`);
    for (const w of warnings) console.log(`    ${c.warn('!')} ${w}`);
  }
  console.log(c.dim(`\n${targets.length}개 중 ${targets.length - failed}개 통과`));
  return failed ? 1 : 0;
}

async function bench(args) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: { verbose: { type: 'boolean', short: 'v' } },
  });
  const entries = (await discoverModules()).filter((e) => !e.errors.length);
  const targets = positionals.length
    ? positionals.map((id) => entries.find((e) => e.id === id) ?? fail(`모듈을 찾을 수 없습니다 (또는 매니페스트 오류): ${id}`))
    : entries;

  const aiProvider = createAiProvider();
  let failed = 0;
  for (const entry of targets) {
    const onEvent = values.verbose ? createRenderer({ verbose: true, idWidth: entry.id.length }) : undefined;
    const { record, previous, score } = await benchModule(entry, { aiProvider, onEvent });
    const pct = (v) => (v === null ? '-' : `${(v * 100).toFixed(1)}%`);
    const delta = (key) => {
      if (!previous || previous[key] === null || record[key] === null) return '';
      const d = record[key] - previous[key];
      return d === 0 ? '' : c.dim(` (${d > 0 ? '+' : ''}${(d * 100).toFixed(1)}%p)`);
    };

    console.log(`\n${c.sky(c.bold(entry.id))} ${c.dim(`v${record.moduleVersion}`)}  ${record.status === 'ok' ? c.ok('ok') : c.err(record.status)}${record.reason ? c.dim(` — ${record.reason}`) : ''}`);
    if (record.status === 'failed' || record.status === 'timeout') failed += 1;
    if (record.status !== 'ok') continue;
    console.log(`  정밀도 ${pct(record.precision)}${delta('precision')}   재현율 ${pct(record.recall)}${delta('recall')}   F1 ${pct(record.f1)}${delta('f1')}`);
    console.log(c.dim(`  TP ${record.tp} · FP ${record.fp ?? '-'} · FN ${record.fn} · ${fmtMs(record.durationMs)} · AI ${fmtUsd(record.aiCostUsd)} (${record.aiInputTokens}+${record.aiOutputTokens} tok)`));
    console.log(c.dim(`  도구 ${Object.entries(record.toolVersions).map(([k, v]) => `${k} ${v}`).join(', ') || '-'}${record.aiModels.length ? ` · 모델 ${record.aiModels.join(', ')}` : ''}`));
    for (const m of score.missed) console.log(`  ${c.err('놓침')} ${JSON.stringify(m)}`);
    for (const x of score.extra) console.log(`  ${c.warn('추가')} ${x.ruleId} ${c.dim(x.title)}`);
  }
  return failed ? 1 : 0;
}

/** "-o npm-audit.omitDev=true" → { 'npm-audit': { omitDev: true } } */
function parseModuleOptions(pairs) {
  /** @type {Record<string, Record<string, string | number | boolean>>} */
  const out = {};
  for (const pair of pairs) {
    const m = /^([a-z0-9-]+)\.([\w-]+)=(.*)$/.exec(pair) ?? fail(`옵션 형식은 모듈.키=값 입니다: ${pair}`);
    const [, id, key, rawValue] = m;
    const value = rawValue === 'true' ? true : rawValue === 'false' ? false
      : rawValue !== '' && Number.isFinite(Number(rawValue)) ? Number(rawValue) : rawValue;
    (out[id] ??= {})[key] = value;
  }
  return out;
}

/** @returns {never} */
function fail(message) {
  throw new Error(message);
}

const isFile = (p) => stat(p).then((s) => s.isFile(), () => false);
const isDir = (p) => stat(p).then((s) => s.isDirectory(), () => false);
