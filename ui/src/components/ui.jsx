import { useTranslation } from 'react-i18next';
import { SEVERITY_ICON, SEVERITY_ORDER } from '../lib/format.js';

/** 0~1 값 하나를 막대로. 바탕은 같은 색의 옅은 단계입니다. */
export function Meter({ value, label }) {
  if (value == null) return <span className="meter meter-empty" aria-hidden />;
  return (
    <span className="meter" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value * 100)} aria-label={label}>
      <span style={{ width: value > 0 ? `${Math.max(2, Math.min(100, value * 100))}%` : 0 }} />
    </span>
  );
}

/** 위험도별 개수. 색 점은 보조이고 이름 · 숫자를 함께 씁니다. */
export function SeverityChips({ counts }) {
  const { t } = useTranslation();
  const list = SEVERITY_ORDER.filter((s) => (counts?.[s] ?? 0) > 0);
  if (!list.length) return <span className="muted">—</span>;
  return (
    <span className="sev-chips">
      {list.map((s) => (
        <span key={s} className="sev-chip" title={t(`severity.${s}Hint`)}>
          <span className={`sev-swatch sev-swatch-${s}`} aria-hidden />{t(`severity.${s}`)} <strong>{counts[s]}</strong>
        </span>
      ))}
    </span>
  );
}

export function Toggle({ checked, onChange, disabled, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className="toggle"
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onChange(!checked);
      }}
    >
      <span className="toggle-thumb" />
    </button>
  );
}

export function SeverityBadge({ severity, count }) {
  const { t } = useTranslation();
  return (
    <span className={`severity severity-${severity}`} title={t(`severity.${severity}Hint`)}>
      <span aria-hidden>{SEVERITY_ICON[severity]}</span> {t(`severity.${severity}`)}{count != null ? ` ${count}` : ''}
    </span>
  );
}

export function Spinner({ size = 16 }) {
  return <span className="spinner" style={{ width: size, height: size }} aria-label="…" />;
}

export function Chip({ active, onClick, disabled, children }) {
  return (
    <button type="button" className={`chip ${active ? 'chip-active' : ''}`} aria-pressed={active} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

export function Toasts({ items, onDismiss }) {
  return (
    <div className="toasts" role="status">
      {items.map((t) => (
        <button type="button" key={t.id} className={`toast toast-${t.kind}`} onClick={() => onDismiss(t.id)}>
          {t.message}
        </button>
      ))}
    </div>
  );
}
