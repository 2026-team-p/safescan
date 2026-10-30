// module.json 과 Finding 의 형태 검사. 계약은 src/sdk/types.d.ts 참고.
import { createHash } from 'node:crypto';
import { AI_USAGES, CATEGORIES, SEVERITIES } from '../sdk/index.js';

const ID_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const SEMVER_RE = /^\d+\.\d+\.\d+(-[\w.]+)?$/;
const OWASP_RE = /^A(0[1-9]|10):20\d\d$/;
const CWE_RE = /^CWE-\d+$/;
const OPTION_TYPES = ['string', 'number', 'boolean', 'enum'];
const MANIFEST_KEYS = new Set([
  'id', 'name', 'version', 'description', 'category', 'owasp', 'cwe', 'status',
  'tool', 'requires', 'appliesWhen', 'ai', 'options', 'timeoutSec',
]);

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
    else for (const [key, spec] of Object.entries(m.options)) {
      if (!spec || !OPTION_TYPES.includes(spec.type)) errors.push(`options.${key}.type 은 ${OPTION_TYPES.join(' | ')} 중 하나여야 합니다`);
      if (!spec || !isStr(spec.label)) errors.push(`options.${key}.label 이 필요합니다`);
      if (spec?.type === 'enum' && !isStrArray(spec.choices)) errors.push(`options.${key}.choices 가 필요합니다`);
    }
  }
  if (m.timeoutSec !== undefined && !(Number.isFinite(m.timeoutSec) && m.timeoutSec > 0)) {
    errors.push('timeoutSec 는 양수여야 합니다');
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
  if (errors.length) return { errors };

  return {
    errors,
    finding: {
      ...f,
      moduleId,
      owasp: f.owasp ?? [],
      cwe: f.cwe ?? [],
      fingerprint: f.fingerprint ?? fingerprintOf(moduleId, f),
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
  for (const [key, value] of Object.entries(given)) {
    const spec = specs[key];
    if (!spec) throw new Error(`${manifest.id}: 정의되지 않은 옵션 '${key}'`);
    const ok = spec.type === 'enum' ? spec.choices.includes(value)
      : spec.type === 'number' ? Number.isFinite(value)
        : typeof value === spec.type;
    if (!ok) throw new Error(`${manifest.id}: 옵션 '${key}' 의 값이 올바르지 않습니다`);
    out[key] = value;
  }
  return out;
}
