import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { CATEGORY, duration, usd } from '../lib/format.js';
import { isOpenJob, JobWaiting } from './AiJob.jsx';
import { Spinner, Toggle } from './ui.jsx';

export function ScanSetup({ state, assistant, jobs, onJob, selected, onSelect, onStart, onError, starting }) {
  const [jobId, setJobId] = useState(null);
  const [asking, setAsking] = useState(false);
  const applied = useRef(null);
  const { profile, modules } = state;
  const stack = [...profile.frameworks, ...profile.languages, ...profile.packageManagers];
  const job = jobId ? jobs[jobId] : null;
  const advice = job?.status === 'done' ? job.result : null;

  // 추천이 끝나면 고른 모듈을 한 번만 켭니다.
  useEffect(() => {
    if (job?.status === 'done' && applied.current !== job.id) {
      applied.current = job.id;
      onSelect(new Set(job.result.selected));
    }
  }, [job, onSelect]);

  async function askRecommendation() {
    setAsking(true);
    try {
      const res = await api.recommend();
      onJob(res.job);
      setJobId(res.job.id);
    } catch (err) {
      onError(err.message);
    } finally {
      setAsking(false);
    }
  }

  const adviceSource = !advice ? '' : advice.source === 'claude' ? `Claude 추천 · ${duration(job.durationMs)}`
    : advice.source === 'ai' ? `AI 추천 · ${usd((job.aiCalls ?? []).reduce((sum, c) => sum + c.costUsd, 0))}` : '규칙 기반 추천';

  const toggle = (id, on) => {
    const next = new Set(selected);
    if (on) next.add(id);
    else next.delete(id);
    onSelect(next);
  };

  const count = [...selected].filter((id) => modules.some((m) => m.id === id && m.ready)).length;
  const busy = asking || isOpenJob(job);

  return (
    <main className="page">
      <section className="hero">
        <div className="hero-text">
          <p className="eyebrow">검사 설정</p>
          <h1>이 프로젝트에 맞는 검사를 고르세요</h1>
          <div className="stack">
            {stack.length ? stack.map((s) => <span key={s} className="stack-chip">{s}</span>) : <span className="muted">감지된 언어 · 프레임워크가 없습니다</span>}
          </div>
        </div>

        <div className="wand">
          <button type="button" className="btn btn-wand" onClick={askRecommendation} disabled={busy}>
            {busy ? <Spinner /> : <span aria-hidden>✨</span>}
            {busy ? '프로젝트를 살펴보는 중…' : '내 프로젝트에 맞는 검사 자동 세팅'}
          </button>
          {isOpenJob(job) && (
            <JobWaiting job={job} assistant={assistant} what="추천을" onCancel={() => api.cancelJob(job.id).then((r) => onJob(r.job), (e) => onError(e.message))} />
          )}
          {job?.status === 'failed' && <div className="bubble bubble-error" role="alert"><p>추천을 받지 못했습니다: {job.error}</p></div>}
          {advice && (
            <div className="bubble" role="status">
              <span className="bubble-source">{adviceSource}</span>
              <p>{advice.reasoning}</p>
              {advice.note && <p className="bubble-note">{advice.note}</p>}
              {assistant.mode === 'rules' && <p className="bubble-note">Claude 에 연결하거나(safescan setup) ANTHROPIC_API_KEY 를 설정하면 AI 가 프로젝트를 읽고 골라 줍니다.</p>}
            </div>
          )}
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <h2>보안 검사 모듈</h2>
          <span className="muted">{modules.length}개 중 {count}개 선택</span>
        </div>
        <ul className="module-list">
          {modules.map((m) => {
            const on = selected.has(m.id) && m.ready;
            return (
              <li key={m.id} className={`module-row ${m.ready ? '' : 'module-row-blocked'} ${on ? 'module-row-on' : ''}`}>
                <button type="button" className="module-main" disabled={!m.ready} onClick={() => toggle(m.id, !on)}>
                  <span className="module-title">
                    {m.name}
                    <span className="tag">{CATEGORY[m.category] ?? m.category}</span>
                    {m.owasp.map((o) => <span key={o} className="tag tag-quiet">{o}</span>)}
                  </span>
                  <span className="module-desc">{m.description}</span>
                  <span className="module-meta">
                    {m.tool?.name}
                    {Object.values(m.toolVersions)[0] ? ` ${Object.values(m.toolVersions)[0]}` : ''}
                    {' · '}
                    {m.applies.applies ? <span className="ok-text">이 프로젝트에 해당</span> : '해당 조건 없음'}
                    {m.ai !== 'none' && ' · AI 사용'}
                  </span>
                  {m.blockedReason && (
                    <span className="module-blocked">
                      {m.blockedReason}{m.missing[0] ? ` — ${m.missing[0].install}` : ''}
                    </span>
                  )}
                </button>
                <Toggle checked={on} disabled={!m.ready} onChange={(v) => toggle(m.id, v)} label={`${m.name} 켜기`} />
              </li>
            );
          })}
        </ul>
      </section>

      <button type="button" className="fab" onClick={onStart} disabled={!count || starting}>
        {starting ? <Spinner size={18} /> : <span className="fab-play" aria-hidden>▶</span>}
        <span>{count ? `${count}개 모듈 검사 시작` : '모듈을 골라 주세요'}</span>
      </button>
    </main>
  );
}
