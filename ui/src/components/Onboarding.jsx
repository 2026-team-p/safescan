import { useTranslation } from 'react-i18next';

/** 첫 진입: 빈 화면 대신 분석 중임을 보여 주는 뼈대 화면 */
export function Onboarding({ error, onRetry }) {
  const { t } = useTranslation();
  return (
    <div className="onboarding">
      <div className="onboarding-message">
        {error ? (
          <>
            <p className="onboarding-title">{t('onboarding.errorTitle')}</p>
            <p className="muted">{error === 'token' ? t('onboarding.tokenError') : error}</p>
            <button type="button" className="btn btn-primary" onClick={onRetry}>{t('onboarding.retry')}</button>
          </>
        ) : (
          <>
            <span className="pulse-dot" aria-hidden />
            <p className="onboarding-title">{t('onboarding.title')}</p>
            <p className="muted">{t('onboarding.sub')}</p>
          </>
        )}
      </div>
      {!error && (
        <div className="skeleton-page" aria-hidden>
          <div className="skeleton skeleton-hero" />
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="skeleton-row">
              <div className="skeleton-lines">
                <div className="skeleton" style={{ width: `${40 + i * 7}%` }} />
                <div className="skeleton skeleton-thin" style={{ width: `${70 - i * 6}%` }} />
              </div>
              <div className="skeleton skeleton-toggle" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
