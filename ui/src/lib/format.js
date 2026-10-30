export const STAGES = [
  { key: 'preprocess', label: '전처리' },
  { key: 'tool', label: '툴' },
  { key: 'postprocess', label: '후처리' },
  { key: 'verify', label: '검증' },
];
export const STAGE_LABEL = Object.fromEntries(STAGES.map((s) => [s.key, s.label]));

export const SEVERITY = {
  critical: { icon: '🔴', label: '크리티컬', hint: '당장 서버가 뚫릴 수 있는 치명적 결함' },
  high: { icon: '🟠', label: '위험', hint: '잠재적 데이터 유출 위험' },
  medium: { icon: '🟡', label: '주의', hint: '권장 보안 설정 누락' },
  low: { icon: '🔵', label: '참고', hint: '코드 스멜 · 정보성' },
};
export const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low'];

export const COLUMNS = [
  { key: 'discovered', icon: '👀', label: '발견됨' },
  { key: 'in_progress', icon: '🛠️', label: '해결 중' },
  { key: 'resolved', icon: '✅', label: '조치 완료' },
];

export const CATEGORY = {
  sast: '코드 분석', dast: '동적 분석', dependency: '의존성', secrets: '비밀 값',
  config: '설정', iac: '인프라 코드', container: '컨테이너', other: '기타',
};

export const ACTOR = {
  safescan: { icon: '🛡️', label: 'SafeScan' },
  user: { icon: '👤', label: '나' },
  ai: { icon: '🤖', label: 'AI' },
};

const pad = (n) => String(n).padStart(2, '0');

export function clock(iso) {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function dateTime(iso) {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function duration(ms) {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms}ms`;
  const s = Math.floor(ms / 1000);
  return s < 60 ? `${(ms / 1000).toFixed(1)}s` : `${Math.floor(s / 60)}:${pad(s % 60)}`;
}

export const usd = (v) => `$${(v ?? 0).toFixed(4)}`;

export const whereOf = (f) => (f?.location ? `${f.location.file}${f.location.startLine ? `:${f.location.startLine}` : ''}` : '');

export function baseName(path) {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}
