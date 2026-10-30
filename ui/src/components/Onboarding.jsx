/** 첫 진입: 빈 화면 대신 분석 중임을 보여 주는 뼈대 화면 */
export function Onboarding({ error, onRetry }) {
  return (
    <div className="onboarding">
      <div className="onboarding-message">
        {error ? (
          <>
            <p className="onboarding-title">서버에 연결하지 못했습니다</p>
            <p className="muted">{error}</p>
            <button type="button" className="btn btn-primary" onClick={onRetry}>다시 시도</button>
          </>
        ) : (
          <>
            <span className="pulse-dot" aria-hidden />
            <p className="onboarding-title">현재 디렉토리의 package.json · pom.xml 을 분석하고 있습니다…</p>
            <p className="muted">언어 · 프레임워크 · 패키지 매니저를 확인하고 설치된 보안 도구를 찾는 중입니다</p>
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
