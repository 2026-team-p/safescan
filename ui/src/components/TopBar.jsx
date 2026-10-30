import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LANGS } from '../i18n.js';
import { baseName, duration, percent, usd } from '../lib/format.js';
import { applyTheme, loadTheme, THEMES } from '../lib/theme.js';

const THEME_ICON = { system: '◐', light: '☀', dark: '☾' };

export function TopBar({ state, assistant, waitingJobs, tab, onTab, openIssues, telemetry }) {
  const { t } = useTranslation();
  const client = assistant.client?.name ?? 'Claude';
  const label = assistant.mode === 'claude' ? t(assistant.autoDelivery ? 'assistant.claudeAuto' : 'assistant.claude')
    : assistant.mode === 'api' ? t('assistant.api', { model: assistant.model }) : t('assistant.off');
  const title = assistant.mode === 'claude' ? t(assistant.autoDelivery ? 'assistant.titleClaudeAuto' : 'assistant.titleClaude', { client })
    : assistant.mode === 'api' ? t('assistant.titleApi') : t('assistant.titleOff');

  return (
    <header className="topbar">
      <div className="topbar-inner">
        <div className="brand">
          <span className="brand-mark" aria-hidden>
            <svg viewBox="0 0 32 32" width="18" height="18"><path d="M16 5l8 3.4v6.2c0 5-3.4 9.2-8 10.6-4.6-1.4-8-5.6-8-10.6V8.4z" fill="currentColor" /></svg>
          </span>
          <div className="brand-text">
            <strong>SafeScan</strong>
            <span title={state.projectRoot}>{baseName(state.projectRoot)}</span>
          </div>
          <span className={`ai-pill ai-pill-${assistant.mode}`} title={title}>
            <span className="ai-dot" aria-hidden />
            {label}
          </span>
          {waitingJobs > 0 && (
            <span className="ai-pill ai-pill-waiting" title={t('assistant.waitingTitle', { count: waitingJobs, request: t('job.request') })}>
              <span className="ai-dot" aria-hidden />
              {t('assistant.waiting', { count: waitingJobs })}
            </span>
          )}
        </div>

        <nav className="tabs" aria-label="SafeScan">
          <button type="button" className={tab === 'scan' ? 'tab tab-active' : 'tab'} onClick={() => onTab('scan')}>{t('tab.scan')}</button>
          <button type="button" className={tab === 'issues' ? 'tab tab-active' : 'tab'} onClick={() => onTab('issues')}>
            {t('tab.issues')} {openIssues > 0 && <span className="tab-count">{openIssues}</span>}
          </button>
          <button type="button" className={tab === 'history' ? 'tab tab-active' : 'tab'} onClick={() => onTab('history')}>{t('tab.history')}</button>
        </nav>

        <div className="topbar-right">
          <Telemetry {...telemetry} claude={assistant.mode === 'claude'} />
          <Settings />
        </div>
      </div>
    </header>
  );
}

/** 검증 단계 지표: AI 비용 · 소요 시간 · 신뢰도. 검사 중에는 실시간으로 바뀝니다. */
function Telemetry({ aiCost, elapsedMs, confidence, live, claude }) {
  const { t } = useTranslation();
  return (
    <dl className={`telemetry ${live ? 'telemetry-live' : ''}`} aria-label={t('telemetry.aria')}>
      <div title={claude ? t('telemetry.subscriptionTitle') : undefined}>
        <dt>{t('telemetry.cost')}</dt>
        <dd>{claude && !aiCost ? t('telemetry.subscription') : usd(aiCost)}</dd>
      </div>
      <div>
        <dt>{t('telemetry.time')}</dt>
        <dd>{duration(elapsedMs)}</dd>
      </div>
      <div>
        <dt>{t('telemetry.confidence')}</dt>
        <dd>{percent(confidence)}</dd>
      </div>
    </dl>
  );
}

function Settings() {
  const { t, i18n } = useTranslation();
  const [theme, setTheme] = useState(loadTheme);
  const next = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];

  return (
    <div className="settings">
      <label className="lang-select" title={t('lang.label')}>
        <span aria-hidden>🌐</span>
        <select value={i18n.language} onChange={(e) => i18n.changeLanguage(e.target.value)} aria-label={t('lang.label')}>
          {LANGS.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
        </select>
      </label>
      <button
        type="button"
        className="icon-btn theme-btn"
        title={`${t('theme.label')}: ${t(`theme.${theme}`)}`}
        aria-label={`${t('theme.label')}: ${t(`theme.${theme}`)} → ${t(`theme.${next}`)}`}
        onClick={() => {
          applyTheme(next);
          setTheme(next);
        }}
      >
        {THEME_ICON[theme]}
      </button>
    </div>
  );
}
