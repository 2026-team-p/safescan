// 프로젝트별 설정(<프로젝트>/.safescan/settings.json). 지금은 모듈 옵션만 담습니다.
// 화면에서 고른 값이 CLI · Claude(run_scan) · 수정 후 재검사에도 똑같이 쓰이도록 한곳에 둡니다.
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { sanitizeOptions } from './schema.js';

const FILE = 'settings.json';

/**
 * @typedef {{ options: Record<string, Record<string, import('../sdk/types.js').OptionValue>> }} Settings
 * @returns {Promise<Settings>}
 */
export async function loadSettings(storeDir) {
  try {
    const data = JSON.parse(await readFile(join(storeDir, FILE), 'utf8'));
    return { options: data?.options && typeof data.options === 'object' ? data.options : {} };
  } catch {
    return { options: {} };
  }
}

/** @param {Settings} settings */
export async function saveSettings(storeDir, settings) {
  await mkdir(storeDir, { recursive: true });
  const tmp = join(storeDir, `${FILE}.${process.pid}.tmp`);
  await writeFile(tmp, JSON.stringify(settings, null, 2) + '\n');
  await rename(tmp, join(storeDir, FILE));
}

/**
 * 모듈 하나의 옵션에서 기본값과 같은 값은 빼고 저장할 값만 남깁니다 (모듈이 기본값을 바꾸면 그대로 따라가도록).
 * @param {import('../sdk/types.js').ModuleManifest} manifest
 */
export function compactOptions(manifest, options) {
  const specs = manifest.options ?? {};
  return Object.fromEntries(Object.entries(options).filter(([key, value]) => !sameValue(value, specs[key]?.default)));
}

/**
 * 실행할 모듈마다 쓸 옵션: 저장된 값 위에 이번 요청 값(화면 · CLI -o)을 덮습니다. 오래되어 맞지 않는 저장 값은 버립니다.
 * @param {import('./registry.js').ModuleEntry[]} entries
 * @param {Settings['options']} saved
 * @param {Record<string, Record<string, any>>} [overrides]
 */
export function optionsFor(entries, saved, overrides = {}) {
  return Object.fromEntries(entries.map((e) => [e.id, { ...sanitizeOptions(e.manifest, saved[e.id]).options, ...(overrides[e.id] ?? {}) }]));
}

const sameValue = (a, b) => JSON.stringify(a) === JSON.stringify(b);
