// 표시용 도우미. 문장은 locales/*.json 에 있고, 여기에는 언어와 무관한 값(아이콘 · 순서 · 표기)만 둡니다.
import i18n from '../i18n.js';

export const STAGES = ['preprocess', 'tool', 'postprocess', 'verify'];
export const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low'];
export const SEVERITY_ICON = { critical: '🔴', high: '🟠', medium: '🟡', low: '🔵' };
export const COLUMNS = [
  { key: 'discovered', icon: '👀' },
  { key: 'in_progress', icon: '🛠️' },
  { key: 'resolved', icon: '✅' },
];
export const ACTOR_ICON = { safescan: '🛡️', user: '👤', ai: '🤖' };

/** 프로젝트 분석 결과의 공식 표기 */
const DISPLAY = {
  javascript: 'JavaScript', typescript: 'TypeScript', python: 'Python', java: 'Java', kotlin: 'Kotlin', go: 'Go',
  ruby: 'Ruby', php: 'PHP', csharp: 'C#', rust: 'Rust',
  react: 'React', next: 'Next.js', vue: 'Vue', nuxt: 'Nuxt', svelte: 'Svelte', angular: 'Angular', express: 'Express',
  fastify: 'Fastify', koa: 'Koa', nestjs: 'NestJS', hono: 'Hono', django: 'Django', flask: 'Flask', fastapi: 'FastAPI', spring: 'Spring',
  npm: 'npm', yarn: 'Yarn', pnpm: 'pnpm', bun: 'Bun', pip: 'pip', pipenv: 'Pipenv', poetry: 'Poetry', maven: 'Maven',
  gradle: 'Gradle', bundler: 'Bundler', composer: 'Composer', cargo: 'Cargo',
};
export const display = (name) => DISPLAY[name] ?? name;

export const maxSeverity = (counts) => SEVERITY_ORDER.find((s) => (counts?.[s] ?? 0) > 0) ?? null;

const pad = (n) => String(n).padStart(2, '0');

export function clock(iso) {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function dateTime(iso) {
  return new Intl.DateTimeFormat(i18n.language, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));
}

export function shortDate(iso) {
  return new Intl.DateTimeFormat(i18n.language, { month: 'numeric', day: 'numeric' }).format(new Date(iso));
}

export function duration(ms) {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms}ms`;
  const s = Math.floor(ms / 1000);
  return s < 60 ? `${(ms / 1000).toFixed(1)}s` : `${Math.floor(s / 60)}:${pad(s % 60)}`;
}

export const usd = (v) => `$${(v ?? 0).toFixed(4)}`;
export const percent = (v) => (v == null ? '—' : `${Math.round(v * 100)}%`);

export const whereOf = (f) => (f?.location ? `${f.location.file}${f.location.startLine ? `:${f.location.startLine}` : ''}` : '');

export function baseName(path) {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

/** 목록을 그 언어의 쉼표 · 접속사로 잇습니다 (예: "A, B 및 C") */
export function listOf(items) {
  return new Intl.ListFormat(i18n.language, { style: 'short', type: 'conjunction' }).format(items);
}
