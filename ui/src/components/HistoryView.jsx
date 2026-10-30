import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api.js';
import { localizeModule } from '../i18n.js';
import { dateTime, duration, percent, usd } from '../lib/format.js';
import { compactNumber, meanBench } from '../lib/metrics.js';
import { headline, RunReport } from './RunReport.jsx';
import { Meter, SeverityChips, Spinner } from './ui.jsx';

const RECENT_JOBS = 20;

/** 기록: 지난 검사마다 신뢰도 · 정확도 · 발견 · AI 사용을 한 줄로, 누르면 모듈별 수치. 아래에 AI 작업과 모델별 수치. */
export function HistoryView({ modules, refreshKey, onOpenRun, onError }) {
  const { t } = useTranslation();
  const [data, setData] = useState(null);
  const [openId, setOpenId] = useState(null);

  useEffect(() => {
    let alive = true;
    api.history().then((d) => alive && setData(d), (err) => onError(err.message));
    return () => {
      alive = false;
    };
  }, [refreshKey, onError]);

  if (!data) return <main className="page"><div className="center-pad"><Spinner size={24} /></div></main>;
  const { runs, aiJobs, models } = data;

  return (
    <main className="page">
      <section className="run-head">
        <div>
          <p className="eyebrow">{t('history.eyebrow')}</p>
          <h1>{t('history.title')}</h1>
          <p className="muted">{t('history.sub')}</p>
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <h2>{t('history.runs')}</h2>
          <span className="muted">{t('history.runCount', { count: runs.length })}</span>
        </div>
        {runs.length === 0 ? <p className="list-empty">{t('history.noRuns')}</p> : (
          <ul className="history-list">
            {runs.map((r, i) => (
              <RunRow
                key={r.runId}
                run={r}
                previous={runs.slice(i + 1).find((p) => p.kind === 'scan')}
                open={openId === r.runId}
                onToggle={() => setOpenId(openId === r.runId ? null : r.runId)}
                modules={modules}
                onOpenRun={onOpenRun}
                onError={onError}
              />
            ))}
          </ul>
        )}
      </section>

      <section className="section">
        <div className="section-head">
          <h2>{t('history.ai')}</h2>
          <span className="muted">{t('history.jobCount', { count: aiJobs.length })}</span>
        </div>
        {aiJobs.length === 0 ? <p className="list-empty">{t('history.noJobs')}</p> : (
          <>
            <ModelStats models={models} />
            <h3 className="sub-head">{t('history.recentJobs')}</h3>
            <ul className="job-list">
              {aiJobs.slice(0, RECENT_JOBS).map((j) => <JobRow key={j.jobId} job={j} modules={modules} />)}
            </ul>
          </>
        )}
      </section>
    </main>
  );
}

function RunRow({ run, previous, open, onToggle, modules, onOpenRun, onError }) {
  const { t } = useTranslation();
  const [detail, setDetail] = useState(null);
  const ok = run.modules.filter((m) => m.status === 'ok');
  const project = headline(run.accuracy);
  const bench = meanBench(ok.map((m) => m.benchAccuracy));
  const benchHead = headline(bench);
  const delta = previous && run.kind === 'scan' ? run.findings - previous.findings : null;

  useEffect(() => {
    if (open && !detail) api.run(run.runId).then(setDetail, (err) => onError(err.message));
  }, [open, detail, run.runId, onError]);

  return (
    <li className={`history-item ${open ? 'history-item-open' : ''}`}>
      <button type="button" className="history-row" aria-expanded={open} onClick={onToggle}>
        <span className="h-when">
          <strong>{dateTime(run.startedAt)}</strong>
          {run.kind === 'verify' && <span className="tag">{t('history.verify')}</span>}
          <span className="muted small">{t('history.modulesRan', { ran: run.statusCount.ok, total: run.modules.length })}</span>
        </span>
        <span className="h-findings">
          <span className="h-num">
            {run.findings}
            {delta !== null && delta !== 0 && <span className={`delta ${delta > 0 ? 'delta-up' : 'delta-down'}`}>{delta > 0 ? `▲${delta}` : `▼${-delta}`}</span>}
          </span>
          <SeverityChips counts={run.bySeverity} />
        </span>
        <span className="h-metric">
          <span className="h-label">{t('report.confidence')}</span>
          <span className="num">{percent(run.confidence)}</span>
          <Meter value={run.confidence} label={t('report.confidence')} />
        </span>
        <span className="h-metric">
          <span className="h-label">
            {t('report.accuracy')}
            {project ? <span className="tag tag-quiet">{t('history.answerKey')}</span> : benchHead && <span className="tag tag-quiet">{t('report.benchTag')}</span>}
          </span>
          <span className="num">{percent((project ?? benchHead)?.value)}</span>
          <Meter value={(project ?? benchHead)?.value} label={t('report.accuracy')} />
        </span>
        <span className="h-ai">
          <span className="h-label">{t('report.ai')}</span>
          <span className="small">{run.aiModels.length ? run.aiModels.join(', ') : t('report.noAi')}</span>
          {run.aiCalls > 0 && <span className="muted small">{compactNumber(run.tokens)} tok · {usd(run.costUsd)}</span>}
        </span>
        <span className="h-time num">{duration(run.durationMs)}</span>
        <span className="h-chevron" aria-hidden>{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div className="history-detail">
          {detail ? <RunReport result={detail.result} modules={modules} bench={detail.bench} /> : <Spinner />}
          <div className="row-gap history-actions">
            {run.issues && <span className="muted small">{t('history.issues', { created: run.issues.created, resolved: run.issues.resolved, open: run.issues.open })}</span>}
            <button type="button" className="btn btn-ghost" onClick={() => onOpenRun(run.runId, detail?.bench)}>{t('history.openRun')}</button>
          </div>
        </div>
      )}
    </li>
  );
}

/** 처리 방식 · 모델별: 요청 수, 결과, 수정안 적용과 재검사 통과, 토큰 · 비용 · 평균 시간 */
function ModelStats({ models }) {
  const { t } = useTranslation();
  return (
    <div className="report-table model-table" role="table" aria-label={t('history.byModel')}>
      <div className="report-row report-row-head" role="row">
        {['model', 'jobs', 'result', 'patches', 'resolved', 'tokens', 'cost', 'avg'].map((k) => <span key={k} role="columnheader">{t(`history.col.${k}`)}</span>)}
      </div>
      {models.map((m) => {
        const resolvedRate = m.accepted ? m.resolved / m.accepted : null;
        return (
          <div key={`${m.via}:${m.model ?? m.client?.name ?? ''}`} className="report-row" role="row">
            <span role="cell" className="report-module">
              <strong>{viaName(m, t)}</strong>
              <span className="muted small">{t(`history.via.${m.via}`)}</span>
            </span>
            <span role="cell" data-label={t('history.col.jobs')}>{t('history.jobsSplit', { recommend: m.recommend, patch: m.patch })}</span>
            <span role="cell" className="small" data-label={t('history.col.result')}>
              {t('history.resultSplit', { done: m.done, failed: m.failed, cancelled: m.cancelled })}
            </span>
            <span role="cell" className="small" data-label={t('history.col.patches')}>
              {m.patch ? t('history.patchSplit', { accepted: m.accepted, rejected: m.rejected }) : '—'}
            </span>
            <span role="cell" className="report-metric" data-label={t('history.col.resolved')}>
              <span className="num">{resolvedRate == null ? '—' : `${percent(resolvedRate)} (${m.resolved}/${m.accepted})`}</span>
              {resolvedRate != null && <Meter value={resolvedRate} label={t('history.col.resolved')} />}
            </span>
            <span role="cell" className="num" data-label={t('history.col.tokens')}>{m.via === 'api' ? compactNumber(m.inputTokens + m.outputTokens) : '—'}</span>
            <span role="cell" className="num" data-label={t('history.col.cost')}>{m.via === 'api' ? usd(m.costUsd) : m.via === 'claude' ? t('telemetry.subscription') : '—'}</span>
            <span role="cell" className="num" data-label={t('history.col.avg')}>{duration(m.avgDurationMs)}</span>
          </div>
        );
      })}
    </div>
  );
}

function JobRow({ job, modules }) {
  const { t, i18n } = useTranslation();
  const outcome = jobOutcome(job);
  const moduleName = (id) => {
    const m = modules.find((x) => x.id === id);
    return m ? localizeModule(m, i18n.language).name : id;
  };
  return (
    <li className="job-row">
      <span className="muted small num">{dateTime(job.createdAt)}</span>
      <span className="tag">{t(`history.kind.${job.kind}`)}</span>
      <span className="job-what">
        {job.kind === 'patch' ? (job.issueTitle ?? job.issueId) : job.selected ? job.selected.map(moduleName).join(', ') : '—'}
        {job.moduleId && <span className="muted small"> · {moduleName(job.moduleId)}</span>}
      </span>
      <span className="small">{viaName(job, t)}</span>
      <span className={`job-outcome job-outcome-${outcome.tone}`}>{t(`history.outcome.${outcome.key}`)}</span>
      <span className="muted small num">
        {job.via === 'api' ? `${compactNumber((job.inputTokens ?? 0) + (job.outputTokens ?? 0))} tok · ${usd(job.costUsd)} · ` : ''}{duration(job.durationMs)}
      </span>
    </li>
  );
}

function viaName(x, t) {
  if (x.via === 'claude') return x.client ? `${t('actor.claude')} (${x.client.name} ${x.client.version})` : t('actor.claude');
  if (x.via === 'rules') return t('history.via.rules');
  return x.model ?? 'API';
}

/** 작업 결과 한 마디: 수정안은 적용 · 재검사 결과까지 */
function jobOutcome(j) {
  if (j.status === 'failed') return { key: 'failed', tone: 'bad' };
  if (j.status === 'cancelled') return { key: 'cancelled', tone: 'muted' };
  if (j.kind === 'recommend') return { key: 'recommended', tone: 'good' };
  if (j.verify === 'resolved') return { key: 'resolved', tone: 'good' };
  if (j.verify === 'still_found') return { key: 'stillFound', tone: 'bad' };
  if (j.verify === 'incomplete') return { key: 'incomplete', tone: 'muted' };
  if (j.consumed === 'accepted') return { key: 'accepted', tone: 'good' };
  if (j.consumed === 'rejected') return { key: 'rejected', tone: 'muted' };
  return { key: 'proposed', tone: 'muted' };
}
