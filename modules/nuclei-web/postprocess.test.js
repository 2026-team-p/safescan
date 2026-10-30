// 후처리 · 전처리 단위 테스트. nuclei 도 서버도 필요 없습니다.
// 실행: node --test modules/nuclei-web/postprocess.test.js
//   (test/ 는 모듈 밖이라 npm test 에 포함되지 않습니다 — README 의 코어 변경 요청 참고)
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeFinding } from '../../src/core/schema.js';
import mod from './index.js';

// 실제 nuclei v3 출력에서 절대 경로 · base64 템플릿 · curl 명령만 뺀 샘플
const sample = await readFile(fileURLToPath(new URL('./fixtures/sample-output.jsonl', import.meta.url)), 'utf8');

const warnings = [];
const ctx = { log: { warn: (m) => warnings.push(m), info() {}, debug() {}, error() {} } };
const run = (stdout) => mod.postprocess(ctx, { stdout, stderr: '' }, {});
const line = (over = {}) => JSON.stringify({
  'template-id': 'demo', info: { name: '데모', severity: 'medium', tags: ['misconfig'] },
  'matched-at': 'http://127.0.0.1:3999/a?x=1', ...over,
});

test('실제 출력 샘플이 Finding 2건이 되고 계약 검사를 통과한다', () => {
  const findings = run(sample);
  assert.equal(findings.length, 2);
  for (const f of findings) {
    const { finding, errors } = normalizeFinding(f, 'nuclei-web');
    assert.deepEqual(errors, []);
    assert.equal(finding.fingerprint, f.fingerprint);
  }
});

test('필드 매핑: ruleId · title · severity · cwe · remediation · owasp', () => {
  const debug = run(sample).find((f) => f.ruleId === 'safescan-debug-endpoint');
  assert.equal(debug.title, '디버그 엔드포인트 노출');
  assert.equal(debug.severity, 'high');
  assert.deepEqual(debug.cwe, ['CWE-489']); // nuclei 는 소문자("cwe-489")로 내보냄
  assert.deepEqual(debug.owasp, ['A02:2025']);
  assert.equal(debug.confidence, 0.85);
  assert.match(debug.remediation, /디버그 엔드포인트/);
  assert.match(debug.description, /http:\/\/127\.0\.0\.1:3999\/debug/);
  assert.equal(debug.location, undefined); // URL 은 프로젝트 파일 경로가 아님
});

test('raw 에 내 컴퓨터의 경로나 템플릿 원문을 담지 않는다', () => {
  const dumped = JSON.stringify(run(sample));
  assert.ok(!dumped.includes('/Users/'));
  assert.ok(!dumped.includes('template-encoded'));
  assert.ok(!dumped.includes('curl'));
});

test('severity 매핑: info · unknown 은 low 로, 신뢰도 0.6', () => {
  for (const severity of ['info', 'unknown']) {
    const [f] = run(line({ info: { name: 'x', severity, tags: [] } }));
    assert.equal(f.severity, 'low');
    assert.equal(f.confidence, 0.6);
  }
  assert.equal(run(line({ info: { name: 'x', severity: 'critical' } }))[0].severity, 'critical');
});

test('추출 결과가 있으면 신뢰도 0.9', () => {
  assert.equal(run(line({ 'extracted-results': ['v1.2'] }))[0].confidence, 0.9);
});

test('태그로 OWASP 를 채우고, 맞는 태그가 없으면 A02', () => {
  assert.deepEqual(run(line({ info: { name: 'x', severity: 'low', tags: ['cve', 'xss'] } }))[0].owasp, ['A03:2025', 'A05:2025']);
  assert.deepEqual(run(line({ info: { name: 'x', severity: 'low', tags: ['whatever'] } }))[0].owasp, ['A02:2025']);
});

test('CVE 는 참고 링크로, 잘못된 CWE 값은 버린다', () => {
  const [f] = run(line({ info: { name: 'x', severity: 'high', tags: ['cve'], classification: { 'cve-id': ['CVE-2024-0001'], 'cwe-id': ['cwe-79', 'abc'] } } }));
  assert.deepEqual(f.cwe, ['CWE-79']);
  assert.deepEqual(f.references, ['https://nvd.nist.gov/vuln/detail/CVE-2024-0001']);
});

test('fingerprint: 쿼리만 다른 같은 경로는 같고, 경로 · 템플릿 · matcher 가 다르면 다르다', () => {
  const fp = (over) => run(line(over))[0].fingerprint;
  assert.equal(fp({ 'matched-at': 'http://127.0.0.1:3999/a?x=1' }), fp({ 'matched-at': 'http://127.0.0.1:3999/a?y=2#z' }));
  assert.notEqual(fp({}), fp({ 'matched-at': 'http://127.0.0.1:3999/b' }));
  assert.notEqual(fp({}), fp({ 'template-id': 'other' }));
  assert.notEqual(fp({}), fp({ 'matcher-name': 'second' }));
});

test('두 번 처리해도 fingerprint 가 같다 (재검사 · 재검증에서 이슈가 이어짐)', () => {
  assert.deepEqual(run(sample).map((f) => f.fingerprint), run(sample).map((f) => f.fingerprint));
});

test('잘못된 줄은 버리고 경고하며, 나머지는 처리한다', () => {
  warnings.length = 0;
  const findings = run(`not json\n${line()}\n{"no":"template-id"}\n\n`);
  assert.equal(findings.length, 1);
  assert.equal(warnings.length, 2);
});

test('출력이 비어 있으면 Finding 이 없다', () => {
  assert.deepEqual(run(''), []);
});

test('verify: 정상이면 모든 check 통과, 읽지 못한 줄이나 nuclei 오류가 있으면 실패', () => {
  const findings = run(sample);
  const ok = mod.verify(ctx, { raw: { stdout: sample, stderr: '' }, findings });
  assert.ok(ok.checks.every((c) => c.passed));
  const bad = mod.verify(ctx, { raw: { stdout: `${sample}garbage\n`, stderr: '[FTL] could not load templates' }, findings });
  assert.deepEqual(bad.checks.filter((c) => !c.passed).map((c) => c.name), ['JSONL 형식', 'nuclei 오류 없음']);
});

// ── 전처리 ──

const SKIPPED = Symbol('skipped');
function prepCtx(options, { ai } = {}) {
  const logs = [];
  return {
    options: { severity: ['low', 'medium', 'high', 'critical'], rateLimit: 50, tags: '', templates: 'bundled', useAiTags: true, allowRemote: false, ...options },
    project: { profile: { languages: ['JavaScript'], frameworks: ['express'], packageManagers: ['npm'] } },
    ai: ai ?? { available: false },
    log: { info: (m) => logs.push(m), warn: (m) => logs.push(m), debug() {}, error() {} },
    skip: (reason) => { throw Object.assign(new Error(reason), { [SKIPPED]: true }); },
    logs,
  };
}
const skipsWith = async (options, pattern) => {
  await assert.rejects(() => mod.preprocess(prepCtx(options)), (err) => err[SKIPPED] && pattern.test(err.message));
};

test('전처리: 주소가 없으면 건너뛴다', async () => {
  await skipsWith({}, /서버 주소가 없습니다/);
  await skipsWith({ targetUrl: '   ' }, /서버 주소가 없습니다/);
});

test('전처리: localhost 가 아니면 allowRemote 없이는 건너뛴다', async () => {
  await skipsWith({ targetUrl: 'https://example.com' }, /allowRemote/);
  await skipsWith({ targetUrl: 'http://localhost.evil.com' }, /allowRemote/); // 접두사만 같은 호스트
  await skipsWith({ targetUrl: 'http://127.0.0.1.evil.com' }, /allowRemote/);
  const input = await mod.preprocess(prepCtx({ targetUrl: 'https://example.com', allowRemote: true }));
  assert.equal(input.url, 'https://example.com');
});

test('전처리: localhost · 127.0.0.1 · ::1 은 통과하고 경로만 남긴다', async () => {
  for (const u of ['http://localhost:3000', 'http://127.0.0.1:3000/', 'http://[::1]:3000']) {
    const input = await mod.preprocess(prepCtx({ targetUrl: u }));
    assert.match(input.url, /^http:\/\/(localhost|127\.0\.0\.1|\[::1\]):3000$/);
  }
  assert.equal((await mod.preprocess(prepCtx({ targetUrl: 'http://localhost:3000/app?x=1' }))).url, 'http://localhost:3000/app');
});

test('전처리: http(s) 가 아니거나 계정 정보가 들어 있으면 건너뛴다', async () => {
  await skipsWith({ targetUrl: 'file:///etc/passwd' }, /http/);
  await skipsWith({ targetUrl: 'ftp://localhost' }, /http/);
  await skipsWith({ targetUrl: 'http://user:pw@localhost:3000' }, /계정 정보/);
  await skipsWith({ targetUrl: 'not a url' }, /형식/);
});

test('전처리: 옵션 검증', async () => {
  await assert.rejects(mod.preprocess(prepCtx({ targetUrl: 'http://localhost', severity: ['low', 'bogus'] })), /severity/);
  await assert.rejects(mod.preprocess(prepCtx({ targetUrl: 'http://localhost', severity: 'low,bogus' })), /severity/);
  await assert.rejects(mod.preprocess(prepCtx({ targetUrl: 'http://localhost', tags: 'ok,bad tag;rm' })), /tags/);
  await assert.rejects(mod.preprocess(prepCtx({ targetUrl: 'http://localhost', rateLimit: 0 })), /rateLimit/);
});

test('전처리: 위험도는 배열(multi)로 받고 예전 쉼표 문자열도 받는다. 하나도 고르지 않으면 건너뛴다', async () => {
  const base = { targetUrl: 'http://localhost:3000' };
  assert.deepEqual((await mod.preprocess(prepCtx({ ...base, severity: ['high', 'critical'] }))).severity, ['high', 'critical']);
  assert.deepEqual((await mod.preprocess(prepCtx({ ...base, severity: 'info, low' }))).severity, ['info', 'low']);
  await skipsWith({ ...base, severity: [] }, /위험도/);
});

test('전처리: 태그 — 직접 지정 > AI > 기본값', async () => {
  const base = { targetUrl: 'http://localhost:3000' };
  assert.deepEqual((await mod.preprocess(prepCtx(base))).tags, ['exposure', 'misconfig']);
  assert.deepEqual((await mod.preprocess(prepCtx({ ...base, tags: 'cve, xss' }))).tags, ['cve', 'xss']);

  const ai = (json) => ({ available: true, complete: async () => ({ json }) });
  // 허용 목록 밖 태그(dos)는 버린다
  assert.deepEqual((await mod.preprocess(prepCtx(base, { ai: ai({ tags: ['cve', 'dos', 'exposure'] }) }))).tags, ['cve', 'exposure']);
  // 쓸 수 있는 태그가 없으면 기본값
  assert.deepEqual((await mod.preprocess(prepCtx(base, { ai: ai({ tags: ['dos'] }) }))).tags, ['exposure', 'misconfig']);
  // AI 호출이 실패해도 기본값으로 계속 간다
  const failing = { available: true, complete: async () => { throw new Error('boom'); } };
  assert.deepEqual((await mod.preprocess(prepCtx(base, { ai: failing }))).tags, ['exposure', 'misconfig']);
  // useAiTags 를 끄면 AI 를 부르지 않는다
  const never = { available: true, complete: async () => { throw new Error('호출되면 안 됨'); } };
  assert.deepEqual((await mod.preprocess(prepCtx({ ...base, useAiTags: false }, { ai: never }))).tags, ['exposure', 'misconfig']);
});

test('툴: 위험한 태그를 제외하고, 셸 문자열 없이 인자 배열로 nuclei 를 실행한다', async () => {
  let called;
  const toolCtx = {
    module: { dir: '/m' },
    exec: async (cmd, args, opts) => { called = { cmd, args, opts }; return { stdout: 'x', stderr: 'y' }; },
  };
  const input = { url: 'http://localhost:3000', severity: ['high'], tags: ['exposure'], rateLimit: 20, bundled: true };
  const raw = await mod.tool(toolCtx, input);
  assert.deepEqual(raw, { stdout: 'x', stderr: 'y' });
  assert.equal(called.cmd, 'nuclei');
  const at = (flag) => called.args[called.args.indexOf(flag) + 1];
  assert.equal(at('-u'), 'http://localhost:3000');
  assert.equal(at('-exclude-tags'), 'dos,fuzz,intrusive');
  assert.equal(at('-severity'), 'high');
  assert.equal(at('-tags'), 'exposure');
  assert.equal(at('-rl'), '20');
  assert.equal(at('-t'), join('/m', 'templates'));
  for (const flag of ['-no-stdin', '-ni', '-duc', '-omit-raw', '-jsonl']) assert.ok(called.args.includes(flag), flag);
  assert.deepEqual(called.opts.okExitCodes, [0, 1]);

  await mod.tool(toolCtx, { ...input, bundled: false });
  assert.ok(!called.args.includes('-t'));
});

test('툴: 위험도 · 태그에 맞는 템플릿이 없으면 건너뛴다', async () => {
  const toolCtx = {
    module: { dir: '/m' },
    exec: async () => ({ stdout: '', stderr: '[FTL] Could not run nuclei: no templates provided for scan' }),
    skip: (reason) => { throw Object.assign(new Error(reason), { [SKIPPED]: true }); },
  };
  const input = { url: 'http://localhost:3000', severity: ['info'], tags: [], rateLimit: 50, bundled: true };
  await assert.rejects(mod.tool(toolCtx, input), (err) => err[SKIPPED] && /템플릿이 없습니다/.test(err.message));
});
