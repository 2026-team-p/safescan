// AI 공급자 + 계측. 모듈은 ctx.ai 만 쓰고, 토큰 · 비용 · 시간 기록은 여기서 자동으로 남깁니다.
//
// 환경 변수
//   SAFESCAN_AI_PROVIDER  anthropic | mock | none   (생략 시 ANTHROPIC_API_KEY 가 있으면 anthropic)
//   SAFESCAN_AI_MODEL     기본 claude-opus-5-5

export const DEFAULT_MODEL = 'claude-opus-5-5';

/** USD / 100만 토큰. 공식 가격표가 바뀌면 여기만 고칩니다. 캐시 할인은 반영하지 않은 추정치입니다. */
const PRICING = {
  'claude-fable-5-1': { input: 10, output: 50 },
  'claude-opus-5-5': { input: 4, output: 20 },
  'claude-sonnet-5-5': { input: 2, output: 10 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5 },
};

export function estimateCostUsd(model, inputTokens, outputTokens) {
  const price = PRICING[model];
  if (!price) return 0;
  return (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
}

/**
 * @typedef {object} ProviderReply
 * @property {string} text
 * @property {string} model        실제로 응답한 모델 (fallback 이 일어나면 바뀜)
 * @property {{ inputTokens: number, outputTokens: number }} usage
 * @property {string} [stopReason]
 * @property {string} [refusalCategory]
 *
 * @typedef {object} AiProvider
 * @property {string} name
 * @property {boolean} available
 * @property {string|null} model
 * @property {(req: import('../sdk/types.js').AiRequest, signal?: AbortSignal) => Promise<ProviderReply>} complete
 */

/**
 * @param {{ provider?: string, model?: string, mockReply?: (req: import('../sdk/types.js').AiRequest) => string }} [opts]
 * @returns {AiProvider}
 */
export function createAiProvider({ provider, model, mockReply } = {}) {
  const name = provider ?? process.env.SAFESCAN_AI_PROVIDER ?? (process.env.ANTHROPIC_API_KEY ? 'anthropic' : 'none');
  switch (name) {
    case 'anthropic':
      return anthropicProvider(model ?? process.env.SAFESCAN_AI_MODEL ?? DEFAULT_MODEL);
    case 'mock':
      return mockProvider(model ?? 'mock', mockReply);
    case 'none':
      return {
        name: 'none',
        available: false,
        model: null,
        async complete() {
          throw new Error('AI 가 설정되지 않았습니다. ANTHROPIC_API_KEY 또는 SAFESCAN_AI_PROVIDER 를 설정하세요');
        },
      };
    default:
      throw new Error(`알 수 없는 AI 공급자: ${name} (anthropic | mock | none)`);
  }
}

function anthropicProvider(model) {
  let clientPromise;
  const getClient = () => {
    clientPromise ??= import('@anthropic-ai/sdk').then(({ default: Anthropic }) => new Anthropic());
    return clientPromise;
  };
  return {
    name: 'anthropic',
    available: true,
    model,
    async complete(req, signal) {
      const client = await getClient();
      const res = await client.beta.messages.create({
        model,
        max_tokens: req.maxTokens ?? 16000,
        ...(req.system ? { system: req.system } : {}),
        output_config: { effort: req.effort ?? 'medium' },
        messages: [{ role: 'user', content: req.prompt }],
        // 보안 분석 요청은 안전 분류기에 걸릴 수 있어, 거절 시 서버가 권장 모델로 다시 실행하게 합니다.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
      }, { signal });
      const usage = res.usage;
      return {
        text: res.content.filter((b) => b.type === 'text').map((b) => b.text).join(''),
        model: res.model,
        usage: {
          inputTokens: usage.input_tokens + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0),
          outputTokens: usage.output_tokens,
        },
        stopReason: res.stop_reason,
        refusalCategory: res.stop_details?.category ?? undefined,
      };
    },
  };
}

/**
 * 테스트 · 오프라인 개발용. 토큰은 글자 수 / 4 로 어림합니다.
 * @param {string} model
 * @param {(req: import('../sdk/types.js').AiRequest) => string} [mockReply]
 * @returns {AiProvider}
 */
function mockProvider(model, mockReply = () => '{}') {
  return {
    name: 'mock',
    available: true,
    model,
    async complete(req) {
      const text = mockReply(req);
      return {
        text,
        model,
        usage: { inputTokens: Math.ceil(req.prompt.length / 4), outputTokens: Math.ceil(text.length / 4) },
        stopReason: 'end_turn',
      };
    },
  };
}

const JSON_INSTRUCTION = '반드시 JSON 값 하나만 출력하세요. 설명 · 코드 블록 표시 없이 JSON 만 출력합니다.';

/**
 * 단계별 ctx.ai 를 만듭니다. 호출마다 onCall 로 기록이 나갑니다 (거절 · 파싱 실패여도 비용은 기록).
 * @param {AiProvider} provider
 * @param {{ stage: import('../sdk/types.js').Stage, signal?: AbortSignal,
 *           onCall: (record: import('../sdk/types.js').AiCallRecord) => void }} opts
 * @returns {import('../sdk/types.js').AiClient}
 */
export function meterAi(provider, { stage, signal, onCall }) {
  return Object.freeze({
    available: provider.available,
    provider: provider.name,
    model: provider.model,
    async complete(req) {
      if (typeof req?.prompt !== 'string' || !req.prompt) throw new TypeError('ctx.ai.complete: prompt 가 필요합니다');
      const prompt = req.json ? `${req.prompt}\n\n${JSON_INSTRUCTION}` : req.prompt;
      const started = performance.now();
      const reply = await provider.complete({ ...req, prompt }, signal);
      const durationMs = Math.round(performance.now() - started);
      const costUsd = estimateCostUsd(reply.model, reply.usage.inputTokens, reply.usage.outputTokens);
      onCall({
        stage,
        provider: provider.name,
        model: reply.model,
        purpose: req.purpose,
        inputTokens: reply.usage.inputTokens,
        outputTokens: reply.usage.outputTokens,
        costUsd,
        durationMs,
      });
      if (reply.stopReason === 'refusal') {
        throw new Error(`AI 가 요청을 거절했습니다 (분류: ${reply.refusalCategory ?? '없음'})`);
      }
      /** @type {import('../sdk/types.js').AiResponse} */
      const response = { text: reply.text, model: reply.model, usage: reply.usage, costUsd, durationMs };
      if (req.json) response.json = parseJsonReply(reply.text);
      return response;
    },
  });
}

export function parseJsonReply(text) {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.search(/[[{]/);
    const end = Math.max(trimmed.lastIndexOf('}'), trimmed.lastIndexOf(']'));
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch { /* 아래에서 에러 */ }
    }
    throw new Error(`AI 응답을 JSON 으로 읽을 수 없습니다: ${trimmed.slice(0, 120)}`);
  }
}
