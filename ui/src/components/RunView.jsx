import { useEffect, useRef, useState } from 'react';
import { clock, duration, STAGE_LABEL, STAGES } from '../lib/format.js';
import { Spinner } from './ui.jsx';

const STATUS_TEXT = { pending: '대기', running: '실행 중', ok: '완료', skipped: '건너뜀', failed: '실패', timeout: '시간 초과' };

export function RunView({ run, modules, onShowIssues, onNewScan }) {
  const done = run.closed;
  const issues = run.result?.issues;
  const names = Object.fromEntries(modules.map((m) => [m.id, m.name]));

  return (
    <main className="page">
      <section className="run-head">
        <div>
          <p className="eyebrow">{done ? '검사 완료' : '검사 진행 중'}</p>
          <h1>{done ? '검사를 마쳤습니다' : run.order.length ? `${run.order.length}개 모듈을 검사하고 있습니다` : '검사를 준비하고 있습니다'}</h1>
          {run.error && <p className="error-text">{run.error}</p>}
        </div>
        {done && (
          <div className="run-summary">
            {issues && (
              <dl className="summary-stats">
                <div><dt>새 이슈</dt><dd>{issues.created + issues.reopened}</dd></div>
                <div><dt>해결</dt><dd>{issues.resolved}</dd></div>
                <div><dt>열린 이슈</dt><dd>{issues.open}</dd></div>
              </dl>
            )}
            <div className="row-gap">
              <button type="button" className="btn btn-ghost" onClick={onNewScan}>새 검사</button>
              <button type="button" className="btn btn-primary" onClick={onShowIssues}>이슈 보기 →</button>
            </div>
          </div>
        )}
      </section>

      <section className="run-grid">
        {run.order.map((id) => (
          <ModuleRunCard key={id} name={names[id] ?? id} mod={run.modules[id]} />
        ))}
      </section>

      <Console logs={run.logs} live={!done} />
    </main>
  );
}

function ModuleRunCard({ name, mod }) {
  if (!mod) return null;
  return (
    <article className={`run-card run-card-${mod.status}`}>
      <header className="run-card-head">
        <strong>{name}</strong>
        <span className={`pill pill-${mod.status}`}>
          {mod.status === 'running' && <Spinner size={10} />} {STATUS_TEXT[mod.status] ?? mod.status}
        </span>
      </header>
      <Stepper stages={mod.stages} stageMs={mod.stageMs} />
      <footer className="run-card-foot">
        {mod.reason ? <span className="muted">{mod.reason}</span> : (
          <>
            <span>발견 <strong>{mod.findings}</strong>건</span>
            {mod.metrics && <span className="muted">{duration(mod.metrics.durationMs)}</span>}
            {mod.metrics?.confidence != null && <span className="muted">신뢰도 {Math.round(mod.metrics.confidence * 100)}%</span>}
          </>
        )}
      </footer>
    </article>
  );
}

/** 전처리 → 툴 → 후처리 → 검증 */
export function Stepper({ stages, stageMs = {} }) {
  return (
    <ol className="stepper">
      {STAGES.map(({ key, label }) => {
        const status = stages[key] ?? 'pending';
        return (
          <li key={key} className={`step step-${status}`}>
            <span className="step-dot" aria-hidden>{status === 'ok' ? '✓' : status === 'failed' ? '✕' : status === 'skipped' ? '–' : ''}</span>
            <span className="step-label">{label}</span>
            <span className="step-time">{stageMs[key] != null ? duration(stageMs[key]) : status === 'running' ? '…' : ''}</span>
          </li>
        );
      })}
    </ol>
  );
}

/** 투명성 콘솔: 실제 도구가 내는 로그를 그대로 흘려 보여 줍니다. */
function Console({ logs, live }) {
  const box = useRef(null);
  const [follow, setFollow] = useState(true);

  useEffect(() => {
    if (follow && box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [logs, follow]);

  return (
    <section className="console">
      <div className="console-head">
        <span className={`live-dot ${live ? 'live-dot-on' : ''}`} aria-hidden />
        <strong>투명성 콘솔</strong>
        <span className="muted">{logs.length}줄</span>
        <label className="console-follow">
          <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} /> 자동 스크롤
        </label>
      </div>
      <div className="console-body" ref={box}>
        {logs.length === 0 && <p className="muted">로그를 기다리는 중…</p>}
        {logs.map((l, i) => (
          <div key={i} className={`log log-${l.level}`}>
            <span className="log-time">{clock(l.at)}</span>
            <span className="log-module">{l.moduleId}</span>
            <span className="log-stage">{l.stage ? STAGE_LABEL[l.stage] : ''}</span>
            <span className="log-msg">{l.message}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
