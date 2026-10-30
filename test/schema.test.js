import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { meterAi, parseJsonReply } from '../src/core/ai.js';
import { childEnv } from '../src/core/exec.js';
import { scoreFindings } from '../src/core/bench.js';
import { appliesTo, compileIgnore, createProjectApi, scanProject } from '../src/core/project.js';
import { normalizeFinding, resolveOptions, validateManifest } from '../src/core/schema.js';

const manifest = {
  id: 'demo', name: '데모', version: '0.1.0', description: '설명', category: 'sast',
  tool: { name: 'semgrep', homepage: 'https://semgrep.dev' },
};

test('validateManifest: 최소 매니페스트는 통과', () => {
  assert.deepEqual(validateManifest(manifest, 'demo'), []);
});

test('validateManifest: 폴더 이름 불일치 · 알 수 없는 필드 · 형식 오류를 잡는다', () => {
  const errors = validateManifest({ ...manifest, owasp: ['A5'], extra: 1, version: 'v1' }, 'other');
  assert.ok(errors.some((e) => e.includes('폴더 이름')));
  assert.ok(errors.some((e) => e.includes('알 수 없는 필드: extra')));
  assert.ok(errors.some((e) => e.includes('owasp')));
  assert.ok(errors.some((e) => e.includes('semver')));
});

test('validateManifest: 검증 기준(criteria)과 번역(i18n) 형식을 확인한다', () => {
  const ok = {
    ...manifest,
    criteria: { confidence: [{ min: 0.9, label: '확실' }, { min: 0.5, label: '추정' }], accuracy: { precision: 0.9, recall: 0.7 } },
    i18n: { en: { name: 'Demo', description: 'desc', criteria: ['Sure', 'Guess'] }, 'zh-CN': { name: '演示' } },
  };
  assert.deepEqual(validateManifest(ok, 'demo'), []);
  const bad = validateManifest({
    ...manifest,
    criteria: { confidence: [{ min: 2, label: '' }], accuracy: { recall: 1.5 } },
    i18n: { English: { name: 1 }, en: { criteria: 'x' } },
  }, 'demo');
  for (const part of ['confidence[0].min', 'confidence[0].label', 'accuracy.recall', 'i18n.English', 'i18n.en.criteria']) {
    assert.ok(bad.some((e) => e.includes(part)), `${part} 오류가 있어야 합니다: ${bad.join(' / ')}`);
  }
});

test('normalizeFinding: 상대 경로만 허용', () => {
  const base = { ruleId: 'r', title: 't', severity: 'high', confidence: 0.5 };
  assert.ok(normalizeFinding({ ...base, location: { file: 'src/a.js' } }, 'm').finding);
  assert.ok(normalizeFinding({ ...base, location: { file: 'C:/a.js' } }, 'm').errors.length);
  assert.ok(normalizeFinding({ ...base, location: { file: 'src\\a.js' } }, 'm').errors.length);
  assert.ok(normalizeFinding({ ...base, location: { file: '/etc/a.js' } }, 'm').errors.length);
});

test('normalizeFinding: snippet 이 있으면 줄 번호가 바뀌어도 fingerprint 가 같다', () => {
  const f = (line) => ({ ruleId: 'r', title: 't', severity: 'low', confidence: 1, location: { file: 'a.js', startLine: line, snippet: 'eval(x)' } });
  const a = normalizeFinding(f(3), 'm').finding;
  const b = normalizeFinding(f(10), 'm').finding;
  assert.equal(a.fingerprint, b.fingerprint);
  assert.notEqual(a.fingerprint, normalizeFinding({ ...f(3), ruleId: 'r2' }, 'm').finding.fingerprint);
  assert.deepEqual(a.owasp, []);
});

test('resolveOptions: 기본값 · 덮어쓰기 · 타입 검사', () => {
  const m = { id: 'x', options: { level: { type: 'enum', label: 'l', choices: ['a', 'b'], default: 'a' }, n: { type: 'number', label: 'n' } } };
  assert.deepEqual(resolveOptions(m), { level: 'a' });
  assert.deepEqual(resolveOptions(m, { level: 'b', n: 3 }), { level: 'b', n: 3 });
  assert.throws(() => resolveOptions(m, { level: 'c' }));
  assert.throws(() => resolveOptions(m, { n: '3' }));
  assert.throws(() => resolveOptions(m, { unknown: true }));
});

test('scoreFindings: 정밀도 · 재현율 계산과 줄 번호 허용 범위', () => {
  const f = (ruleId, line) => ({ ruleId, location: { file: 'a.js', startLine: line } });
  const findings = [f('xss', 11), f('sqli', 40), f('noise', 1)];
  const strict = scoreFindings(findings, {
    allowExtra: false,
    findings: [{ ruleId: 'xss', file: 'a.js', line: 10 }, { ruleId: 'sqli', line: 30 }],
  });
  assert.deepEqual([strict.tp, strict.fp, strict.fn], [1, 2, 1]);
  assert.equal(strict.precision, 0.333);
  assert.equal(strict.recall, 0.5);

  const loose = scoreFindings(findings, { allowExtra: true, findings: [{ ruleId: 'xss' }] });
  assert.equal(loose.precision, null);
  assert.equal(loose.recall, 1);
});

test('appliesTo: 파일 이름과 확장자 패턴', () => {
  const index = { basenames: new Set(['package.json']), exts: new Set(['.py']) };
  assert.equal(appliesTo({ appliesWhen: { files: ['*.py'] } }, index).applies, true);
  assert.equal(appliesTo({ appliesWhen: { files: ['pom.xml'] } }, index).applies, false);
  assert.equal(appliesTo({}, index).applies, true);
});

test('compileIgnore: 이름 · 루트 기준 · 와일드카드 패턴', () => {
  const ignored = compileIgnore(['dist/', '*.min.js', 'modules/*/fixtures/', '/root-only.txt', 'docs/**/draft']);
  // 슬래시가 없으면 어느 깊이에서든 이름으로 맞춤, 폴더면 그 아래 전부
  assert.equal(ignored('dist'), true);
  assert.equal(ignored('packages/web/dist/app.js'), true);
  assert.equal(ignored('distribution/app.js'), false);
  assert.equal(ignored('public/js/vendor.min.js'), true);
  assert.equal(ignored('public/js/vendor.js'), false);
  // 슬래시가 있으면 루트 기준, * 는 한 단계만
  assert.equal(ignored('modules/npm-audit/fixtures/vulnerable/package-lock.json'), true);
  assert.equal(ignored('modules/npm-audit/index.js'), false);
  assert.equal(ignored('src/modules/a/fixtures/x.js'), false);
  assert.equal(ignored('root-only.txt'), true);
  assert.equal(ignored('sub/root-only.txt'), false);
  // ** 는 0단계 이상
  assert.equal(ignored('docs/draft'), true);
  assert.equal(ignored('docs/a/b/draft/x.md'), true);
  assert.equal(compileIgnore([])('anything'), false);
});

test('.safescanignore 는 환경 분석과 ctx.project.findFiles 에 함께 적용된다', async () => {
  const root = fileURLToPath(new URL('./fixtures/project/', import.meta.url));
  const { profile, isIgnored } = await scanProject(root);
  assert.deepEqual(profile.ignore, ['generated/']);
  const api = createProjectApi(root, profile, isIgnored);
  assert.deepEqual(await api.findFiles({ exts: ['.js'] }), ['src/app.js']);
});

test('ctx.project 는 프로젝트 밖 경로를 막는다', () => {
  const api = createProjectApi(process.cwd(), /** @type {any} */ ({}));
  assert.throws(() => api.resolve('../outside.txt'), /프로젝트 밖/);
  assert.ok(api.resolve('src/a.js'));
});

test('childEnv: Windows 에서는 PATH 항목의 따옴표를 빼 cmd.exe 가 뒤쪽 항목도 찾게 한다', () => {
  const env = childEnv({ PATH: 'C:\\a;C:\\Program Files\\dotnet";;C:\\npm', EXTRA: '1' });
  const pathKey = Object.keys(env).find((k) => k.toUpperCase() === 'PATH');
  if (process.platform === 'win32') assert.equal(env[pathKey], 'C:\\a;C:\\Program Files\\dotnet;C:\\npm');
  else assert.equal(env.PATH, 'C:\\a;C:\\Program Files\\dotnet";;C:\\npm');
  assert.equal(env.EXTRA, '1');
});

test('parseJsonReply: 코드 블록 · 앞뒤 설명이 있어도 읽는다', () => {
  assert.deepEqual(parseJsonReply('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(parseJsonReply('결과입니다: [1,2] 끝'), [1, 2]);
  assert.throws(() => parseJsonReply('없음'));
});

test('meterAi: 거절 응답도 비용은 기록하고 에러를 던진다', async () => {
  const records = [];
  const provider = {
    name: 'fake',
    available: true,
    model: 'claude-opus-5-5',
    complete: async () => ({
      text: '', model: 'claude-opus-5-5', usage: { inputTokens: 1000, outputTokens: 100 }, stopReason: 'refusal', refusalCategory: 'cyber',
    }),
  };
  const ai = meterAi(provider, { stage: 'preprocess', onCall: (r) => records.push(r) });
  await assert.rejects(ai.complete({ prompt: 'x', purpose: '테스트' }), /거절.*cyber/);
  assert.equal(records.length, 1);
  assert.equal(records[0].costUsd, 0.006);
  assert.equal(records[0].stage, 'preprocess');
});
