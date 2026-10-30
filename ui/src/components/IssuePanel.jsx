import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api.js';
import { ACTOR_ICON, clock, COLUMNS, dateTime, duration, usd, whereOf } from '../lib/format.js';
import { isOpenJob, JobWaiting } from './AiJob.jsx';
import { DiffView } from './DiffView.jsx';
import { issueTitle } from './IssueBoard.jsx';
import { Stepper } from './RunView.jsx';
import { Chip, SeverityBadge, Spinner } from './ui.jsx';

const PATCH_OPTIONS = ['stability', 'performance', 'keepStructure', 'comments'];

/**
 * 이 이슈의 가장 최근 수정안 작업. 패널 밖(다른 탭 · 새로고침 · 채팅)에서 만들어진 작업도 찾고,
 * 적용 · 거절한 수정안은 다시 띄우지 않습니다.
 */
function latestPatchJob(jobs, issueId) {
  const mine = Object.values(jobs).filter((j) => j.kind === 'patch' && j.issueId === issueId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const job = mine[0];
  if (!job || job.status === 'cancelled') return null;
  if (job.status === 'done' && job.result?.patch?.consumed) return null;
  return job;
}

/** 칸반 카드를 누르면 열리는 오른쪽 패널: 결과 · AI 수정 요청 · 타임라인(스레드) */
export function IssuePanel({ issue, module, moduleNames, assistant, jobs, verifyRun, onClose, onMove, onIssue, onJob, onVerify, onError }) {
  const { t, i18n } = useTranslation();
  const [options, setOptions] = useState(new Set(['keepStructure']));
  const [busy, setBusy] = useState(null); // 'request' | 'accept'
  const [verifying, setVerifying] = useState(null); // runId

  useEffect(() => {
    setVerifying(null);
  }, [issue.id]);

  const job = latestPatchJob(jobs, issue.id);
  const patch = job?.status === 'done' ? job.result.patch : null;
  const finding = issue.findings[0];
  const claude = assistant.mode === 'claude';
  const blocked = !assistant.canPatch ? t('panel.blockedNoAi')
    : finding.dependency ? t('panel.blockedDependency')
      : !finding.location?.file ? t('panel.blockedNoFile') : null;
  const masked = module?.category === 'secrets' ? t('panel.hintMasked') : '';
  const hint = blocked ?? (claude ? t('panel.hintClaude', { file: finding.location.file }) + masked
    : t('panel.hintApi', { file: finding.location.file, model: assistant.model }) + masked);

  async function requestPatch() {
    setBusy('request');
    try {
      onJob((await api.requestPatch(issue.id, [...options], i18n.language)).job);
    } catch (err) {
      onError(err.message);
    } finally {
      setBusy(null);
    }
  }

  async function cancel() {
    try {
      onJob((await api.cancelJob(job.id)).job);
    } catch (err) {
      onError(err.message);
    }
  }

  async function accept() {
    setBusy('accept');
    try {
      const res = await api.acceptPatch(issue.id, patch.id);
      onIssue(res.issue);
      setVerifying(res.runId);
      onVerify(res.runId);
    } catch (err) {
      onError(err.message);
    } finally {
      setBusy(null);
    }
  }

  async function reject() {
    try {
      const res = await api.rejectPatch(issue.id, patch.id);
      if (res.issue) onIssue(res.issue);
    } catch (err) {
      onError(err.message);
    }
  }

  const verifyState = verifying && verifyRun.runId === verifying ? verifyRun : null;
  const verifyMod = verifyState?.modules[issue.moduleId];
  const working = busy !== null || isOpenJob(job) || Boolean(verifyState && !verifyState.closed);

  return (
    <aside className={`panel ${patch ? 'panel-wide' : ''}`} aria-label={t('panel.aria')}>
      <div className="panel-head">
        <SeverityBadge severity={issue.severity} />
        <div className="segmented" role="group" aria-label={t('panel.status')}>
          {COLUMNS.map((c) => (
            <button key={c.key} type="button" className={issue.status === c.key ? 'seg seg-active' : 'seg'} onClick={() => onMove(issue.id, c.key)}>
              {t(`column.${c.key}`)}
            </button>
          ))}
        </div>
        <button type="button" className="icon-btn" onClick={onClose} aria-label={t('panel.close')}>✕</button>
      </div>

      <div className="panel-body">
        <h2 className="panel-title">{issueTitle(issue, t)}</h2>
        <p className="muted">{moduleNames[issue.moduleId] ?? issue.moduleId} · {issue.id} · {t('panel.found', { date: dateTime(issue.createdAt) })}</p>

        {verifyState && (
          <div className={`verify ${verifyState.closed ? (issue.status === 'resolved' ? 'verify-ok' : 'verify-fail') : ''}`}>
            {!verifyState.closed ? (
              <>
                <p><Spinner size={12} /> {t('verify.running')}</p>
                {verifyMod && <Stepper stages={verifyMod.stages} stageMs={verifyMod.stageMs} />}
              </>
            ) : <p>{issue.status === 'resolved' ? t('verify.ok') : t('verify.fail')}</p>}
          </div>
        )}

        <section className="panel-section">
          <h3>{issue.status === 'resolved' ? t('panel.lastFound') : t('panel.findings', { count: issue.findings.length })}</h3>
          <ul className="findings">
            {issue.findings.map((f) => (
              <li key={f.fingerprint}>
                <span className="finding-where">{whereOf(f)}</span>
                <span>{f.title} <span className="muted">({f.ruleId})</span></span>
                {f.location?.snippet && <code className="snippet">{f.location.snippet}</code>}
                {f.dependency && <span className="muted">{f.dependency.name}@{f.dependency.version ?? '?'}{f.dependency.fixedIn ? ` → ${f.dependency.fixedIn}` : ''}</span>}
              </li>
            ))}
          </ul>
          {finding.remediation && <p className="remediation">💡 {finding.remediation}</p>}
        </section>

        {issue.status !== 'resolved' && (
          <section className="panel-section remedy">
            <h3>{claude ? t('panel.remedyClaude') : t('panel.remedyAi')}</h3>
            <div className="chips">
              {PATCH_OPTIONS.map((key) => (
                <Chip
                  key={key}
                  active={options.has(key)}
                  disabled={Boolean(blocked)}
                  onClick={() => {
                    const next = new Set(options);
                    if (next.has(key)) next.delete(key);
                    else next.add(key);
                    setOptions(next);
                  }}
                >
                  {t(`patchOption.${key}`)}
                </Chip>
              ))}
            </div>
            <button type="button" className="btn btn-wand" disabled={Boolean(blocked) || working} onClick={requestPatch}>
              {busy === 'request' || isOpenJob(job) ? <Spinner /> : <span aria-hidden>🪄</span>}
              {patch ? t('panel.retry') : claude ? t('panel.requestClaude') : t('panel.requestAi')}
            </button>
            <p className="hint">{hint}</p>

            {isOpenJob(job) && <JobWaiting job={job} assistant={assistant} onCancel={cancel} />}
            {job?.status === 'failed' && <div className="bubble bubble-error" role="alert"><p>{t('panel.failed', { error: job.error })}</p></div>}

            {patch && (
              <div className="patch">
                <div className="bubble bubble-ai">
                  <span className="bubble-source">
                    🤖 {job.via === 'claude' ? t('patch.claude', { time: duration(job.durationMs) }) : t('patch.ai')}
                    {patch.maskedSecrets ? t('patch.masked', { count: patch.maskedSecrets }) : ''}
                  </span>
                  <p>{patch.explanation}</p>
                </div>
                <DiffView file={patch.file} before={patch.original} after={patch.proposed} />
                <div className="row-gap row-end">
                  <button type="button" className="btn btn-ghost" onClick={reject} disabled={busy !== null}>{t('patch.reject')}</button>
                  <button type="button" className="btn btn-primary" onClick={accept} disabled={busy !== null}>
                    {busy === 'accept' ? <Spinner /> : null} {t('patch.accept')}
                  </button>
                </div>
              </div>
            )}
          </section>
        )}

        <section className="panel-section">
          <h3>{t('panel.timeline')}</h3>
          <ol className="thread">
            {issue.thread.map((entry, i) => {
              const who = entry.actor === 'ai' && entry.data?.via === 'claude' ? t('actor.claude') : t(`actor.${entry.actor}`);
              const optionLabels = entry.data?.optionKeys?.map((k) => t(`patchOption.${k}`)) ?? entry.data?.options ?? [];
              return (
                <li key={i} className={`thread-item thread-${entry.type}`}>
                  <span className="thread-avatar" title={who} aria-hidden>{ACTOR_ICON[entry.actor] ?? '•'}</span>
                  <div>
                    <p className="thread-meta"><strong>{who}</strong> · {clock(entry.at)} <span className="muted">{dateTime(entry.at)}</span></p>
                    <p>{threadText(entry, t, (id) => moduleNames[id] ?? id)}</p>
                    {optionLabels.length > 0 && <p className="thread-data">{optionLabels.map((o) => <span key={o} className="tag">{o}</span>)}</p>}
                    {entry.type === 'patch_proposed' && (
                      <p className="thread-data muted">
                        {entry.data?.via === 'claude' ? t('thread.claudeSession', { time: duration(entry.data.durationMs) }) : `${entry.data?.model ?? 'AI'} · ${usd(entry.data?.costUsd)}`}
                      </p>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      </div>
    </aside>
  );
}

/** 타임라인 기록을 화면 언어로. 숫자 · 이름(data)이 없는 예전 기록은 저장된 문장을 그대로 씁니다. */
function threadText(entry, t, moduleName) {
  const d = entry.data ?? {};
  switch (entry.type) {
    case 'detected':
      return d.count == null ? entry.message : `${t('thread.detected', { module: moduleName(d.moduleId), count: d.count })}${d.titles?.length ? ` — ${d.titles.join(', ')}` : ''}`;
    case 'changed':
      return d.count == null ? entry.message : t('thread.changed', d);
    case 'resolved':
      return t('thread.resolved');
    case 'reopened':
      return d.count == null ? entry.message : t('thread.reopened', d);
    case 'status':
      return d.from ? t('thread.status', { from: t(`column.${d.from}`), to: t(`column.${d.to}`) }) : entry.message;
    case 'patch_requested':
      return d.via ? t('thread.patch_requested', { who: d.via === 'claude' ? 'Claude' : 'AI' }) : entry.message;
    case 'patch_failed':
      return d.reason ? t('thread.patch_failed', { reason: d.reason }) : entry.message;
    case 'patch_accepted':
      return d.file ? t('thread.patch_accepted', { file: d.file }) : entry.message;
    case 'patch_rejected':
      return t('thread.patch_rejected');
    case 'patch_cancelled':
      return t('thread.patch_cancelled');
    case 'verify_failed':
      if (d.reason === 'still_found') return t('thread.verify_still_found');
      return d.reason ? t('thread.verify_incomplete', { status: t(`status.${d.status}`) }) : entry.message;
    default:
      return entry.message; // patch_proposed: AI 가 쓴 설명
  }
}
