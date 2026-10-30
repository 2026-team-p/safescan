// Nuclei 웹 취약점 스캔 — 작성 규칙: docs/MODULE_GUIDE.md, 기준 예시: modules/npm-audit/index.js
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { defineModule } from 'safescan/sdk';

const SEVERITY = { critical: 'critical', high: 'high', medium: 'medium', low: 'low', info: 'low', unknown: 'low' };
const NUCLEI_SEVERITIES = ['info', 'low', 'medium', 'high', 'critical'];
// 서버를 마비시키거나 데이터를 바꿀 수 있는 템플릿은 항상 제외합니다.
const EXCLUDE_TAGS = 'dos,fuzz,intrusive';
const DEFAULT_TAGS = ['exposure', 'misconfig'];
// AI 가 고를 수 있는 태그 (이 밖의 값은 버립니다)
const ALLOWED_TAGS = [
  'exposure', 'misconfig', 'config', 'debug', 'listing', 'panel', 'tech',
  'cve', 'default-login', 'token', 'cors', 'redirect', 'xss', 'sqli', 'lfi', 'ssrf',
];
const TAG_RE = /^[a-z0-9][a-z0-9_-]*$/i;
const LOCAL_HOST_RE = /^(localhost|127(\.\d{1,3}){3}|\[::1\])$/i;

// 템플릿 태그 → OWASP Top 10:2025. 먼저 맞는 항목들을 모두 모으고, 없으면 A02 로 둡니다.
const OWASP_BY_TAG = {
  misconfig: 'A02:2025', exposure: 'A02:2025', config: 'A02:2025', debug: 'A02:2025', listing: 'A02:2025', panel: 'A02:2025',
  cve: 'A03:2025',
  xss: 'A05:2025', sqli: 'A05:2025', injection: 'A05:2025', ssti: 'A05:2025', lfi: 'A05:2025',
  'default-login': 'A07:2025', auth: 'A07:2025', token: 'A07:2025',
};

export default defineModule({
  // 1) 전처리: 검사 대상 주소를 확인하고 템플릿 태그를 정합니다. 주소가 없거나 허용되지 않으면 건너뜁니다.
  async preprocess(ctx) {
    const url = checkTarget(ctx);
    const severity = parseSeverity(ctx.options.severity);
    const rateLimit = Number(ctx.options.rateLimit);
    if (!(rateLimit >= 1)) throw new Error('rateLimit 은 1 이상이어야 합니다');

    const userTags = parseTags(ctx.options.tags);
    let tags = userTags;
    if (!tags.length) tags = (await pickTagsWithAi(ctx)) ?? DEFAULT_TAGS;
    ctx.log.info(`대상 ${url} · 위험도 ${severity.join(',')} · 태그 ${tags.join(',')} · 템플릿 ${ctx.options.templates}`);
    return { url, severity, tags, rateLimit, bundled: ctx.options.templates !== 'all' };
  },

  // 2) 툴: nuclei 를 실행하고 JSONL 출력 원본을 그대로 돌려줍니다.
  async tool(ctx, input) {
    const args = [
      '-u', input.url,
      '-jsonl', '-omit-raw', '-silent', '-nc',
      '-duc',            // 시작할 때 업데이트 확인을 하지 않음
      '-ni',             // 외부 OAST 서버(interactsh)를 쓰지 않음
      '-no-stdin',       // 표준 입력이 열려 있어도 대상 목록을 기다리지 않음
      '-severity', input.severity.join(','),
      '-exclude-tags', EXCLUDE_TAGS,
      '-rl', String(input.rateLimit),
      '-timeout', '10', '-retries', '1',
    ];
    if (input.tags.length) args.push('-tags', input.tags.join(','));
    if (input.bundled) args.push('-t', join(ctx.module.dir, 'templates'));

    // 발견해도 종료 코드는 0 이지만, 버전에 따라 1 을 쓸 수 있어 정상으로 봅니다.
    const { stdout, stderr } = await ctx.exec('nuclei', args, { quiet: true, okExitCodes: [0, 1] });
    return { stdout, stderr };
  },

  // 3) 후처리: JSONL 한 줄 = Finding 한 개
  postprocess(ctx, raw) {
    const { records, badLines } = parseJsonl(raw.stdout);
    for (const n of badLines) ctx.log.warn(`nuclei 출력 ${n}번째 줄을 읽지 못했습니다 — 버립니다`);
    return records.map(toFinding);
  },

  // 4) 검증: 원본 줄 수와 결과 수가 맞는지, nuclei 가 오류를 내지 않았는지 확인합니다.
  verify(ctx, { raw, findings }) {
    const { records, badLines } = parseJsonl(raw.stdout);
    const expected = new Set(records.map((r) => fingerprintOf(r))).size;
    return {
      checks: [
        { name: 'JSONL 형식', passed: badLines.length === 0, detail: badLines.length ? `읽지 못한 줄: ${badLines.join(', ')}` : `${records.length}줄` },
        { name: '결과 수 일치', passed: expected === findings.length, detail: `nuclei ${expected}건 / 결과 ${findings.length}건` },
        { name: 'nuclei 오류 없음', passed: !/\[(ERR|FTL)\]/.test(raw.stderr), detail: firstErrorLine(raw.stderr) },
      ],
      notes: [
        '서버가 실제로 응답한 경로만 검사합니다. 로그인이 필요한 페이지는 검사하지 않습니다',
        '템플릿이 가리키는 경로가 없으면 취약점이 없는 것으로 보일 수 있습니다 (templates=bundled 는 모듈 내장 템플릿만 사용)',
      ],
    };
  },
});

/** targetUrl 을 확인합니다. 없거나 허용되지 않는 주소면 건너뜁니다. @returns {string} 정리된 주소 */
function checkTarget(ctx) {
  const given = ctx.options.targetUrl;
  if (typeof given !== 'string' || !given.trim()) {
    ctx.skip('검사할 서버 주소가 없습니다 (예: -o nuclei-web.targetUrl=http://localhost:3000)');
  }
  let url;
  try {
    url = new URL(given.trim());
  } catch {
    ctx.skip(`주소 형식이 올바르지 않습니다: ${given}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') ctx.skip('http:// 또는 https:// 주소만 검사할 수 있습니다');
  if (url.username || url.password) ctx.skip('주소에 계정 정보를 넣을 수 없습니다 (로그에 남습니다)');
  if (!LOCAL_HOST_RE.test(url.hostname) && !ctx.options.allowRemote) {
    ctx.skip(`'${url.hostname}' 은 localhost 가 아닙니다. 내 서버가 맞다면 allowRemote 옵션을 켜세요`);
  }
  return url.origin + (url.pathname === '/' ? '' : url.pathname);
}

function parseSeverity(value) {
  const list = String(value ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (!list.length) throw new Error('severity 에 위험도를 하나 이상 적어야 합니다');
  const bad = list.filter((s) => !NUCLEI_SEVERITIES.includes(s));
  if (bad.length) throw new Error(`severity 값이 올바르지 않습니다: ${bad.join(', ')} (${NUCLEI_SEVERITIES.join(' | ')})`);
  return [...new Set(list)];
}

function parseTags(value) {
  const list = String(value ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const bad = list.filter((t) => !TAG_RE.test(t));
  if (bad.length) throw new Error(`tags 값이 올바르지 않습니다: ${bad.join(', ')}`);
  return [...new Set(list)];
}

/** AI 가 있으면 프로젝트 정보를 보고 태그를 좁힙니다. 없거나 실패하면 null (규칙 기반 기본값 사용). */
async function pickTagsWithAi(ctx) {
  if (!ctx.options.useAiTags || !ctx.ai.available) return null;
  const { languages, frameworks, packageManagers } = ctx.project.profile;
  try {
    const res = await ctx.ai.complete({
      purpose: 'nuclei 태그 선택',
      json: true,
      effort: 'low',
      maxTokens: 300,
      system: '웹 서버를 검사할 Nuclei 템플릿 태그를 고릅니다. 반드시 {"tags": ["..."]} 형태의 JSON 으로만 답하세요.',
      prompt: `프로젝트 정보: ${JSON.stringify({ languages, frameworks, packageManagers })}\n`
        + `허용 태그: ${ALLOWED_TAGS.join(', ')}\n이 프로젝트에 의미 있는 태그를 허용 태그 안에서 2~6개 고르세요.`,
    });
    const picked = (Array.isArray(res.json?.tags) ? res.json.tags : [])
      .filter((t) => typeof t === 'string' && ALLOWED_TAGS.includes(t));
    if (!picked.length) {
      ctx.log.warn('AI 가 쓸 수 있는 태그를 돌려주지 않아 기본 태그를 씁니다');
      return null;
    }
    return [...new Set(picked)];
  } catch (err) {
    ctx.log.warn(`AI 태그 선택에 실패해 기본 태그를 씁니다: ${err.message}`);
    return null;
  }
}

/** @returns {{ records: any[], badLines: number[] }}  badLines 는 읽지 못한 줄 번호(1부터) */
function parseJsonl(text) {
  const records = [];
  const badLines = [];
  String(text ?? '').split('\n').forEach((line, i) => {
    if (!line.trim()) return;
    try {
      const rec = JSON.parse(line);
      if (rec && typeof rec === 'object' && typeof rec['template-id'] === 'string') records.push(rec);
      else badLines.push(i + 1);
    } catch {
      badLines.push(i + 1);
    }
  });
  return { records, badLines };
}

function toFinding(rec) {
  const info = rec.info ?? {};
  const rawSeverity = String(info.severity ?? 'unknown').toLowerCase();
  const tags = toArray(info.tags);
  const matchedAt = rec['matched-at'] ?? rec.url ?? rec.host ?? '';
  const extracted = toArray(rec['extracted-results']);
  const cves = toArray(info.classification?.['cve-id']);

  return {
    ruleId: rec['template-id'],
    title: info.name ?? rec['template-id'],
    severity: SEVERITY[rawSeverity] ?? 'low',
    // 실제 요청으로 matcher 가 일치한 결과입니다. 정보성(info · unknown)은 오탐 가능성이 더 큽니다.
    confidence: ['info', 'unknown'].includes(rawSeverity) ? 0.6 : extracted.length ? 0.9 : 0.85,
    description: [info.description, `대상: ${matchedAt}`].filter(Boolean).join('\n'),
    owasp: owaspFor(tags),
    cwe: toArray(info.classification?.['cwe-id']).map((c) => String(c).toUpperCase()).filter((c) => /^CWE-\d+$/.test(c)),
    remediation: info.remediation || undefined,
    references: [...toArray(info.reference), ...cves.map((id) => `https://nvd.nist.gov/vuln/detail/${id}`)],
    fingerprint: fingerprintOf(rec),
    // 템플릿 경로 · base64 템플릿 · curl 명령은 담지 않습니다 (내 컴퓨터의 경로가 기록에 남음)
    raw: { matchedAt, type: rec.type, tags, matcherName: rec['matcher-name'], extracted: extracted.slice(0, 5) },
  };
}

/** 같은 템플릿 · 같은 경로면 쿼리 문자열이 달라도 같은 문제로 봅니다 (재검사 · 재검증에서 이슈가 이어지도록). */
function fingerprintOf(rec) {
  let target = rec['matched-at'] ?? rec.url ?? rec.host ?? '';
  try {
    const u = new URL(target);
    target = u.origin + u.pathname;
  } catch { /* 주소가 아니면 그대로 */ }
  const key = ['nuclei-web', rec['template-id'], rec['matcher-name'] ?? '', target].join('\u0000');
  return createHash('sha1').update(key).digest('hex').slice(0, 16);
}

function owaspFor(tags) {
  const found = [...new Set(tags.map((t) => OWASP_BY_TAG[String(t).toLowerCase()]).filter(Boolean))];
  return found.length ? found : ['A02:2025'];
}

function toArray(value) {
  if (value === undefined || value === null) return [];
  return (Array.isArray(value) ? value : [value]).filter((v) => v !== null && v !== '');
}

function firstErrorLine(stderr) {
  return stderr.split('\n').find((l) => /\[(ERR|FTL)\]/.test(l))?.slice(0, 200) ?? '';
}
