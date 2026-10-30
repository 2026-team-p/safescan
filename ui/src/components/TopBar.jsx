import { baseName, duration, usd } from '../lib/format.js';
import { assistantLabel } from './AiJob.jsx';

export function TopBar({ state, assistant, tab, onTab, openIssues, telemetry }) {
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
          <span
            className={`ai-pill ai-pill-${assistant.mode}`}
            title={assistant.mode === 'claude'
              ? `${assistant.client?.name ?? 'Claude'} 세션이 AI 작업을 처리합니다${assistant.autoDelivery ? ' (버튼만으로 자동 전달 확인됨)' : ''}`
              : assistant.mode === 'api' ? 'ANTHROPIC_API_KEY 로 AI 작업을 처리합니다' : 'safescan setup 으로 Claude 에 연결할 수 있습니다'}
          >
            <span className="ai-dot" aria-hidden />
            {assistantLabel(assistant)}
          </span>
        </div>

        <nav className="tabs" aria-label="화면">
          <button type="button" className={tab === 'scan' ? 'tab tab-active' : 'tab'} onClick={() => onTab('scan')}>검사</button>
          <button type="button" className={tab === 'issues' ? 'tab tab-active' : 'tab'} onClick={() => onTab('issues')}>
            이슈 {openIssues > 0 && <span className="tab-count">{openIssues}</span>}
          </button>
        </nav>

        <Telemetry {...telemetry} claude={assistant.mode === 'claude'} />
      </div>
    </header>
  );
}

/** 검증 단계 지표: AI 비용 · 소요 시간 · 신뢰도. 검사 중에는 실시간으로 바뀝니다. */
function Telemetry({ aiCost, elapsedMs, confidence, live, claude }) {
  return (
    <dl className={`telemetry ${live ? 'telemetry-live' : ''}`} aria-label="실시간 리소스">
      <div title={claude ? 'Claude 세션 안에서 처리한 작업은 구독 사용량으로 계산되어 여기서 비용을 셀 수 없습니다' : undefined}>
        <dt>AI 비용</dt>
        <dd>{claude && !aiCost ? '구독' : usd(aiCost)}</dd>
      </div>
      <div>
        <dt>소요 시간</dt>
        <dd>{duration(elapsedMs)}</dd>
      </div>
      <div>
        <dt>신뢰도</dt>
        <dd>{confidence == null ? '—' : `${Math.round(confidence * 100)}%`}</dd>
      </div>
    </dl>
  );
}
