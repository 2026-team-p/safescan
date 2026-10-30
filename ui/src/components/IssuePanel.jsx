import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { ACTOR, clock, COLUMNS, dateTime, duration, usd, whereOf } from '../lib/format.js';
import { isOpenJob, JobWaiting } from './AiJob.jsx';
import { DiffView } from './DiffView.jsx';
import { Stepper } from './RunView.jsx';
import { Chip, SeverityBadge, Spinner } from './ui.jsx';

/** 칸반 카드를 누르면 열리는 오른쪽 패널: 결과 · AI 수정 요청 · 타임라인(스레드) */
export function IssuePanel({ issue, module, state, assistant, jobs, verifyRun, onClose, onMove, onIssue, onJob, onVerify, onError }) {
  const [options, setOptions] = useState(new Set(['keepStructure']));
  const [jobId, setJobId] = useState(null);
  const [busy, setBusy] = useState(null); // 'request' | 'accept'
  const [verifying, setVerifying] = useState(null); // runId

  useEffect(() => {
    setJobId(null);
    setVerifying(null);
  }, [issue.id]);

  const job = jobId ? jobs[jobId] : null;
  const patch = job?.status === 'done' ? job.result.patch : null;
  const finding = issue.findings[0];
  const claude = assistant.mode === 'claude';
  const blocked = !assistant.canPatch
    ? 'AI 가 연결되어 있지 않습니다. safescan setup 으로 Claude 에 연결하거나 ANTHROPIC_API_KEY 를 설정하세요'
    : finding.dependency ? '의존성 이슈는 패키지 매니저로 해결하세요 (예: npm audit fix)'
      : !finding.location?.file ? '파일 위치가 없는 이슈입니다' : null;
  const hint = blocked ?? (claude
    ? `연결된 Claude 세션이 ${finding.location.file} 을 읽고 수정안을 만듭니다. 파일은 여기서 적용할 때만 바뀝니다.${module?.category === 'secrets' ? ' 비밀 값은 가린 채로 전달합니다.' : ''}`
    : `${finding.location.file} 내용이 AI(${assistant.model})로 전송됩니다.${module?.category === 'secrets' ? ' 비밀 값은 가린 뒤 보냅니다.' : ''}`);

  async function requestPatch() {
    setBusy('request');
    try {
      const res = await api.requestPatch(issue.id, [...options]);
      onJob(res.job);
      setJobId(res.job.id);
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
    setJobId(null);
  }

  async function accept() {
    setBusy('accept');
    try {
      const res = await api.acceptPatch(issue.id, patch.id);
      onIssue(res.issue);
      setJobId(null);
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
    setJobId(null);
  }

  const verifyState = verifying && verifyRun.runId === verifying ? verifyRun : null;
  const verifyMod = verifyState?.modules[issue.moduleId];
  const working = busy !== null || isOpenJob(job) || Boolean(verifyState && !verifyState.closed);

  return (
    <aside className={`panel ${patch ? 'panel-wide' : ''}`} aria-label="이슈 상세">
      <div className="panel-head">
        <SeverityBadge severity={issue.severity} />
        <div className="segmented" role="group" aria-label="상태">
          {COLUMNS.map((c) => (
            <button key={c.key} type="button" className={issue.status === c.key ? 'seg seg-active' : 'seg'} onClick={() => onMove(issue.id, c.key)}>
              {c.label}
            </button>
          ))}
        </div>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="닫기">✕</button>
      </div>

      <div className="panel-body">
        <h2 className="panel-title">{issue.title}</h2>
        <p className="muted">{module?.name ?? issue.moduleId} · {issue.id} · {dateTime(issue.createdAt)} 발견</p>

        {verifyState && (
          <div className={`verify ${verifyState.closed ? (issue.status === 'resolved' ? 'verify-ok' : 'verify-fail') : ''}`}>
            {!verifyState.closed ? (
              <>
                <p><Spinner size={12} /> 수정한 코드를 다시 검사하고 있습니다</p>
                {verifyMod && <Stepper stages={verifyMod.stages} stageMs={verifyMod.stageMs} />}
              </>
            ) : issue.status === 'resolved' ? <p>✅ 재검사 통과 — 이 문제가 더 이상 발견되지 않습니다</p>
              : <p>⚠️ 재검사에서 여전히 발견됩니다. 옵션을 바꿔 다시 요청해 보세요</p>}
          </div>
        )}

        <section className="panel-section">
          <h3>{issue.status === 'resolved' ? '마지막으로 발견된 내용' : `발견 내용 ${issue.findings.length}건`}</h3>
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
            <h3>{claude ? 'Claude 해결책' : 'AI 해결책'}</h3>
            <div className="chips">
              {Object.entries(state.patchOptions).map(([key, label]) => (
                <Chip
                  key={key}
                  active={options.has(key)}
                  onClick={() => {
                    const next = new Set(options);
                    if (next.has(key)) next.delete(key);
                    else next.add(key);
                    setOptions(next);
                  }}
                >
                  {label}
                </Chip>
              ))}
            </div>
            <button type="button" className="btn btn-wand" disabled={Boolean(blocked) || working} onClick={requestPatch}>
              {busy === 'request' || isOpenJob(job) ? <Spinner /> : <span aria-hidden>🪄</span>}
              {patch ? '옵션을 바꿔 다시 요청' : `${claude ? 'Claude' : 'AI'}에게 해결책(Patch) 요청`}
            </button>
            <p className="hint">{hint}</p>

            {isOpenJob(job) && <JobWaiting job={job} assistant={assistant} what="수정안을" onCancel={cancel} />}
            {job?.status === 'failed' && <div className="bubble bubble-error" role="alert"><p>수정안을 받지 못했습니다: {job.error}</p></div>}

            {patch && (
              <div className="patch">
                <div className="bubble bubble-ai">
                  <span className="bubble-source">
                    🤖 {job.via === 'claude' ? `Claude 제안 · ${duration(job.durationMs)}` : 'AI 제안'}
                    {patch.maskedSecrets ? ` · 비밀 값 ${patch.maskedSecrets}개 가림` : ''}
                  </span>
                  <p>{patch.explanation}</p>
                </div>
                <DiffView file={patch.file} before={patch.original} after={patch.proposed} />
                <div className="row-gap row-end">
                  <button type="button" className="btn btn-ghost" onClick={reject} disabled={busy !== null}>거절</button>
                  <button type="button" className="btn btn-primary" onClick={accept} disabled={busy !== null}>
                    {busy === 'accept' ? <Spinner /> : null} 적용하고 다시 검사 (Accept)
                  </button>
                </div>
              </div>
            )}
          </section>
        )}

        <section className="panel-section">
          <h3>타임라인</h3>
          <ol className="thread">
            {issue.thread.map((t, i) => {
              const who = t.actor === 'ai' && t.data?.via === 'claude' ? 'Claude' : ACTOR[t.actor]?.label ?? t.actor;
              return (
              <li key={i} className={`thread-item thread-${t.type}`}>
                <span className="thread-avatar" title={who} aria-hidden>{ACTOR[t.actor]?.icon ?? '•'}</span>
                <div>
                  <p className="thread-meta"><strong>{who}</strong> · {clock(t.at)} <span className="muted">{dateTime(t.at).split(' ')[0]}</span></p>
                  <p>{t.message}</p>
                  {t.data?.options?.length > 0 && <p className="thread-data">{t.data.options.map((o) => <span key={o} className="tag">{o}</span>)}</p>}
                  {t.type === 'patch_proposed' && (
                    <p className="thread-data muted">
                      {t.data?.via === 'claude' ? `Claude 세션 · ${duration(t.data.durationMs)}` : `${t.data?.model ?? 'AI'} · ${usd(t.data?.costUsd)}`}
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
