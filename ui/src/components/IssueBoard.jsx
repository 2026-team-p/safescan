import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { COLUMNS, dateTime, SEVERITY_ORDER, whereOf } from '../lib/format.js';
import { SeverityBadge, Spinner } from './ui.jsx';

/** 의존성 이슈는 한 건이어도 "패키지@버전 · 권고 N건" 으로 (화면 언어로) */
export function issueTitle(issue, t) {
  const f = issue.findings[0];
  if (f?.dependency) return t('issue.depTitle', { name: f.dependency.name, version: f.dependency.version ?? '?', count: issue.findings.length });
  return issue.title;
}

export function IssueBoard({ issues, moduleNames, openId, onOpen, onMove, onGoScan, onRescan, rescanModules, busy }) {
  const { t } = useTranslation();
  const [dragOver, setDragOver] = useState(null);
  const open = issues.filter((i) => i.status !== 'resolved').length;

  if (!issues.length) {
    return (
      <main className="page">
        <div className="empty">
          <p className="empty-icon" aria-hidden>🛡️</p>
          <h2>{t('board.emptyTitle')}</h2>
          <p className="muted">{t('board.emptyBody')}</p>
          <button type="button" className="btn btn-primary" onClick={onGoScan}>{t('board.goScan')}</button>
        </div>
      </main>
    );
  }

  return (
    <main className="page page-wide">
      <div className="board-bar">
        <span className={`board-summary ${open ? 'board-summary-alert' : ''}`}>{t('board.summary', { count: open })}</span>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={onRescan}
          disabled={busy || !rescanModules.length}
          title={t('board.rescanTitle', { modules: rescanModules.join(', ') })}
        >
          {busy ? <Spinner size={12} /> : <span aria-hidden>↻</span>} {t('board.rescan')}
        </button>
      </div>

      <div className="board">
        {COLUMNS.map((col) => {
          const cards = issues
            .filter((i) => i.status === col.key)
            .sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) || b.updatedAt.localeCompare(a.updatedAt));
          return (
            <section
              key={col.key}
              className={`column column-${col.key} ${dragOver === col.key ? 'column-over' : ''}`}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(col.key);
              }}
              onDragLeave={() => setDragOver(null)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(null);
                const id = e.dataTransfer.getData('text/plain');
                if (id) onMove(id, col.key);
              }}
            >
              <header className="column-head">
                <span aria-hidden>{col.icon}</span>
                <h2>{t(`column.${col.key}`)}</h2>
                <span className="column-count">{cards.length}</span>
              </header>
              <div className="column-cards">
                {cards.map((issue) => {
                  const f = issue.findings[0];
                  return (
                    <button
                      type="button"
                      key={issue.id}
                      draggable
                      onDragStart={(e) => e.dataTransfer.setData('text/plain', issue.id)}
                      className={`card card-sev-${issue.severity} ${openId === issue.id ? 'card-open' : ''}`}
                      onClick={() => onOpen(issue.id)}
                    >
                      <SeverityBadge severity={issue.severity} />
                      <span className="card-title">{issueTitle(issue, t)}</span>
                      <span className="card-where">{whereOf(f)}</span>
                      {f?.location?.snippet && !f.dependency && <code className="card-snippet">{f.location.snippet}</code>}
                      <span className="card-meta">
                        {moduleNames[issue.moduleId] ?? issue.moduleId}
                        {issue.findings.length > 1 && ` · ${t('board.items', { count: issue.findings.length })}`}
                        {' · '}
                        {issue.status === 'resolved' ? t('board.resolvedAt', { date: dateTime(issue.updatedAt) }) : t('board.found', { date: dateTime(issue.createdAt) })}
                      </span>
                    </button>
                  );
                })}
                {!cards.length && <p className="column-empty">{t('board.dropHint')}</p>}
              </div>
            </section>
          );
        })}
      </div>
    </main>
  );
}
