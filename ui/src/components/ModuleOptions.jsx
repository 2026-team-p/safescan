import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { localizeModule } from '../i18n.js';
import { changedKeys, isVisible, optionError } from '../lib/options.js';
import { Toggle } from './ui.jsx';

const SEGMENTED_MAX = 4;

/**
 * 모듈 옵션 입력. 옵션 종류(켜기 · 하나 고르기 · 여러 개 고르기 · 숫자 · 글자)마다 맞는 입력 칸을 쓰고,
 * 자주 바꾸지 않는 옵션은 "고급" 아래에 둡니다.
 */
export function ModuleOptions({ module, values, saved, onChange, onReset }) {
  const { t, i18n } = useTranslation();
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const loc = localizeModule(module, i18n.language);
  const entries = Object.entries(module.options ?? {}).filter(([, spec]) => isVisible(spec, values));
  const changed = changedKeys(module, saved);
  if (!Object.keys(module.options ?? {}).length) return <p className="muted options-none">{t('options.none')}</p>;

  const field = ([key, spec]) => (
    <OptionField
      key={key}
      id={`opt-${module.id}-${key}`}
      spec={spec}
      loc={loc.option(key)}
      value={values[key]}
      changed={changed.includes(key)}
      onChange={(v) => onChange(key, v)}
    />
  );
  const basic = entries.filter(([, s]) => !s.advanced);
  const advanced = entries.filter(([, s]) => s.advanced);

  return (
    <div className="options">
      {basic.length > 0 && <div className="options-grid">{basic.map(field)}</div>}
      {advanced.length > 0 && (
        <>
          <button type="button" className="options-advanced" aria-expanded={advancedOpen} onClick={() => setAdvancedOpen(!advancedOpen)}>
            {t('options.advanced', { count: advanced.length })} <span aria-hidden>{advancedOpen ? '▴' : '▾'}</span>
          </button>
          {advancedOpen && <div className="options-grid">{advanced.map(field)}</div>}
        </>
      )}
      {changed.length > 0 && (
        <div className="options-foot">
          <span className="muted">{t('options.changed', { count: changed.length })}</span>
          <button type="button" className="link-btn" onClick={onReset}>{t('options.reset')}</button>
        </div>
      )}
    </div>
  );
}

function OptionField({ id, spec, loc, value, changed, onChange }) {
  const { t } = useTranslation();
  const error = optionError(spec, value);
  const wide = spec.type === 'string' || spec.type === 'multi';
  return (
    <div className={`option ${wide ? 'option-wide' : ''} ${error ? 'option-invalid' : ''}`}>
      <div className="option-head">
        <label htmlFor={id} className="option-label">{loc.label}</label>
        {spec.required && <span className="option-required">{t('options.required')}</span>}
        {changed && <span className="option-changed">{t('options.changedOne')}</span>}
      </div>
      <OptionControl id={id} spec={spec} loc={loc} value={value} onChange={onChange} />
      {error ? <p className="option-error" role="alert">{t(`options.error.${error.key}`, error.params)}</p>
        : loc.description && <p className="option-desc">{loc.description}</p>}
    </div>
  );
}

function OptionControl({ id, spec, loc, value, onChange }) {
  const { t } = useTranslation();
  switch (spec.type) {
    case 'boolean':
      return (
        <span className="option-switch">
          <Toggle checked={value === true} onChange={onChange} label={loc.label} />
          <span id={id} className="muted">{value ? t('options.on') : t('options.off')}</span>
        </span>
      );
    case 'enum':
      return spec.choices.length <= SEGMENTED_MAX ? (
        <div id={id} className="segmented segmented-soft option-seg" role="radiogroup" aria-label={loc.label}>
          {spec.choices.map((c) => (
            <button key={c} type="button" role="radio" aria-checked={value === c} className={value === c ? 'seg seg-active' : 'seg'} onClick={() => onChange(c)}>
              {loc.choice(c)}
            </button>
          ))}
        </div>
      ) : (
        <select id={id} className="option-select" value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
          {spec.choices.map((c) => <option key={c} value={c}>{loc.choice(c)}</option>)}
        </select>
      );
    case 'multi': {
      const list = Array.isArray(value) ? value : [];
      // 하나도 고르지 않으면 검사할 것이 없으므로 마지막 하나는 끌 수 없게 합니다.
      const flip = (c) => {
        const next = list.includes(c) ? list.filter((v) => v !== c) : [...list, c];
        if (next.length) onChange(spec.choices.filter((v) => next.includes(v)));
      };
      return (
        <div id={id} className="chips option-chips" role="group" aria-label={loc.label}>
          {spec.choices.map((c) => (
            <button key={c} type="button" className={`chip chip-small ${list.includes(c) ? 'chip-active' : ''}`} aria-pressed={list.includes(c)} onClick={() => flip(c)}>
              {list.includes(c) && <span aria-hidden>✓ </span>}{loc.choice(c)}
            </button>
          ))}
        </div>
      );
    }
    case 'number':
      return <NumberInput id={id} spec={spec} unit={loc.unit} value={value} onChange={onChange} />;
    default:
      return (
        <input
          id={id}
          className="option-input"
          type={spec.format === 'url' ? 'url' : 'text'}
          inputMode={spec.format === 'url' ? 'url' : undefined}
          value={value ?? ''}
          placeholder={loc.placeholder ?? ''}
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => onChange(e.target.value)}
        />
      );
  }
}

/** 숫자 칸은 입력하는 동안 빈 값도 허용하고, 숫자가 되면 바로 반영합니다. 비운 채로 나가면 기본값으로 돌아갑니다. */
function NumberInput({ id, spec, unit, value, onChange }) {
  const [text, setText] = useState(value == null ? '' : String(value));
  useEffect(() => {
    setText((current) => (Number(current) === value ? current : value == null ? '' : String(value)));
  }, [value]);
  return (
    <span className="option-number">
      <input
        id={id}
        className="option-input"
        type="number"
        inputMode="decimal"
        min={spec.min}
        max={spec.max}
        step={spec.step ?? 'any'}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          if (e.target.value.trim() !== '' && Number.isFinite(Number(e.target.value))) onChange(Number(e.target.value));
        }}
        onBlur={() => {
          if (text.trim() === '') onChange(undefined);
        }}
      />
      {unit && <span className="muted">{unit}</span>}
      {(spec.min !== undefined || spec.max !== undefined) && (
        <span className="muted option-range">{[spec.min, spec.max].map((v) => v ?? '').join('–')}</span>
      )}
    </span>
  );
}
