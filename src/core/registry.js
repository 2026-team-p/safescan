// 모듈 찾기 · 불러오기 · 새 모듈 만들기.
// modules/ 아래 폴더를 자동으로 찾으므로, 모듈을 추가할 때 중앙 등록 파일을 고칠 필요가 없습니다.
import { cp, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CATEGORIES } from '../sdk/index.js';
import { validateManifest } from './schema.js';

export const PACKAGE_ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const MODULES_DIR = join(PACKAGE_ROOT, 'modules');
export const TEMPLATE_DIR = join(MODULES_DIR, '_template');

/**
 * @typedef {object} ModuleEntry
 * @property {string} id         폴더 이름
 * @property {string} dir        절대 경로
 * @property {import('../sdk/types.js').ModuleManifest} manifest
 * @property {string[]} errors   매니페스트 에러 (비어 있으면 정상)
 */

/**
 * 매니페스트만 읽습니다 (코드는 실행 시점에 불러옴). '_' 나 '.' 로 시작하는 폴더는 건너뜁니다.
 * @param {string} [modulesDir]
 * @returns {Promise<ModuleEntry[]>}
 */
export async function discoverModules(modulesDir = MODULES_DIR) {
  const dirents = await readdir(modulesDir, { withFileTypes: true });
  const entries = [];
  for (const d of dirents) {
    if (!d.isDirectory() || d.name.startsWith('_') || d.name.startsWith('.')) continue;
    const dir = join(modulesDir, d.name);
    let manifest = /** @type {any} */ ({ id: d.name });
    let errors;
    try {
      manifest = JSON.parse(await readFile(join(dir, 'module.json'), 'utf8'));
      errors = validateManifest(manifest, d.name);
    } catch (err) {
      errors = [`module.json 을 읽을 수 없습니다: ${err.message}`];
    }
    entries.push({ id: d.name, dir, manifest, errors });
  }
  return entries.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * index.js 의 default export 를 불러와 형태를 확인합니다.
 * @param {ModuleEntry} entry
 * @returns {Promise<import('../sdk/types.js').ModuleDefinition>}
 */
export async function loadModule(entry) {
  if (entry.errors.length) throw new Error(`module.json 이 올바르지 않습니다: ${entry.errors.join('; ')}`);
  const mod = await import(pathToFileURL(join(entry.dir, 'index.js')).href);
  const def = mod.default;
  for (const key of ['preprocess', 'tool', 'postprocess']) {
    if (typeof def?.[key] !== 'function') {
      throw new Error(`index.js 의 default export 에 '${key}' 함수가 없습니다 (defineModule 로 감싸세요)`);
    }
  }
  return def;
}

const TEXT_FILES = ['module.json', 'index.js', 'README.md', 'fixtures/expected.json'];

/**
 * _template 을 복사해 새 모듈을 만듭니다.
 * @param {{ id: string, name?: string, category?: string, modulesDir?: string }} opts
 * @returns {Promise<string>} 만든 폴더 경로
 */
export async function scaffoldModule({ id, name = id, category = 'other', modulesDir = MODULES_DIR }) {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id)) throw new Error(`id 는 kebab-case 여야 합니다: ${id}`);
  if (!CATEGORIES.includes(category)) throw new Error(`category 는 ${CATEGORIES.join(' | ')} 중 하나여야 합니다`);
  const target = join(modulesDir, id);
  if (await exists(target)) throw new Error(`이미 있는 모듈입니다: ${id}`);

  await cp(TEMPLATE_DIR, target, { recursive: true });
  for (const rel of TEXT_FILES) {
    const path = join(target, rel);
    const text = await readFile(path, 'utf8');
    await writeFile(path, text
      .replaceAll('__MODULE_ID__', id)
      .replaceAll('__MODULE_NAME__', name)
      .replaceAll('__CATEGORY__', category));
  }
  return target;
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
