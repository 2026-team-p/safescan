import { useTranslation } from 'react-i18next';
import { SEVERITY_ICON } from '../lib/format.js';

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
