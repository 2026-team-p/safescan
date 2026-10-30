import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { meterAi, parseJsonReply } from '../src/core/ai.js';
import { childEnv, versionLine } from '../src/core/exec.js';
import { scoreFindings } from '../src/core/bench.js';
import { appliesTo, compileIgnore, createProjectApi, scanProject } from '../src/core/project.js';
import { coerceOption, normalizeFinding, resolveOptions, sanitizeOptions, validateManifest } from '../src/core/schema.js';
import { compactOptions, optionsFor } from '../src/core/settings.js';

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
  assert.deepEqual(resolveOptions(m, { n: '3' }), { level: 'a', n: 3 }, 'CLI 에서 온 숫자 문자열은 숫자로 바꾼다');
  assert.throws(() => resolveOptions(m, { level: 'c' }));
  assert.throws(() => resolveOptions(m, { n: 'x' }));
  assert.throws(() => resolveOptions(m, { unknown: true }));
});

test('validateManifest: 옵션 형식 — 여러 개 고르기 · 범위 · 조건 · 기본값', () => {
  const options = {
    url: { type: 'string', label: '주소', format: 'url', required: true, placeholder: 'http://localhost:3000' },
    levels: { type: 'multi', label: '위험도', choices: ['low', 'high'], default: ['low', 'high'], choiceLabels: { low: '낮음' } },
    mode: { type: 'enum', label: '모드', choices: ['safe', 'full'], default: 'safe' },
    confirm: { type: 'boolean', label: '승인', default: false, when: { mode: 'full' } },
    minutes: { type: 'number', label: '시간', default: 2, min: 1, max: 10, unit: '분', advanced: true },
  };
  assert.deepEqual(validateManifest({ ...manifest, options }, 'demo'), []);
  const bad = validateManifest({
    ...manifest,
    options: {
      levels: { type: 'multi', label: '위험도', choices: ['low'], default: ['nope'] },
      minutes: { type: 'number', label: '시간', default: 20, max: 10 },
      flag: { type: 'boolean', label: '켜기', when: { missing: true }, min: 1 },
      name: { type: 'string', label: '이름', format: 'email' },
    },
  }, 'demo');
  for (const part of ['levels.default', 'minutes.default', 'flag.when.missing', 'flag.min', 'name.format']) {
    assert.ok(bad.some((e) => e.includes(part)), `${part} 오류가 있어야 합니다: ${bad.join(' / ')}`);
  }
});

test('coerceOption · sanitizeOptions: CLI 문자열을 바꾸고, 오래된 저장 값은 버린다', () => {
  const multi = { type: 'multi', label: 'm', choices: ['info', 'low', 'high'] };
  assert.deepEqual(coerceOption(multi, 'high, info').value, ['info', 'high'], '선택지 순서로 정리');
  assert.match(coerceOption(multi, ['x']).error, /x/);
  assert.equal(coerceOption({ type: 'boolean', label: 'b' }, 'false').value, false);
  assert.match(coerceOption({ type: 'number', label: 'n', min: 1 }, 0).error, /1 이상/);
  const url = { type: 'string', label: 'u', format: 'url' };
  assert.equal(coerceOption(url, ' http://127.0.0.1:4000 ').value, 'http://127.0.0.1:4000');
  assert.equal(coerceOption(url, '').value, '', '빈 값은 허용 (모듈이 건너뜀)');
  assert.ok(coerceOption(url, 'ftp://x').error);

  const m = { id: 'x', options: { a: { type: 'number', label: 'a', default: 1 }, b: { type: 'enum', label: 'b', choices: ['y'] } } };
  assert.deepEqual(sanitizeOptions(m, { a: '5', b: 'gone', old: 1 }), { options: { a: 5 }, dropped: ['b', 'old'] });
  assert.deepEqual(compactOptions(m, { a: 1, b: 'y' }), { b: 'y' }, '기본값과 같은 값은 저장하지 않음');
  assert.deepEqual(optionsFor([{ id: 'x', manifest: m }], { x: { a: 5, old: 1 } }, { x: { b: 'y' } }), { x: { a: 5, b: 'y' } });
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

test('versionLine: 색 코드와 안내 줄을 빼고 버전이 있는 줄을 고른다', () => {
  assert.equal(versionLine('[\x1b[34mINF\x1b[0m] Nuclei Cache Directory: C:\\x\\nuclei\n[\x1b[34mINF\x1b[0m] Nuclei Engine Version: v3.11.1'), 'Nuclei Engine Version: v3.11.1');
  assert.equal(versionLine('8.30.1\n'), '8.30.1');
  assert.equal(versionLine('ok'), 'ok');
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
