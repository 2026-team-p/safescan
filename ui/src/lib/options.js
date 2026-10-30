// 모듈 옵션: 기본값 합치기 · 화면 검사 · 조건부 표시. 서버(src/core/schema.js coerceOption)와 같은 규칙입니다.

/** 기본값 위에 저장된 값을 덮은, 지금 쓰일 옵션 */
export function effectiveOptions(module, saved = {}) {
  const out = {};
  for (const [key, spec] of Object.entries(module.options ?? {})) {
    if (spec.default !== undefined) out[key] = spec.default;
  }
  return { ...out, ...saved };
}

/** 다른 옵션 값에 따라 보이는지 (spec.when) */
export function isVisible(spec, values) {
  return !spec.when || Object.entries(spec.when).every(([k, v]) => values[k] === v);
}

const isEmpty = (v) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && !v.length);

/**
 * 값 하나를 검사합니다. 문제가 없으면 null, 있으면 { key, params } (locales 의 options.error.*)
 * @returns {{ key: string, params?: object } | null}
 */
export function optionError(spec, value) {
  if (isEmpty(value)) return null;
  if (spec.type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) return { key: 'number' };
    if (spec.min !== undefined && value < spec.min) return { key: 'min', params: { min: spec.min } };
    if (spec.max !== undefined && value > spec.max) return { key: 'max', params: { max: spec.max } };
  }
  if (spec.type === 'string' && spec.format === 'url') {
    try {
      if (!['http:', 'https:'].includes(new URL(value.trim()).protocol)) return { key: 'url' };
    } catch {
      return { key: 'url' };
    }
  }
  return null;
}

/** 보이는 필수 옵션 중 비어 있는 것 (비어 있으면 모듈이 건너뜀) */
export function missingRequired(module, values) {
  return Object.entries(module.options ?? {})
    .filter(([key, spec]) => spec.required && isVisible(spec, values) && isEmpty(values[key]))
    .map(([key]) => key);
}

/** 기본값과 다른 옵션 수 */
export function changedKeys(module, saved = {}) {
  const specs = module.options ?? {};
  return Object.keys(saved).filter((key) => specs[key] && JSON.stringify(saved[key]) !== JSON.stringify(specs[key].default));
}

/** 저장할 값: 기본값과 같은 것과 잘못된 값은 뺍니다 */
export function compact(module, values) {
  const specs = module.options ?? {};
  return Object.fromEntries(Object.entries(values).filter(([key, value]) => specs[key]
    && JSON.stringify(value) !== JSON.stringify(specs[key].default)
    && !optionError(specs[key], value)));
}

/** 옵션 값을 짧게 표시 (기록 · 결과 화면용) */
export function formatOptionValue(value, loc, t) {
  if (typeof value === 'boolean') return value ? t('options.on') : t('options.off');
  if (Array.isArray(value)) return value.length ? value.map((v) => loc.choice(v)).join(', ') : '—';
  if (value === '' || value === undefined || value === null) return '—';
  return typeof value === 'string' ? loc.choice(value) : `${value}${loc.unit ? ` ${loc.unit}` : ''}`;
}
