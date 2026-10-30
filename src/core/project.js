// 검사 대상 프로젝트 읽기: 파일 찾기, 환경 분석(profile), 모듈 적용 여부 판단
import { readdir, readFile, stat } from 'node:fs/promises';
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path';

const IGNORE_DIRS = new Set([
  'node_modules', '.git', '.hg', '.svn', '.safescan', 'dist', 'build', 'out', '.next', '.nuxt',
  'coverage', 'vendor', '.venv', 'venv', '__pycache__', 'target', '.gradle', '.idea', '.vscode',
]);

const MARKERS = [
  'package.json', 'package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lock', 'bun.lockb',
  'tsconfig.json', 'requirements.txt', 'pyproject.toml', 'Pipfile', 'poetry.lock', 'pom.xml', 'build.gradle',
  'build.gradle.kts', 'go.mod', 'Gemfile', 'composer.json', 'Cargo.toml', 'Dockerfile', 'docker-compose.yml',
  'docker-compose.yaml', '.env',
];

const PACKAGE_MANAGERS = {
  'package-lock.json': 'npm', 'npm-shrinkwrap.json': 'npm', 'yarn.lock': 'yarn', 'pnpm-lock.yaml': 'pnpm',
  'bun.lock': 'bun', 'bun.lockb': 'bun', 'requirements.txt': 'pip', Pipfile: 'pipenv', 'poetry.lock': 'poetry',
  'pom.xml': 'maven', 'build.gradle': 'gradle', 'build.gradle.kts': 'gradle', 'go.mod': 'go', Gemfile: 'bundler',
  'composer.json': 'composer', 'Cargo.toml': 'cargo',
};

const LANGUAGES = {
  '.js': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript', '.jsx': 'javascript', '.ts': 'typescript',
  '.tsx': 'typescript', '.py': 'python', '.java': 'java', '.kt': 'kotlin', '.go': 'go', '.rb': 'ruby',
  '.php': 'php', '.cs': 'csharp', '.rs': 'rust',
};

const JS_FRAMEWORKS = {
  react: 'react', next: 'next', vue: 'vue', nuxt: 'nuxt', svelte: 'svelte', '@angular/core': 'angular',
  express: 'express', fastify: 'fastify', koa: 'koa', '@nestjs/core': 'nestjs', hono: 'hono',
};
const PY_FRAMEWORKS = ['django', 'flask', 'fastapi'];

const toPosix = (p) => p.split(sep).join('/');

export const IGNORE_FILE = '.safescanignore';

/**
 * .safescanignore 를 읽습니다. 한 줄에 패턴 하나, # 은 주석.
 *   build-cache/        이름이 같은 폴더 · 파일을 어디서든 제외
 *   *.min.js            * 는 / 를 넘지 않음, ** 는 넘음
 *   test/fixtures/      / 가 들어 있거나 / 로 시작하면 프로젝트 루트 기준
 * @param {string} root
 */
export async function loadIgnore(root) {
  const patterns = (await readText(join(root, IGNORE_FILE)))
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
  return { patterns, isIgnored: compileIgnore(patterns) };
}

/** @param {string[]} patterns @returns {(relPath: string) => boolean} */
export function compileIgnore(patterns) {
  const regexes = patterns.map((pattern) => {
    const body = pattern.replace(/^\.?\//, '').replace(/\/$/, '');
    const anchored = pattern.startsWith('/') || body.includes('/');
    const source = body
      .split(/(\*\*\/|\*\*|\*|\?)/)
      .map((tok) => ({ '**/': '(?:.*/)?', '**': '.*', '*': '[^/]*', '?': '[^/]' })[tok]
        ?? tok.replace(/[.+^${}()|[\]\\]/g, '\\$&'))
      .join('');
    // 패턴에 맞는 폴더면 그 아래 전부를 제외합니다.
    return new RegExp(`${anchored ? '^' : '(?:^|/)'}${source}(?:/|$)`);
  });
  return (relPath) => regexes.some((re) => re.test(relPath));
}

/**
 * node_modules · .git 등과 .safescanignore 에 맞는 경로를 빼고 파일을 찾습니다.
 * names 와 exts 를 둘 다 주면 어느 한쪽만 맞아도 포함.
 * @param {string} root
 * @param {import('../sdk/types.js').FindFilesQuery} [query]
 * @param {(relPath: string) => boolean} [isIgnored]
 * @returns {Promise<string[]>} root 기준 상대 경로 (/ 구분)
 */
export async function findFiles(root, { names, exts, maxDepth = 8, limit = 5000 } = {}, isIgnored = () => false) {
  const nameSet = names ? new Set(names) : null;
  const extSet = exts ? new Set(exts.map((e) => e.toLowerCase())) : null;
  const out = [];

  async function walk(dir, depth) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (out.length >= limit) return;
      const abs = join(dir, entry.name);
      const rel = toPosix(relative(root, abs));
      // 심볼릭 링크는 따라가지 않습니다 (무한 루프 · 프로젝트 밖 접근 방지)
      if (entry.isDirectory()) {
        if (!IGNORE_DIRS.has(entry.name) && depth < maxDepth && !isIgnored(rel)) await walk(abs, depth + 1);
      } else if (entry.isFile()) {
        const matched = (!nameSet && !extSet)
          || nameSet?.has(entry.name)
          || extSet?.has(extname(entry.name).toLowerCase());
        if (matched && !isIgnored(rel)) out.push(rel);
      }
    }
  }

  await walk(root, 0);
  return out;
}

/**
 * 프로젝트 환경을 훑습니다. profile 은 저장 · UI · AI 추천용, index 는 appliesTo 판단용,
 * isIgnored 는 createProjectApi 에 넘겨 모듈의 파일 찾기에도 같은 제외 규칙을 씁니다.
 * @param {string} root
 */
export async function scanProject(root) {
  const { patterns, isIgnored } = await loadIgnore(root);
  const files = await findFiles(root, { maxDepth: 4, limit: 20000 }, isIgnored);
  const basenames = new Set(files.map((f) => f.slice(f.lastIndexOf('/') + 1)));
  const exts = new Set(files.map((f) => extname(f).toLowerCase()).filter(Boolean));

  const markers = MARKERS.filter((m) => basenames.has(m));
  const languages = [...new Set([...exts].map((e) => LANGUAGES[e]).filter(Boolean))].sort();
  const packageManagers = [...new Set(markers.map((m) => PACKAGE_MANAGERS[m]).filter(Boolean))].sort();
  const frameworks = await detectFrameworks(root);

  /** @type {import('../sdk/types.js').ProjectProfile} */
  const profile = { root, markers, languages, frameworks, packageManagers, ignore: patterns };
  return { profile, index: { basenames, exts }, isIgnored };
}

async function detectFrameworks(root) {
  const found = new Set();
  const pkg = await readJson(join(root, 'package.json'));
  if (pkg) {
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    for (const [dep, name] of Object.entries(JS_FRAMEWORKS)) if (dep in deps) found.add(name);
  }
  const requirements = await readText(join(root, 'requirements.txt'));
  const pyproject = await readText(join(root, 'pyproject.toml'));
  for (const name of PY_FRAMEWORKS) {
    const re = new RegExp(`^\\s*"?${name}\\b`, 'im');
    if (re.test(requirements) || re.test(pyproject)) found.add(name);
  }
  if (/spring-boot/.test(await readText(join(root, 'pom.xml')))) found.add('spring');
  return [...found].sort();
}

/**
 * manifest.appliesWhen 을 프로젝트에 대어 봅니다.
 * @param {import('../sdk/types.js').ModuleManifest} manifest
 * @param {{ basenames: Set<string>, exts: Set<string> }} index
 * @returns {{ applies: boolean, matched: string[] }}
 */
export function appliesTo(manifest, index) {
  const patterns = manifest.appliesWhen?.files;
  if (!patterns?.length) return { applies: true, matched: [] };
  const matched = patterns.filter((p) => (p.startsWith('*.') ? index.exts.has(p.slice(1).toLowerCase()) : index.basenames.has(p)));
  return { applies: matched.length > 0, matched };
}

/**
 * 모듈에 넘기는 읽기 전용 프로젝트 API (ctx.project)
 * @param {string} root
 * @param {import('../sdk/types.js').ProjectProfile} profile
 * @param {(relPath: string) => boolean} [isIgnored]
 * @returns {import('../sdk/types.js').ProjectApi}
 */
export function createProjectApi(root, profile, isIgnored) {
  const resolveInside = (relPath) => {
    const abs = resolve(root, relPath);
    const rel = relative(root, abs);
    if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error(`프로젝트 밖 경로는 쓸 수 없습니다: ${relPath}`);
    return abs;
  };
  return Object.freeze({
    root,
    profile,
    resolve: resolveInside,
    async exists(relPath) {
      try {
        await stat(resolveInside(relPath));
        return true;
      } catch {
        return false;
      }
    },
    readText: (relPath) => readFile(resolveInside(relPath), 'utf8'),
    findFiles: (query) => findFiles(root, query, isIgnored),
  });
}

async function readText(path) {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return '';
  }
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return null;
  }
}
