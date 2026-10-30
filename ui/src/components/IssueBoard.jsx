import { useState } from 'react';
import { COLUMNS, dateTime, SEVERITY_ORDER, whereOf } from '../lib/format.js';
import { SeverityBadge } from './ui.jsx';

export function IssueBoard({ issues, moduleNames, openId, onOpen, onMove, onGoScan }) {
  const [dragOver, setDragOver] = useState(null);

  if (!issues.length) {
    return (
      <main className="page">
        <div className="empty">
          <p className="empty-icon" aria-hidden>🛡️</p>
          <h2>아직 이슈가 없습니다</h2>
          <p className="muted">검사를 실행하면 발견된 문제가 여기에 카드로 쌓입니다.</p>
          <button type="button" className="btn btn-primary" onClick={onGoScan}>검사하러 가기</button>
        </div>
      </main>
    );
  }

  return (
    <main className="page page-wide">
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
                <h2>{col.label}</h2>
                <span className="column-count">{cards.length}</span>
              </header>
              <div className="column-cards">
                {cards.map((issue) => (
                  <button
                    type="button"
                    key={issue.id}
                    draggable
                    onDragStart={(e) => e.dataTransfer.setData('text/plain', issue.id)}
                    className={`card ${openId === issue.id ? 'card-open' : ''}`}
                    onClick={() => onOpen(issue.id)}
                  >
                    <SeverityBadge severity={issue.severity} />
                    <span className="card-title">{issue.title}</span>
                    <span className="card-where">{whereOf(issue.findings[0])}</span>
                    <span className="card-meta">
                      {moduleNames[issue.moduleId] ?? issue.moduleId}
                      {issue.findings.length > 1 && ` · ${issue.findings.length}건`}
                      {' · '}
                      {dateTime(issue.updatedAt)}
                    </span>
                  </button>
                ))}
                {!cards.length && <p className="column-empty">카드를 끌어다 놓을 수 있습니다</p>}
              </div>
            </section>
          );
        })}
      </div>
    </main>
  );
}
