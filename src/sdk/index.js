// 모듈 작성자가 import 하는 유일한 진입점: import { defineModule } from 'safescan/sdk'
// 계약(타입)은 ./types.d.ts 에 있습니다.

// 모듈에서 타입이 필요하면: /** @type {import('safescan/sdk').Finding} */
/** @typedef {import('./types.js').Stage} Stage */
/** @typedef {import('./types.js').Severity} Severity */
/** @typedef {import('./types.js').Finding} Finding */
/** @typedef {import('./types.js').ModuleContext} ModuleContext */
/** @typedef {import('./types.js').ModuleManifest} ModuleManifest */
/** @typedef {import('./types.js').VerifyReport} VerifyReport */

/** @type {readonly Stage[]} */
export const STAGES = Object.freeze(['preprocess', 'tool', 'postprocess', 'verify']);

/** @type {readonly Severity[]} 위험한 순서 */
export const SEVERITIES = Object.freeze(['critical', 'high', 'medium', 'low']);

export const CATEGORIES = Object.freeze(['sast', 'dast', 'dependency', 'secrets', 'config', 'iac', 'container', 'other']);

export const AI_USAGES = Object.freeze(['none', 'optional', 'required']);

/** OWASP Top 10:2025 */
export const OWASP_2025 = Object.freeze({
  'A01:2025': 'Broken Access Control',
  'A02:2025': 'Security Misconfiguration',
  'A03:2025': 'Software Supply Chain Failures',
  'A04:2025': 'Cryptographic Failures',
  'A05:2025': 'Injection',
  'A06:2025': 'Insecure Design',
  'A07:2025': 'Authentication Failures',
  'A08:2025': 'Software or Data Integrity Failures',
  'A09:2025': 'Security Logging and Alerting Failures',
  'A10:2025': 'Mishandling of Exceptional Conditions',
});

/**
 * 모듈 정의를 감싸 형태를 검사합니다. 에디터에서 ctx 자동완성도 이걸로 받습니다.
 * @template I, R
 * @param {import('./types.js').ModuleDefinition<I, R>} definition
 * @returns {import('./types.js').ModuleDefinition<I, R>}
 */
export function defineModule(definition) {
  if (!definition || typeof definition !== 'object') {
    throw new TypeError('defineModule: 객체를 넘겨야 합니다');
  }
  for (const key of ['preprocess', 'tool', 'postprocess']) {
    if (typeof definition[key] !== 'function') {
      throw new TypeError(`defineModule: '${key}' 함수가 필요합니다`);
    }
  }
  if (definition.verify !== undefined && typeof definition.verify !== 'function') {
    throw new TypeError("defineModule: 'verify' 는 함수이거나 생략해야 합니다");
  }
  return Object.freeze({ ...definition });
}
