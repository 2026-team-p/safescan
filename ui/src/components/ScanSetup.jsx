import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api.js';
import { localizeModule } from '../i18n.js';
import { display, duration, listOf, usd } from '../lib/format.js';
import { isOpenJob, JobWaiting } from './AiJob.jsx';
import { Criteria } from './Criteria.jsx';
import { Spinner, Toggle } from './ui.jsx';

const FILTERS = ['all', 'applies', 'ready', 'selected'];
const MAX_MARKERS = 6;

export function ScanSetup({ state, assistant, jobs, onJob, selected, onSelect, onStart, onError, starting }) {
  const { t, i18n } = useTranslation();
  const [jobId, setJobId] = useState(null);
  const [asking, setAsking] = useState(false);
  const applied = useRef(null);
  const { profile, modules } = state;
  const job = jobId ? jobs[jobId] : null;
  const advice = job?.status === 'done' ? job.result : null;
  const byId = useMemo(() => Object.fromEntries(modules.map((m) => [m.id, m])), [modules]);

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
      const res = await api.recommend(i18n.language);
      onJob(res.job);
      setJobId(res.job.id);
    } catch (err) {
      onError(err.message);
    } finally {
      setAsking(false);
    }
  }

  const count = [...selected].filter((id) => byId[id]?.ready).length;
  const busy = asking || isOpenJob(job);
  const adviceSource = !advice ? '' : advice.source === 'claude' ? t('advice.claude', { time: duration(job.durationMs) })
    : advice.source === 'ai' ? t('advice.ai', { cost: usd((job.aiCalls ?? []).reduce((sum, c) => sum + c.costUsd, 0)) }) : t('advice.rules');
  // 규칙 기반 추천은 판단 재료(basis)로 화면 언어에 맞춰 다시 씁니다.
  const reasoning = advice?.basis ? rulesReasoning(advice.basis, byId, t, i18n.language) : advice?.reasoning;

  return (
    <main className="page">
      <section className="hero">
        <div className="hero-text">
          <p className="eyebrow">{t('setup.eyebrow')}</p>
          <h1>{t('setup.title')}</h1>
          <Stack profile={profile} />
        </div>

        <div className="wand">
          <button type="button" className="btn btn-wand" onClick={askRecommendation} disabled={busy}>
            {busy ? <Spinner /> : <span aria-hidden>✨</span>}
            {busy ? t('wand.busy') : t('wand.button')}
          </button>
          {isOpenJob(job) && (
            <JobWaiting job={job} assistant={assistant} onCancel={() => api.cancelJob(job.id).then((r) => onJob(r.job), (e) => onError(e.message))} />
          )}
          {job?.status === 'failed' && <div className="bubble bubble-error" role="alert"><p>{t('advice.failed', { error: job.error })}</p></div>}
          {advice && (
            <div className="bubble" role="status">
              <span className="bubble-source">{adviceSource}</span>
              <p>{reasoning}</p>
              {advice.note && <p className="bubble-note">{advice.note}</p>}
              {assistant.mode === 'rules' && <p className="bubble-note">{t('advice.rulesHint')}</p>}
            </div>
          )}
        </div>
      </section>

      <ModuleList modules={modules} selected={selected} onSelect={onSelect} count={count} />

      <button type="button" className="fab" onClick={onStart} disabled={!count || starting}>
        {starting ? <Spinner size={18} /> : <span className="fab-play" aria-hidden>▶</span>}
        <span>{count ? t('fab.start', { count }) : t('fab.empty')}</span>
      </button>
    </main>
  );
}

/** 감지한 스택을 항목별로 분명하게 */
function Stack({ profile }) {
  const { t } = useTranslation();
  const rows = [
    ['languages', profile.languages.map(display)],
    ['frameworks', profile.frameworks.map(display)],
    ['packageManagers', profile.packageManagers.map(display)],
    ['markers', profile.markers],
  ];
  return (
    <dl className="stack-grid">
      {rows.map(([key, items]) => (
        <div key={key} className="stack-row">
          <dt>{t(`stack.${key}`)}</dt>
          <dd>
            {items.length === 0 && <span className="muted">{t('stack.none')}</span>}
            {items.slice(0, MAX_MARKERS).map((item) => <span key={item} className={`stack-chip ${key === 'markers' ? 'stack-chip-file' : ''}`}>{item}</span>)}
            {items.length > MAX_MARKERS && <span className="muted">+{items.length - MAX_MARKERS}</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function ModuleList({ modules, selected, onSelect, count }) {
  const { t, i18n } = useTranslation();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [category, setCategory] = useState(null);
  const [open, setOpen] = useState(() => new Set());
  const categories = [...new Set(modules.map((m) => m.category))];

  const toggle = (id, on) => {
    const next = new Set(selected);
    if (on) next.add(id);
    else next.delete(id);
    onSelect(next);
  };

  const q = query.trim().toLowerCase();
  const visible = modules.filter((m) => {
    if (filter === 'applies' && !m.applies.applies) return false;
    if (filter === 'ready' && !m.ready) return false;
    if (filter === 'selected' && !selected.has(m.id)) return false;
    if (category && m.category !== category) return false;
    if (!q) return true;
    const loc = localizeModule(m, i18n.language);
    return [loc.name, loc.description, m.name, m.id, m.tool?.name, ...m.owasp, t(`category.${m.category}`)].join(' ').toLowerCase().includes(q);
  });

  return (
    <section className="section">
      <div className="section-head">
        <h2>{t('modules.title')}</h2>
        <span className="muted">{t('modules.count', { total: modules.length, selected: count })}</span>
      </div>

      <div className="module-tools">
        <label className="search">
          <span aria-hidden>⌕</span>
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('modules.search')} aria-label={t('modules.search')} />
        </label>
        <div className="segmented segmented-soft" role="group">
          {FILTERS.map((f) => (
            <button key={f} type="button" className={filter === f ? 'seg seg-active' : 'seg'} onClick={() => setFilter(f)}>
              {t(`modules.filter.${f}`)}
            </button>
          ))}
        </div>
        {categories.length > 1 && (
          <div className="chips">
            {categories.map((c) => (
              <button key={c} type="button" className={`chip chip-small ${category === c ? 'chip-active' : ''}`} aria-pressed={category === c} onClick={() => setCategory(category === c ? null : c)}>
                {t(`category.${c}`)}
              </button>
            ))}
          </div>
        )}
      </div>

      {visible.length === 0 && <p className="list-empty">{t('modules.empty')}</p>}
      <ul className="module-list">
        {visible.map((m) => {
          const on = selected.has(m.id) && m.ready;
          const loc = localizeModule(m, i18n.language);
          const expanded = open.has(m.id);
          const blocked = m.errors.length ? t('module.manifestError')
            : m.missing.length ? t('module.missingTool', { bin: m.missing[0].bin }) : m.aiBlocked ? t('module.aiRequired') : null;
          const version = Object.values(m.toolVersions)[0];
          return (
            <li key={m.id} className={`module-row ${m.ready ? '' : 'module-row-blocked'} ${on ? 'module-row-on' : ''}`}>
              <div className="module-head">
                <button type="button" className="module-main" disabled={!m.ready} onClick={() => toggle(m.id, !on)}>
                  <span className="module-title">
                    {loc.name}
                    <span className="tag">{t(`category.${m.category}`)}</span>
                    {m.owasp.map((o) => <span key={o} className="tag tag-quiet">{o}</span>)}
                  </span>
                  <span className="module-desc">{loc.description}</span>
                  <span className="module-meta">
                    <span>{m.tool?.name}{version ? ` ${version}` : ''}</span>
                    <span className={m.applies.applies ? 'ok-text' : ''}>{m.applies.applies ? t('module.applies') : t('module.notApplies')}</span>
                    {m.ai !== 'none' && <span>{t('module.usesAi')}</span>}
                  </span>
                  {blocked && (
                    <span className="module-blocked">
                      {blocked}{m.missing[0] ? ` — ${t('module.install', { hint: m.missing[0].install })}` : ''}
                    </span>
                  )}
                </button>
                <Toggle checked={on} disabled={!m.ready} onChange={(v) => toggle(m.id, v)} label={t('module.toggle', { name: loc.name })} />
              </div>
              <button
                type="button"
                className="module-more"
                aria-expanded={expanded}
                onClick={() => setOpen((s) => {
                  const next = new Set(s);
                  if (next.has(m.id)) next.delete(m.id);
                  else next.add(m.id);
                  return next;
                })}
              >
                {expanded ? t('module.hideCriteria') : t('module.criteria')} <span aria-hidden>{expanded ? '▴' : '▾'}</span>
              </button>
              {expanded && <Criteria module={m} />}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function rulesReasoning(basis, byId, t, lang) {
  const name = (id) => (byId[id] ? localizeModule(byId[id], lang).name : id);
  const parts = [basis.stack.length ? t('reason.project', { stack: basis.stack.map(display).join(' · ') }) : t('reason.projectUnknown')];
  parts.push(basis.chosen.length
    ? t('reason.enable', {
      modules: listOf(basis.chosen.map((c) => `${name(c.id)} (${c.matched.length ? t('reason.matched', { file: c.matched[0] }) : t('reason.always')})`)),
    })
    : t('reason.none'));
  if (basis.missing.length) parts.push(t('reason.missing', { modules: listOf(basis.missing.map(name)) }));
  return parts.join(' ');
}
