// module.json 과 Finding 의 형태 검사. 계약은 src/sdk/types.d.ts 참고.
import { createHash } from 'node:crypto';
import { AI_USAGES, CATEGORIES, SEVERITIES } from '../sdk/index.js';

const ID_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const SEMVER_RE = /^\d+\.\d+\.\d+(-[\w.]+)?$/;
const OWASP_RE = /^A(0[1-9]|10):20\d\d$/;
const CWE_RE = /^CWE-\d+$/;
const OPTION_TYPES = ['string', 'number', 'boolean', 'enum', 'multi'];
const MANIFEST_KEYS = new Set([
  'id', 'name', 'version', 'description', 'category', 'owasp', 'cwe', 'status',
  'tool', 'requires', 'appliesWhen', 'ai', 'options', 'timeoutSec', 'criteria', 'i18n',
]);
const LANG_RE = /^[a-z]{2}(-[A-Z]{2})?$/;
const isRatio = (v) => typeof v === 'number' && v >= 0 && v <= 1;

const isStr = (v) => typeof v === 'string' && v.trim() !== '';
const isStrArray = (v) => Array.isArray(v) && v.every(isStr);

/**
 * @param {any} m module.json 내용
 * @param {string} [folderName] 모듈 폴더 이름 (id 와 같아야 함)
 * @returns {string[]} 에러 목록. 비어 있으면 통과
 */
export function validateManifest(m, folderName) {
  const errors = [];
  if (!m || typeof m !== 'object' || Array.isArray(m)) return ['module.json 은 객체여야 합니다'];

  for (const key of Object.keys(m)) {
    if (!MANIFEST_KEYS.has(key)) errors.push(`알 수 없는 필드: ${key}`);
  }
  if (!isStr(m.id) || !ID_RE.test(m.id)) errors.push('id 는 kebab-case 문자열이어야 합니다 (예: npm-audit)');
  if (folderName && m.id !== folderName) errors.push(`id(${m.id})가 폴더 이름(${folderName})과 다릅니다`);
  if (!isStr(m.name)) errors.push('name 이 필요합니다');
  if (!isStr(m.version) || !SEMVER_RE.test(m.version)) errors.push('version 은 semver 여야 합니다 (예: 0.1.0)');
  if (!isStr(m.description)) errors.push('description 이 필요합니다');
  if (!CATEGORIES.includes(m.category)) errors.push(`category 는 ${CATEGORIES.join(' | ')} 중 하나여야 합니다`);
  if (m.owasp !== undefined && !(isStrArray(m.owasp) && m.owasp.every((o) => OWASP_RE.test(o)))) {
    errors.push('owasp 는 "A03:2025" 형식의 배열이어야 합니다');
  }
  if (m.cwe !== undefined && !(isStrArray(m.cwe) && m.cwe.every((c) => CWE_RE.test(c)))) {
    errors.push('cwe 는 "CWE-79" 형식의 배열이어야 합니다');
  }
  if (m.status !== undefined && !['experimental', 'stable'].includes(m.status)) {
    errors.push('status 는 experimental | stable 이어야 합니다');
  }
  if (!m.tool || !isStr(m.tool.name) || !isStr(m.tool.homepage)) {
    errors.push('tool.name 과 tool.homepage 가 필요합니다 (툴 단계의 핵심 도구)');
  }
  if (m.requires !== undefined) {
    if (!Array.isArray(m.requires)) errors.push('requires 는 배열이어야 합니다');
    else m.requires.forEach((r, i) => {
      if (!r || !isStr(r.bin)) errors.push(`requires[${i}].bin 이 필요합니다`);
      if (!r || !isStr(r.install)) errors.push(`requires[${i}].install 설치 안내가 필요합니다`);
      if (r?.versionArgs !== undefined && !Array.isArray(r.versionArgs)) errors.push(`requires[${i}].versionArgs 는 배열이어야 합니다`);
    });
  }
  if (m.appliesWhen !== undefined && !(m.appliesWhen && (m.appliesWhen.files === undefined || isStrArray(m.appliesWhen.files)))) {
    errors.push('appliesWhen.files 는 문자열 배열이어야 합니다');
  }
  if (m.ai !== undefined && !AI_USAGES.includes(m.ai)) errors.push(`ai 는 ${AI_USAGES.join(' | ')} 중 하나여야 합니다`);
  if (m.options !== undefined) {
    if (!m.options || typeof m.options !== 'object') errors.push('options 는 객체여야 합니다');
    else for (const [key, spec] of Object.entries(m.options)) errors.push(...validateOptionSpec(key, spec, m.options));
  }
  if (m.timeoutSec !== undefined && !(Number.isFinite(m.timeoutSec) && m.timeoutSec > 0)) {
    errors.push('timeoutSec 는 양수여야 합니다');
  }
  if (m.criteria !== undefined) errors.push(...validateCriteria(m.criteria));
  if (m.i18n !== undefined) errors.push(...validateI18n(m.i18n));
  return errors;
}

function validateOptionSpec(key, spec, all) {
  const at = `options.${key}`;
  if (!spec || typeof spec !== 'object') return [`${at} 는 객체여야 합니다`];
  const errors = [];
  if (!OPTION_TYPES.includes(spec.type)) errors.push(`${at}.type 은 ${OPTION_TYPES.join(' | ')} 중 하나여야 합니다`);
  if (!isStr(spec.label)) errors.push(`${at}.label 이 필요합니다`);
  const hasChoices = spec.type === 'enum' || spec.type === 'multi';
  if (hasChoices && !isStrArray(spec.choices)) errors.push(`${at}.choices 가 필요합니다`);
  if (spec.choiceLabels !== undefined && !(spec.choiceLabels && typeof spec.choiceLabels === 'object' && Object.values(spec.choiceLabels).every(isStr))) {
    errors.push(`${at}.choiceLabels 는 { 선택지: 이름 } 객체여야 합니다`);
  }
  for (const k of ['min', 'max', 'step']) {
    if (spec[k] !== undefined && !(spec.type === 'number' && Number.isFinite(spec[k]))) errors.push(`${at}.${k} 는 number 옵션의 숫자여야 합니다`);
  }
  if (spec.format !== undefined && !(spec.type === 'string' && spec.format === 'url')) errors.push(`${at}.format 은 string 옵션의 'url' 만 됩니다`);
  if (spec.when !== undefined) {
    if (!spec.when || typeof spec.when !== 'object') errors.push(`${at}.when 은 { 옵션: 값 } 객체여야 합니다`);
    else for (const other of Object.keys(spec.when)) if (!all[other] || other === key) errors.push(`${at}.when.${other}: 같은 모듈의 다른 옵션이어야 합니다`);
  }
  if (spec.default !== undefined && !errors.length) {
    const { error } = coerceOption(spec, spec.default);
    if (error) errors.push(`${at}.default: ${error}`);
  }
  return errors;
}

/**
 * 옵션 값 하나를 검사하고 맞는 형태로 바꿉니다. CLI(-o 모듈.키=값)에서 온 문자열도 받습니다.
 * @param {import('../sdk/types.js').OptionSpec} spec
 * @returns {{ value?: import('../sdk/types.js').OptionValue, error?: string }}
 */
export function coerceOption(spec, raw) {
  switch (spec.type) {
    case 'boolean': {
      const value = raw === 'true' ? true : raw === 'false' ? false : raw;
      return typeof value === 'boolean' ? { value } : { error: 'true 또는 false 여야 합니다' };
    }
    case 'number': {
      const value = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw;
      if (typeof value !== 'number' || !Number.isFinite(value)) return { error: '숫자여야 합니다' };
      if (spec.min !== undefined && value < spec.min) return { error: `${spec.min} 이상이어야 합니다` };
      if (spec.max !== undefined && value > spec.max) return { error: `${spec.max} 이하여야 합니다` };
      return { value };
    }
    case 'enum':
      return spec.choices.includes(raw) ? { value: raw } : { error: `${spec.choices.join(', ')} 중 하나여야 합니다` };
    case 'multi': {
      const list = typeof raw === 'string' ? raw.split(',').map((s) => s.trim()).filter(Boolean) : raw;
      if (!Array.isArray(list)) return { error: '선택지 배열이어야 합니다' };
      const wrong = list.filter((v) => !spec.choices.includes(v));
      if (wrong.length) return { error: `알 수 없는 선택지: ${wrong.join(', ')}` };
      return { value: spec.choices.filter((c) => list.includes(c)) };
    }
    default: {
      if (typeof raw !== 'string') return { error: '문자열이어야 합니다' };
      const value = raw.trim();
      if (spec.format === 'url' && value && !isHttpUrl(value)) return { error: 'http:// 또는 https:// 로 시작하는 주소여야 합니다' };
      return { value };
    }
  }
}

function isHttpUrl(value) {
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

/** 모듈별 수치 검증 기준: 신뢰도 구간의 뜻과 벤치 정확도 목표 */
function validateCriteria(c) {
  if (!c || typeof c !== 'object' || Array.isArray(c)) return ['criteria 는 객체여야 합니다'];
  const errors = [];
  if (c.confidence !== undefined) {
    if (!Array.isArray(c.confidence)) errors.push('criteria.confidence 는 배열이어야 합니다');
    else c.confidence.forEach((r, i) => {
      if (!isRatio(r?.min)) errors.push(`criteria.confidence[${i}].min 은 0~1 숫자여야 합니다`);
      if (!isStr(r?.label)) errors.push(`criteria.confidence[${i}].label 이 필요합니다`);
    });
  }
  if (c.accuracy !== undefined) {
    if (!c.accuracy || typeof c.accuracy !== 'object') errors.push('criteria.accuracy 는 객체여야 합니다');
    else for (const k of ['precision', 'recall']) {
      if (c.accuracy[k] !== undefined && !isRatio(c.accuracy[k])) errors.push(`criteria.accuracy.${k} 는 0~1 숫자여야 합니다`);
    }
  }
  return errors;
}

/** 화면 언어별 이름 · 설명 · 신뢰도 구간 이름 */
function validateI18n(t) {
  if (!t || typeof t !== 'object' || Array.isArray(t)) return ['i18n 은 { 언어코드: {...} } 객체여야 합니다'];
  const errors = [];
  for (const [lang, v] of Object.entries(t)) {
    if (!LANG_RE.test(lang)) errors.push(`i18n.${lang}: 언어 코드는 en, ja, zh 처럼 써야 합니다`);
    if (!v || typeof v !== 'object') {
      errors.push(`i18n.${lang} 는 객체여야 합니다`);
      continue;
    }
    for (const k of ['name', 'description']) if (v[k] !== undefined && !isStr(v[k])) errors.push(`i18n.${lang}.${k} 는 문자열이어야 합니다`);
    if (v.criteria !== undefined && !isStrArray(v.criteria)) errors.push(`i18n.${lang}.criteria 는 criteria.confidence 와 같은 순서의 문자열 배열이어야 합니다`);
    if (v.options !== undefined) {
      if (!v.options || typeof v.options !== 'object') errors.push(`i18n.${lang}.options 는 { 옵션: {...} } 객체여야 합니다`);
      else for (const [key, o] of Object.entries(v.options)) {
        for (const k of ['label', 'description', 'placeholder', 'unit']) if (o?.[k] !== undefined && !isStr(o[k])) errors.push(`i18n.${lang}.options.${key}.${k} 는 문자열이어야 합니다`);
        if (o?.choiceLabels !== undefined && !(o.choiceLabels && typeof o.choiceLabels === 'object')) errors.push(`i18n.${lang}.options.${key}.choiceLabels 는 객체여야 합니다`);
      }
    }
  }
  return errors;
}

/**
 * 모듈이 돌려준 Finding 을 검사하고 기본값을 채웁니다.
 * @param {any} f
 * @param {string} moduleId
 * @returns {{ finding?: import('../sdk/types.js').NormalizedFinding, errors: string[] }}
 */
export function normalizeFinding(f, moduleId) {
  const errors = [];
  if (!f || typeof f !== 'object') return { errors: ['Finding 은 객체여야 합니다'] };
  if (!isStr(f.ruleId)) errors.push('ruleId 가 필요합니다');
  if (!isStr(f.title)) errors.push('title 이 필요합니다');
  if (!SEVERITIES.includes(f.severity)) errors.push(`severity 는 ${SEVERITIES.join(' | ')} 중 하나여야 합니다 (받은 값: ${f.severity})`);
  if (!(typeof f.confidence === 'number' && f.confidence >= 0 && f.confidence <= 1)) errors.push('confidence 는 0~1 숫자여야 합니다');
  if (f.location !== undefined) {
    if (!isStr(f.location?.file)) errors.push('location.file 이 필요합니다');
    else if (f.location.file.includes('\\') || f.location.file.startsWith('/') || /^[a-zA-Z]:/.test(f.location.file)) {
      errors.push('location.file 은 프로젝트 루트 기준 상대 경로(/ 구분)여야 합니다');
    }
  }
  if (f.dependency !== undefined && !isStr(f.dependency?.name)) errors.push('dependency.name 이 필요합니다');
  if (f.fingerprint !== undefined && !isStr(f.fingerprint)) errors.push('fingerprint 는 문자열이어야 합니다');
  if (f.group !== undefined && !isStr(f.group)) errors.push('group 은 문자열이어야 합니다');
  if (errors.length) return { errors };

  const fingerprint = f.fingerprint ?? fingerprintOf(moduleId, f);
  return {
    errors,
    finding: {
      ...f,
      moduleId,
      owasp: f.owasp ?? [],
      cwe: f.cwe ?? [],
      fingerprint,
      // 의존성은 패키지를 올리면 권고 여러 건이 함께 해결되므로 한 이슈로 묶습니다.
      group: f.group ?? (f.dependency ? `dependency:${f.location?.file ?? ''}:${f.dependency.name}` : fingerprint),
    },
  };
}

/** 재검사 사이에서 같은 문제를 같은 키로 묶습니다. 줄 번호는 코드가 바뀌면 흔들리므로 마지막 수단입니다. */
export function fingerprintOf(moduleId, f) {
  const anchor = f.dependency?.name ?? f.location?.snippet?.trim() ?? String(f.location?.startLine ?? '');
  const key = [moduleId, f.ruleId, f.location?.file ?? '', anchor].join('\u0000');
  return createHash('sha1').update(key).digest('hex').slice(0, 16);
}

/** 사용자 옵션을 manifest.options 기본값과 합칩니다. 정의되지 않은 키 · 잘못된 타입은 에러 */
export function resolveOptions(manifest, given = {}) {
  const specs = manifest.options ?? {};
  const out = {};
  for (const [key, spec] of Object.entries(specs)) {
    if (spec.default !== undefined) out[key] = spec.default;
  }
  for (const [key, raw] of Object.entries(given)) {
    const spec = specs[key];
    if (!spec) throw new Error(`${manifest.id}: 정의되지 않은 옵션 '${key}'`);
    const { value, error } = coerceOption(spec, raw);
    if (error) throw new Error(`${manifest.id}: 옵션 '${key}' — ${error}`);
    out[key] = value;
  }
  return out;
}

/**
 * 저장된 설정처럼 오래됐을 수 있는 값에서 쓸 수 있는 것만 남깁니다 (모듈이 옵션을 바꾼 뒤에도 검사가 멈추지 않게).
 * @returns {{ options: Record<string, import('../sdk/types.js').OptionValue>, dropped: string[] }}
 */
export function sanitizeOptions(manifest, given = {}) {
  const specs = manifest.options ?? {};
  /** @type {Record<string, import('../sdk/types.js').OptionValue>} */
  const options = {};
  const dropped = [];
  for (const [key, raw] of Object.entries(given ?? {})) {
    const { value, error } = specs[key] ? coerceOption(specs[key], raw) : { value: undefined, error: 'unknown' };
    if (error) dropped.push(key);
    else options[key] = value;
  }
  return { options, dropped };
}
