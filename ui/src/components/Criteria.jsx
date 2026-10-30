import { useTranslation } from 'react-i18next';
import { localizeModule } from '../i18n.js';
import { percent, shortDate } from '../lib/format.js';

/** 모듈마다 정한 수치 검증 기준(신뢰도 구간 · 정확도 목표)과 최근 벤치 결과 */
export function Criteria({ module }) {
  const { t, i18n } = useTranslation();
  const { criteria, bench } = module;
  const loc = localizeModule(module, i18n.language);
  if (!criteria) return <p className="criteria-none">{t('criteria.none')}</p>;

  const targets = Object.entries(criteria.accuracy ?? {}).filter(([, v]) => typeof v === 'number');
  const benchOk = bench?.status === 'ok';

  return (
    <div className="criteria">
      {criteria.confidence?.length > 0 && (
        <section>
          <h4>{t('criteria.confidence')}</h4>
          <ul className="bands">
            {criteria.confidence.map((band, i) => (
              <li key={i}>
                <span className="band-value">{t('criteria.atLeast', { value: band.min.toFixed(2) })}</span>
                <span className="band-bar" aria-hidden><span style={{ width: `${band.min * 100}%` }} /></span>
                <span className="band-label">
                  {loc.criteriaLabel(i, band.label)}
                  {band.description && i18n.language === 'ko' && <span className="muted"> · {band.description}</span>}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {targets.length > 0 && (
        <section>
          <h4>{t('criteria.accuracy')}</h4>
          <ul className="targets">
            {targets.map(([key, target]) => {
              const actual = benchOk ? bench[key] : null;
              const state = actual == null ? 'unknown' : actual >= target ? 'pass' : 'fail';
              return (
                <li key={key} className={`target target-${state}`}>
                  <span className="target-name">{t(`criteria.${key}`)}</span>
                  <span className="muted">{t('criteria.target', { value: percent(target) })}</span>
                  <span className="target-actual">{actual == null ? '—' : t('criteria.actual', { value: percent(actual) })}</span>
                  <span className={`target-badge target-badge-${state}`}>
                    {state === 'pass' ? t('criteria.pass') : state === 'fail' ? t('criteria.fail') : t('criteria.notMeasured')}
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="muted criteria-foot">
            {!bench ? t('criteria.noBench', { id: module.id })
              : benchOk ? t('criteria.latest', { date: shortDate(bench.at), version: bench.version })
                : t('criteria.benchSkipped', { status: bench.status })}
          </p>
        </section>
      )}
    </div>
  );
}
