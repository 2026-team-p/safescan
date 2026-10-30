import { SEVERITY } from '../lib/format.js';

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

export function SeverityBadge({ severity }) {
  const s = SEVERITY[severity] ?? SEVERITY.low;
  return (
    <span className={`severity severity-${severity}`} title={s.hint}>
      <span aria-hidden>{s.icon}</span> {s.label}
    </span>
  );
}

export function Spinner({ size = 16 }) {
  return <span className="spinner" style={{ width: size, height: size }} aria-label="진행 중" />;
}

export function Chip({ active, onClick, children }) {
  return (
    <button type="button" className={`chip ${active ? 'chip-active' : ''}`} aria-pressed={active} onClick={onClick}>
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
