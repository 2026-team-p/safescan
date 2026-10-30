import { useTranslation } from 'react-i18next';
import { localizeModule } from '../i18n.js';
import { duration, percent, usd } from '../lib/format.js';
import { aiUsage, combineAccuracy, compactNumber, meanBench, meanConfidence, severityTotals } from '../lib/metrics.js';
import { changedKeys, formatOptionValue } from '../lib/options.js';
import { Meter, SeverityChips } from './ui.jsx';

/** 정확도의 대표 값: F1, 정밀도를 잴 수 없으면(allowExtra) 재현율 */
export function headline(a) {
  if (!a) return null;
  return a.f1 != null ? { key: 'f1', value: a.f1 } : a.recall != null ? { key: 'recall', value: a.recall } : null;
}

/**
 * 검사 한 번의 수치 보고: 신뢰도 · 정확도 · 발견 · 시간 · AI 를 한 줄로, 그 아래 모듈별 표.
 * @param {{ result: any, modules: any[], bench?: Record<string, any>, onSelect?: (id: string) => void, selectedId?: string|null }} p
 */
export function RunReport({ result, modules, bench, onSelect, selectedId }) {
  const { t, i18n } = useTranslation();
  const byId = Object.fromEntries(modules.map((m) => [m.id, m]));
  // 지난 검사는 서버가 모듈 버전별 벤치를 붙여 주고, 방금 끝난 검사는 지금 모듈의 최근 벤치(같은 버전일 때)를 씁니다.
  const benchOf = (m) => bench?.[m.moduleId]
    ?? (byId[m.moduleId]?.bench?.status === 'ok' && byId[m.moduleId].bench.version === m.moduleVersion ? { source: 'bench', ...byId[m.moduleId].bench } : null);
  const ran = result.modules.filter((m) => m.status === 'ok');
  const confidence = meanConfidence(result.modules);
  const project = combineAccuracy(result.modules.filter((m) => m.accuracy).map((m) => m.accuracy));
  const benchAvg = meanBench(ran.map(benchOf));
  const projectHead = headline(project);
  const benchHead = headline(benchAvg);
  const ai = aiUsage(result.modules);
  const total = result.modules.reduce((a, m) => a + (m.metrics?.findingCount ?? m.findings?.length ?? 0), 0);
  const elapsed = Date.parse(result.finishedAt) - Date.parse(result.startedAt);

  return (
    <section className="report" aria-label={t('report.title')}>
      <dl className="kpi-row">
        <div className="kpi">
          <dt>{t('report.confidence')}</dt>
          <dd className="kpi-value">{percent(confidence)}</dd>
          <Meter value={confidence} label={t('report.confidence')} />
          <dd className="kpi-sub">{t('report.confidenceSub', { count: ran.length })}</dd>
        </div>
        <div className="kpi">
          <dt>{t('report.accuracy')}</dt>
          {projectHead ? (
            <>
              <dd className="kpi-value">{percent(projectHead.value)} <span className="kpi-unit">{t(`report.${projectHead.key}`)}</span></dd>
              <Meter value={projectHead.value} label={t('report.accuracy')} />
              <dd className="kpi-sub">
                {project.precisionModules < project.modules
                  ? t('report.precisionPartial', { value: percent(project.precision), count: project.precisionModules, total: project.modules })
                  : `${t('report.precision')} ${percent(project.precision)}`}
                {' · '}{t('report.recall')} {percent(project.recall)}
                <br />{t('report.byAnswerKey', { file: result.expectedFile })}
              </dd>
            </>
          ) : benchHead ? (
            <>
              <dd className="kpi-value">{percent(benchHead.value)} <span className="kpi-unit">{t(`report.${benchHead.key}`)}</span></dd>
              <Meter value={benchHead.value} label={t('report.accuracy')} />
              <dd className="kpi-sub">{t('report.byBench', { count: benchAvg.measured, total: ran.length })}</dd>
            </>
          ) : (
            <>
              <dd className="kpi-value">—</dd>
              <dd className="kpi-sub">{t('report.notMeasured')}</dd>
            </>
          )}
        </div>
        <div className="kpi">
          <dt>{t('report.findings')}</dt>
          <dd className="kpi-value">{total}</dd>
          <dd className="kpi-sub"><SeverityChips counts={severityTotals(result.modules)} /></dd>
        </div>
        <div className="kpi">
          <dt>{t('report.duration')}</dt>
          <dd className="kpi-value">{duration(elapsed)}</dd>
          <dd className="kpi-sub">{t('report.modulesRan', { ran: ran.length, total: result.modules.length })}</dd>
        </div>
        <div className="kpi">
          <dt>{t('report.ai')}</dt>
          <dd className="kpi-value kpi-text">{ai.models.length ? ai.models.join(', ') : t('report.noAi')}</dd>
          <dd className="kpi-sub">
            {ai.calls ? t('report.aiUsage', { calls: ai.calls, tokens: compactNumber(ai.tokens), cost: usd(ai.costUsd) })
              : result.ai?.available ? t('report.aiIdle', { model: result.ai.model }) : t('report.aiOff')}
          </dd>
        </div>
      </dl>

      <div className="report-table" role="table" aria-label={t('report.byModule')}>
        <div className="report-row report-row-head" role="row">
          {['module', 'status', 'findings', 'confidence', 'accuracy', 'duration', 'ai', 'options'].map((k) => (
            <span key={k} role="columnheader">{t(`report.col.${k}`)}</span>
          ))}
        </div>
        {result.modules.map((m) => {
          const module = byId[m.moduleId];
          const loc = module ? localizeModule(module, i18n.language) : null;
          const own = headline(m.accuracy);
          const b = benchOf(m);
          const benchH = headline(b);
          const changed = module && m.options ? changedKeys(module, m.options) : [];
          const calls = m.aiCalls ?? [];
          const Row = onSelect ? 'button' : 'div';
          return (
            <Row
              key={m.moduleId}
              type={onSelect ? 'button' : undefined}
              role="row"
              className={`report-row ${onSelect ? 'report-row-click' : ''} ${selectedId === m.moduleId ? 'report-row-selected' : ''}`}
              onClick={onSelect ? () => onSelect(m.moduleId) : undefined}
            >
              <span role="cell" className="report-module">
                <strong>{loc?.name ?? m.moduleId}</strong>
                <span className="muted small">v{m.moduleVersion}</span>
              </span>
              <span role="cell"><span className={`pill pill-${m.status}`}>{t(`status.${m.status}`)}</span></span>
              <span role="cell" data-label={t('report.col.findings')}>
                {m.status === 'ok' ? <SeverityChips counts={m.metrics?.bySeverity} /> : <span className="muted small">{m.reason}</span>}
              </span>
              <span role="cell" className="report-metric" data-label={t('report.col.confidence')}>
                <span className="num">{percent(m.metrics?.confidence)}</span>
                <Meter value={m.metrics?.confidence} label={t('report.col.confidence')} />
              </span>
              <span role="cell" className="report-metric" data-label={t('report.col.accuracy')}>
                {own ? (
                  <>
                    <span className="num">{percent(own.value)} <span className="muted small">{t(`report.${own.key}`)}</span></span>
                    <Meter value={own.value} label={t('report.col.accuracy')} />
                    <span className="muted small">{t('report.counts', { tp: m.accuracy.tp, fp: m.accuracy.fp ?? '—', fn: m.accuracy.fn })}</span>
                  </>
                ) : benchH ? (
                  <>
                    <span className="num">{percent(benchH.value)} <span className="tag tag-quiet">{t('report.benchTag')}</span></span>
                    <Meter value={benchH.value} label={t('report.col.accuracy')} />
                  </>
                ) : <span className="muted">—</span>}
              </span>
              <span role="cell" className="num" data-label={t('report.col.duration')}>{duration(m.metrics?.durationMs)}</span>
              <span role="cell" className="small" data-label={t('report.col.ai')}>
                {calls.length ? (
                  <>
                    {[...new Set(calls.map((c) => c.model))].join(', ')}
                    <span className="muted"> · {compactNumber(calls.reduce((a, c) => a + c.inputTokens + c.outputTokens, 0))} tok · {usd(m.metrics?.aiCostUsd)}</span>
                  </>
                ) : <span className="muted">—</span>}
              </span>
              <span
                role="cell"
                className="small"
                data-label={t('report.col.options')}
                title={changed.map((k) => `${loc.option(k).label}: ${formatOptionValue(m.options[k], loc.option(k), t)}`).join('\n')}
              >
                {!m.options ? '—' : changed.length ? t('report.optionsChanged', { count: changed.length }) : <span className="muted">{t('report.optionsDefault')}</span>}
              </span>
            </Row>
          );
        })}
      </div>
    </section>
  );
}
