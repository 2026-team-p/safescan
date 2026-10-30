import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { localizeModule } from '../i18n.js';
import { clock, duration, maxSeverity, percent, SEVERITY_ICON, SEVERITY_ORDER, STAGES, usd, whereOf } from '../lib/format.js';
import { Criteria } from './Criteria.jsx';
import { SeverityBadge, Spinner } from './ui.jsx';

export function RunView({ run, modules, onShowIssues, onNewScan }) {
  const { t, i18n } = useTranslation();
  const [selectedId, setSelectedId] = useState(null);
  const done = run.closed;
  const issues = run.result?.issues;
  const byId = Object.fromEntries(modules.map((m) => [m.id, m]));
  const nameOf = (id) => (byId[id] ? localizeModule(byId[id], i18n.language).name : id);
  const newIssues = issues ? issues.created + issues.reopened : 0;

  return (
    <main className="page">
      <section className="run-head">
        <div>
          <p className="eyebrow">{done ? t('run.eyebrowDone') : t('run.eyebrowRunning')}</p>
          <h1>{done ? t('run.titleDone') : run.order.length ? t('run.titleRunning', { count: run.order.length }) : t('run.titlePreparing')}</h1>
          {run.error && <p className="error-text">{run.error}</p>}
        </div>
        {done && (
          <div className="run-summary">
            {issues && (
              <dl className="summary-stats">
                <div className={newIssues ? 'stat-alert' : ''}><dt>{t('run.newIssues')}</dt><dd>{newIssues}</dd></div>
                <div className={issues.resolved ? 'stat-good' : ''}><dt>{t('run.resolved')}</dt><dd>{issues.resolved}</dd></div>
                <div><dt>{t('run.open')}</dt><dd>{issues.open}</dd></div>
              </dl>
            )}
            <div className="row-gap">
              <button type="button" className="btn btn-ghost" onClick={onNewScan}>{t('run.newScan')}</button>
              <button type="button" className="btn btn-primary" onClick={onShowIssues}>{t('run.showIssues')}</button>
            </div>
          </div>
        )}
      </section>

      <section className="run-grid">
        {run.order.map((id) => (
          <ModuleRunCard
            key={id}
            name={nameOf(id)}
            mod={run.modules[id]}
            selected={selectedId === id}
            onSelect={() => setSelectedId(selectedId === id ? null : id)}
          />
        ))}
      </section>

      {selectedId && run.modules[selectedId] && (
        <ModuleDetail
          name={nameOf(selectedId)}
          live={run.modules[selectedId]}
          result={run.result?.modules.find((m) => m.moduleId === selectedId)}
          module={byId[selectedId]}
          logs={run.logs.filter((l) => l.moduleId === selectedId)}
          onClose={() => setSelectedId(null)}
        />
      )}

      <Console logs={run.logs} live={!done} />
    </main>
  );
}

function ModuleRunCard({ name, mod, selected, onSelect }) {
  const { t } = useTranslation();
  if (!mod) return null;
  const sev = maxSeverity(mod.bySeverity);
  return (
    <button
      type="button"
      className={`run-card run-card-${mod.status} ${sev ? `run-card-found run-card-sev-${sev}` : ''} ${selected ? 'run-card-selected' : ''}`}
      onClick={onSelect}
      aria-expanded={selected}
    >
      <span className="run-card-head">
        <strong>{name}</strong>
        <span className={`pill pill-${mod.status}`}>
          {mod.status === 'running' && <Spinner size={10} />} {t(`status.${mod.status}`)}
        </span>
      </span>
      <Stepper stages={mod.stages} stageMs={mod.stageMs} />
      <span className="run-card-foot">
        {mod.reason ? <span className="muted">{mod.reason}</span> : (
          <>
            {mod.findings > 0 ? (
              <span className={`found-pill found-${sev}`}>{SEVERITY_ICON[sev]} {t('run.findings', { count: mod.findings })}</span>
            ) : mod.status === 'ok' ? <span className="clean-pill">✓ {t('run.clean')}</span> : null}
            {mod.findings > 0 && (
              <span className="sev-dots" aria-hidden>
                {SEVERITY_ORDER.filter((s) => mod.bySeverity[s]).map((s) => <span key={s} className={`sev-dot sev-dot-${s}`}>{mod.bySeverity[s]}</span>)}
              </span>
            )}
            {mod.metrics && <span className="muted">{duration(mod.metrics.durationMs)}</span>}
            {mod.metrics?.confidence != null && <span className="muted">{t('run.confidence', { value: Math.round(mod.metrics.confidence * 100) })}</span>}
          </>
        )}
        <span className="card-more">{t('run.details')} {selected ? '▴' : '▾'}</span>
      </span>
    </button>
  );
}

/** 검사 카드를 누르면 보이는 상세: 단계 · 자체 점검 · 지표 · 실행 명령 · 발견 결과 · 검증 기준 · 로그 */
function ModuleDetail({ name, live, result, module, logs, onClose }) {
  const { t } = useTranslation();
  const stages = result?.stages ?? STAGES.filter((s) => live.stages[s]).map((s) => ({ stage: s, status: live.stages[s], durationMs: live.stageMs[s], error: live.stageErrors[s] }));
  const m = result?.metrics;

  return (
    <section className="detail" aria-label={name}>
      <header className="detail-head">
        <h2>{name}</h2>
        <span className={`pill pill-${live.status}`}>{t(`status.${live.status}`)}</span>
        <button type="button" className="icon-btn" onClick={onClose} aria-label={t('detail.close')}>✕</button>
      </header>

      {live.reason && <p className="detail-reason"><strong>{t('detail.reason')}</strong> {live.reason}</p>}

      <div className="detail-grid">
        <div className="detail-block">
          <h3>{t('detail.stages')}</h3>
          <ol className="stage-list">
            {stages.map((s) => (
              <li key={s.stage} className={`stage-item stage-${s.status}`}>
                <span className="stage-name">{t(`stage.${s.stage}`)}</span>
                <span className="muted">{t(`status.${s.status}`)}</span>
                <span className="muted num">{s.durationMs != null ? duration(s.durationMs) : '…'}</span>
                {s.error && <span className="stage-error">{s.error}</span>}
              </li>
            ))}
          </ol>
        </div>

        <div className="detail-block">
          <h3>{t('detail.metrics')}</h3>
          {m ? (
            <dl className="metric-grid">
              <div><dt>{t('detail.duration')}</dt><dd>{duration(m.durationMs)}</dd></div>
              <div><dt>{t('detail.confidence')}</dt><dd>{percent(m.confidence)}</dd></div>
              <div><dt>{t('detail.aiCalls')}</dt><dd>{m.aiCalls}</dd></div>
              <div><dt>{t('detail.tokens')}</dt><dd>{m.aiInputTokens + m.aiOutputTokens}</dd></div>
              <div><dt>{t('detail.cost')}</dt><dd>{usd(m.aiCostUsd)}</dd></div>
              <div><dt>{t('detail.tool')}</dt><dd className="small">{Object.entries(result.toolVersions).map(([k, v]) => `${k} ${v}`).join(', ') || '—'}</dd></div>
            </dl>
          ) : <p className="muted">{t('detail.waitingResult')}</p>}
        </div>

        <div className="detail-block">
          <h3>{t('detail.checks')}</h3>
          {result?.verify?.checks?.length ? (
            <ul className="check-list">
              {result.verify.checks.map((c, i) => (
                <li key={i} className={c.passed ? 'check-pass' : 'check-fail'}>
                  <span aria-hidden>{c.passed ? '✓' : '✕'}</span>
                  <span>{c.name}{c.detail && <span className="muted"> — {c.detail}</span>}</span>
                </li>
              ))}
            </ul>
          ) : <p className="muted">{result ? t('detail.noChecks') : t('detail.waitingResult')}</p>}
          {result?.verify?.notes?.length > 0 && (
            <ul className="note-list">{result.verify.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
          )}
        </div>

        <div className="detail-block">
          <h3>{t('detail.commands')}</h3>
          {result?.execCalls?.length ? (
            <ul className="cmd-list">
              {result.execCalls.map((c, i) => (
                <li key={i}><code>{c.command}</code><span className="muted num">{c.code ?? '—'} · {duration(c.durationMs)}</span></li>
              ))}
            </ul>
          ) : <p className="muted">—</p>}
        </div>
      </div>

      <div className="detail-block">
        <h3>{t('detail.findings')}</h3>
        {result?.findings?.length ? (
          <ul className="finding-list">
            {result.findings.map((f) => (
              <li key={f.fingerprint}>
                <SeverityBadge severity={f.severity} />
                <span className="finding-title">{f.title}</span>
                <span className="finding-where">{whereOf(f)}</span>
              </li>
            ))}
          </ul>
        ) : <p className="muted">{result ? t('detail.noFindings') : t('detail.waitingResult')}</p>}
      </div>

      {module && (
        <div className="detail-block">
          <h3>{t('module.criteria')}</h3>
          <Criteria module={module} />
        </div>
      )}

      <div className="detail-block">
        <h3>{t('detail.logs')}</h3>
        <LogLines logs={logs.slice(-80)} />
      </div>
    </section>
  );
}

/** 전처리 → 툴 → 후처리 → 검증 */
export function Stepper({ stages, stageMs = {} }) {
  const { t } = useTranslation();
  return (
    <ol className="stepper">
      {STAGES.map((key) => {
        const status = stages[key] ?? 'pending';
        return (
          <li key={key} className={`step step-${status}`}>
            <span className="step-dot" aria-hidden>{status === 'ok' ? '✓' : status === 'failed' ? '✕' : status === 'skipped' ? '–' : ''}</span>
            <span className="step-label">{t(`stage.${key}`)}</span>
            <span className="step-time">{stageMs[key] != null ? duration(stageMs[key]) : status === 'running' ? '…' : ''}</span>
          </li>
        );
      })}
    </ol>
  );
}

function LogLines({ logs, showModule = false }) {
  const { t } = useTranslation();
  return logs.map((l, i) => (
    <div key={i} className={`log log-${l.level} ${showModule ? '' : 'log-compact'}`}>
      <span className="log-time">{clock(l.at)}</span>
      {showModule && <span className="log-module">{l.moduleId}</span>}
      <span className="log-stage">{l.stage ? t(`stage.${l.stage}`) : ''}</span>
      <span className="log-msg">
        {l.ai ? `${t('console.ai', { model: l.ai.model, tokens: l.ai.tokens, cost: usd(l.ai.cost) })}${l.ai.purpose ? ` · ${l.ai.purpose}` : ''}` : l.message}
      </span>
    </div>
  ));
}

/** 투명성 콘솔: 실제 도구가 내는 로그를 그대로 흘려 보여 줍니다. */
function Console({ logs, live }) {
  const { t } = useTranslation();
  const box = useRef(null);
  const [follow, setFollow] = useState(true);

  useEffect(() => {
    if (follow && box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [logs, follow]);

  return (
    <section className="console">
      <div className="console-head">
        <span className={`live-dot ${live ? 'live-dot-on' : ''}`} aria-hidden />
        <strong>{t('console.title')}</strong>
        <span className="muted">{t('console.lines', { count: logs.length })}</span>
        <label className="console-follow">
          <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} /> {t('console.follow')}
        </label>
      </div>
      <div className="console-body" ref={box}>
        {logs.length === 0 && <p className="muted">{t('console.waiting')}</p>}
        <LogLines logs={logs} showModule />
      </div>
    </section>
  );
}
