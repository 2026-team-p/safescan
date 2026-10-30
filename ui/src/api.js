// 로컬 서버(src/server) API 호출. 모든 요청에 이번 실행의 접속 토큰을 붙입니다.

const TOKEN_KEY = 'safescan:token';

/** 주소창의 ?token= 을 읽어 세션에 보관하고 주소에서는 지웁니다. */
function readToken() {
  const params = new URLSearchParams(window.location.search);
  const fromUrl = params.get('token');
  if (fromUrl) {
    try {
      sessionStorage.setItem(TOKEN_KEY, fromUrl);
    } catch { /* 저장이 막혀 있어도 이번 페이지에서는 씀 */ }
    params.delete('token');
    const rest = params.toString();
    window.history.replaceState(null, '', `${window.location.pathname}${rest ? `?${rest}` : ''}${window.location.hash}`);
    return fromUrl;
  }
  try {
    return sessionStorage.getItem(TOKEN_KEY) ?? '';
  } catch {
    return '';
  }
}

const token = readToken();

async function request(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: { 'X-SafeScan-Token': token, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error ?? `요청에 실패했습니다 (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

const post = (path, body = {}) => request(path, { method: 'POST', body });

export const api = {
  state: (refresh = false) => request(`/state${refresh ? '?refresh=1' : ''}`),
  recommend: () => post('/recommend'),
  job: (id) => request(`/jobs/${id}`),
  cancelJob: (id) => post(`/jobs/${id}/cancel`),
  startRun: (modules) => post('/runs', { modules }),
  issues: () => request('/issues'),
  setStatus: (id, status) => post(`/issues/${id}/status`, { status }),
  requestPatch: (id, options) => post(`/issues/${id}/patch`, { options }),
  acceptPatch: (id, patchId) => post(`/issues/${id}/patch/${patchId}/accept`),
  rejectPatch: (id, patchId) => post(`/issues/${id}/patch/${patchId}/reject`),
};

const withToken = (path) => `/api${path}${path.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`;

/** 검사 이벤트 구독 (SSE). 끊기면 브라우저가 Last-Event-ID 로 이어 받습니다. */
export function subscribeRun(runId, onEvent) {
  const source = new EventSource(withToken(`/runs/${runId}/events`));
  source.onmessage = (message) => {
    const event = JSON.parse(message.data);
    onEvent(event);
    if (event.type === 'run:closed') source.close();
  };
  return () => source.close();
}

/** 화면 전체 이벤트: 작업 진행(job) · 이슈 변경(issues) · AI 연결 상태(assistant) */
export function subscribeApp(onEvent) {
  const source = new EventSource(withToken('/stream'));
  source.onmessage = (message) => onEvent(JSON.parse(message.data));
  return () => source.close();
}
