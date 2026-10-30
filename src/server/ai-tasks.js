// UI → AI 파이프라인: 모듈 자동 추천, 이슈 수정안(patch) 생성.
// 모든 호출은 meterAi 로 계측되어 비용 · 토큰이 UI 텔레메트리에 쌓입니다.
import { meterAi } from '../core/ai.js';

/** 화면 언어 → AI 에게 알려 줄 답변 언어 */
export const LANG_NAMES = { ko: '한국어', en: 'English', ja: '日本語', es: 'Español', zh: '简体中文' };
export const langName = (lang) => LANG_NAMES[lang] ?? LANG_NAMES.ko;

// ───────────────────────────── 모듈 추천 ─────────────────────────────

/**
 * @param {object} p
 * @param {import('../sdk/types.js').ProjectProfile} p.profile
 * @param {Array<{ id: string, name: string, description: string, category: string, ready: boolean,
 *                 applies: { applies: boolean, matched: string[] } }>} p.modules
 * @param {import('../core/ai.js').AiProvider} p.aiProvider
 * @param {(record: import('../sdk/types.js').AiCallRecord) => void} p.onAiCall
 * @param {string} [p.lang]  답변 언어 (화면 언어)
 */
export async function recommendModules({ profile, modules, aiProvider, onAiCall, lang = 'ko' }) {
  const rules = recommendByRules(profile, modules);
  if (!aiProvider.available) return rules;

  const ready = modules.filter((m) => m.ready);
  const ai = meterAi(aiProvider, { stage: 'preprocess', onCall: onAiCall });
  try {
    const { json: reply } = await ai.complete({
      purpose: '모듈 자동 추천',
      effort: 'low',
      maxTokens: 2000,
      json: true,
      system: '너는 웹 애플리케이션 보안 점검을 설계하는 엔지니어다. 프로젝트 환경을 보고 실행할 검사 모듈을 고른다.',
      prompt: [
        '[프로젝트]',
        `언어: ${profile.languages.join(', ') || '알 수 없음'}`,
        `프레임워크: ${profile.frameworks.join(', ') || '없음'}`,
        `패키지 매니저: ${profile.packageManagers.join(', ') || '없음'}`,
        `대표 파일: ${profile.markers.join(', ') || '없음'}`,
        '',
        '[실행 가능한 모듈]',
        ...ready.map((m) => `- ${m.id}: ${m.name} — ${m.description} (분류 ${m.category}, 적용 조건 ${m.applies.applies ? '충족' : '불충족'})`),
        '',
        `이 프로젝트에 의미 있는 모듈만 고르고, ${langName(lang)} 한두 문장으로 근거를 써라.`,
        '근거에는 프로젝트를 어떻게 판단했는지와 어떤 모듈을 왜 켜는지를 담는다.',
        '형식: {"selected": ["모듈 id"], "reasoning": "근거"}',
      ].join('\n'),
    });
    const json = /** @type {any} */ (reply);
    const ids = new Set(ready.map((m) => m.id));
    const selected = Array.isArray(json?.selected) ? json.selected.filter((id) => ids.has(id)) : [];
    if (!selected.length || typeof json.reasoning !== 'string') throw new Error('추천 형식이 올바르지 않습니다');
    return { source: 'ai', selected, reasoning: json.reasoning.trim() };
  } catch (err) {
    return { ...rules, note: `AI 추천에 실패해 규칙으로 골랐습니다 (${err.message})` };
  }
}

function recommendByRules(profile, modules) {
  const chosen = modules.filter((m) => m.ready && m.applies.applies);
  const missing = modules.filter((m) => !m.ready && m.applies.applies);
  const stack = [...profile.frameworks, ...profile.languages].slice(0, 4);
  const project = stack.length ? `${stack.join(' · ')} 기반 프로젝트` : '구성을 알 수 없는 프로젝트';
  const reasons = chosen.map((m) => `${m.name}(${m.applies.matched.length ? `${m.applies.matched[0]} 발견` : '모든 프로젝트 대상'})`);
  const sentences = [
    `이 프로젝트는 ${project}로 판단됩니다.`,
    chosen.length ? `${reasons.join(', ')} 모듈을 켭니다.` : '켤 수 있는 모듈이 없습니다.',
  ];
  if (missing.length) sentences.push(`도구가 설치되어 있지 않아 제외한 모듈: ${missing.map((m) => m.name).join(', ')}.`);
  return {
    source: 'rules',
    selected: chosen.map((m) => m.id),
    reasoning: sentences.join(' '),
    // 화면이 언어별로 같은 근거를 다시 쓸 수 있게 판단 재료를 함께 보냅니다.
    basis: {
      stack,
      chosen: chosen.map((m) => ({ id: m.id, matched: m.applies.matched })),
      missing: missing.map((m) => m.id),
    },
  };
}

// ───────────────────────────── 수정안 (patch) ─────────────────────────────

export const PATCH_OPTIONS = {
  stability: { label: '안정성 최우선', instruction: '동작이 바뀌지 않도록 가장 보수적으로 고친다.' },
  performance: { label: '성능 최우선', instruction: '수정으로 성능이 떨어지지 않게 하고, 가능하면 더 가볍게 만든다.' },
  keepStructure: { label: '기존 코드 구조 유지', instruction: '함수 · 변수 이름과 파일 구조를 그대로 두고 필요한 줄만 바꾼다.' },
  comments: { label: '주석 상세히 작성', instruction: '바뀐 부분마다 왜 바꿨는지 한국어 주석을 단다.' },
};

export const MAX_FILE_BYTES = 60_000;
const STRING_LITERAL = /(['"`])((?:\\.|(?!\1)[^\\\n])*)\1/g;
const LEFTOVER_MASK = /__SAFESCAN_SECRET_\d+/;

/**
 * 비밀 값 모듈의 이슈가 가리키는 줄의 문자열을 자리 표시자로 바꿉니다. 원문은 AI 로 보내지 않습니다.
 * @param {string} text
 * @param {number[]} lines 1부터 시작하는 줄 번호
 */
export function maskLines(text, lines) {
  const masks = new Map();
  const targets = new Set(lines);
  const out = text.split('\n').map((line, i) => {
    if (!targets.has(i + 1)) return line;
    return line.replace(STRING_LITERAL, (whole, quote, body) => {
      if (!body) return whole;
      const token = `__SAFESCAN_SECRET_${masks.size + 1}__`;
      masks.set(token, body);
      return `${quote}${token}${quote}`;
    });
  });
  return { text: out.join('\n'), masks };
}

export function unmask(text, masks) {
  let out = text;
  for (const [token, value] of masks) out = out.replaceAll(token, value);
  return out;
}

/**
 * @typedef {object} PreparedFile
 * @property {string} file       프로젝트 기준 경로
 * @property {string} original   파일 원문 (적용 직전 이 내용과 같은지 다시 확인)
 * @property {string} text       AI 에게 보여 줄 내용 (줄바꿈 LF, 비밀 값은 자리 표시자)
 * @property {Map<string, string>} masks
 * @property {string} eol        원문 줄바꿈
 */

/**
 * AI 에게 보낼 파일을 준비합니다. 비밀 값 줄은 가리고 줄바꿈은 LF 로 맞춥니다.
 * @returns {PreparedFile}
 */
export function prepareFile(file, original, secretLines = []) {
  if (Buffer.byteLength(original) > MAX_FILE_BYTES) throw new Error(`파일이 너무 큽니다 (${Math.round(MAX_FILE_BYTES / 1000)}KB 까지)`);
  const { text, masks } = maskLines(original.replaceAll('\r\n', '\n'), secretLines);
  return { file, original, text, masks, eol: original.includes('\r\n') ? '\r\n' : '\n' };
}

/** AI 가 고친 내용(가린 상태)을 원래 비밀 값 · 줄바꿈으로 되돌립니다. */
export function finalizeProposal(prepared, editedText) {
  const restored = unmask(editedText.replaceAll('\r\n', '\n'), prepared.masks);
  if (LEFTOVER_MASK.test(restored)) throw new Error('가려 둔 비밀 값 표시(__SAFESCAN_SECRET_n__)가 깨졌습니다. 표시는 그대로 두거나 줄째 바꾸세요');
  const proposed = restored.replaceAll('\n', prepared.eol);
  if (proposed === prepared.original) throw new Error('바뀐 내용이 없습니다');
  return proposed;
}

/**
 * old_text → new_text 편집을 차례로 적용합니다. old_text 는 정확히 한 곳에만 있어야 합니다.
 * @param {string} text
 * @param {Array<{ old_text: string, new_text: string }>} edits
 */
export function applyEdits(text, edits) {
  if (!Array.isArray(edits) || !edits.length) throw new Error('edits 가 비어 있습니다');
  let out = text;
  edits.forEach((edit, i) => {
    if (typeof edit?.old_text !== 'string' || !edit.old_text || typeof edit.new_text !== 'string') {
      throw new Error(`edits[${i}] 에는 old_text(비어 있지 않음) 와 new_text 가 필요합니다`);
    }
    const oldText = edit.old_text.replaceAll('\r\n', '\n');
    const count = out.split(oldText).length - 1;
    if (count === 0) throw new Error(`edits[${i}].old_text 를 파일에서 찾을 수 없습니다. get_job 이 준 내용과 글자 하나까지 같아야 합니다`);
    if (count > 1) throw new Error(`edits[${i}].old_text 가 ${count}곳에 있습니다. 앞뒤 줄을 더 넣어 한 곳만 가리키게 하세요`);
    out = out.replace(oldText, () => edit.new_text.replaceAll('\r\n', '\n'));
  });
  return out;
}

/** 수정안 요청에 들어갈 사용자 지시 */
export function optionInstructions(options) {
  return options.length ? options.map((key) => `- ${PATCH_OPTIONS[key].label}: ${PATCH_OPTIONS[key].instruction}`) : ['- 특별한 지시 없음'];
}

/**
 * API 키로 직접 수정안을 만듭니다 (Claude 세션 연결이 없을 때).
 * @param {object} p
 * @param {import('../sdk/types.js').Issue} p.issue
 * @param {PreparedFile} p.prepared
 * @param {string[]} p.options       PATCH_OPTIONS 키
 * @param {import('../core/ai.js').AiProvider} p.aiProvider
 * @param {(record: import('../sdk/types.js').AiCallRecord) => void} p.onAiCall
 * @param {string} [p.lang]  설명 언어 (화면 언어)
 */
export async function proposePatch({ issue, prepared, options, aiProvider, onAiCall, lang = 'ko' }) {
  const { file, text: masked, masks } = prepared;
  const finding = issue.findings[0];

  const ai = meterAi(aiProvider, { stage: 'postprocess', onCall: onAiCall });
  const { json: reply, model, costUsd } = await ai.complete({
    purpose: '수정안 생성',
    effort: 'medium',
    json: true,
    system: '너는 웹 애플리케이션 보안 엔지니어다. 주어진 취약점만 고치는 가장 작은 수정안을 만든다. 요청과 관계없는 코드는 바꾸지 않는다.',
    prompt: [
      '[취약점]',
      `제목: ${issue.title}`,
      `규칙: ${finding.ruleId} (${issue.moduleId})`,
      `위험도: ${issue.severity}`,
      finding.description ? `설명: ${finding.description}` : '',
      finding.remediation ? `권장 조치: ${finding.remediation}` : '',
      `위치: ${issue.findings.map((f) => `${f.location?.file}:${f.location?.startLine ?? '?'}`).join(', ')}`,
      '',
      '[사용자 지시]',
      ...optionInstructions(options),
      masks.size ? '- __SAFESCAN_SECRET_n__ 은 가려 둔 비밀 값이다. 원래 값을 짐작하지 말고, 고칠 줄은 환경 변수 등으로 바꾸고 나머지는 그대로 둔다.' : '',
      '',
      `[파일: ${file}]`,
      '```',
      masked,
      '```',
      '',
      `형식: {"explanation": "무엇을 왜 바꿨는지 ${langName(lang)} 2~3문장", "content": "수정된 파일 전체"}`,
    ].filter((line) => line !== '').join('\n'),
  });

  const json = /** @type {any} */ (reply);
  if (typeof json?.content !== 'string' || typeof json?.explanation !== 'string') throw new Error('AI 응답 형식이 올바르지 않습니다');
  return { proposed: finalizeProposal(prepared, json.content), explanation: json.explanation.trim(), model, costUsd };
}
