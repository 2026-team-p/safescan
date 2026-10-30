// safescan run · safescan mcp 가 띄우는 로컬 서버: API + 빌드된 UI(ui/dist) 제공.
// 127.0.0.1 에만 열고, 다른 사이트가 브라우저를 통해 API 를 부르지 못하도록 Host · Origin 을 확인하며,
// 실행할 때마다 바뀌는 접속 토큰이 있어야 API 를 쓸 수 있습니다.
import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { PACKAGE_ROOT } from '../core/registry.js';
import { createApi } from './api.js';
import { HttpError } from './runs.js';

export const UI_DIR = join(PACKAGE_ROOT, 'ui', 'dist');
const MAX_BODY = 1_000_000;
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.woff2': 'font/woff2',
};

/**
 * @param {{ projectRoot: string, port?: number, strictPort?: boolean, modulesDir?: string,
 *           aiProvider?: import('../core/ai.js').AiProvider, uiDir?: string,
 *           claude?: { notify: (job: object) => void } | null, token?: string }} opts
 */
export async function startServer({
  projectRoot, port = 3000, strictPort = false, modulesDir, aiProvider, uiDir = UI_DIR, claude = null,
  token = randomBytes(16).toString('hex'),
}) {
  const { routes, runs, jobs, bridge, setUiUrl } = createApi({ projectRoot, modulesDir, aiProvider, claude });
  let actualPort = port;

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      checkOrigin(req, actualPort);
      if (url.pathname.startsWith('/api/')) {
        checkToken(req, url, token);
        for (const [method, pattern, handler] of routes) {
          const match = pattern.exec(url.pathname);
          if (!match || method !== req.method) continue;
          const body = method === 'POST' ? await readJson(req) : undefined;
          const result = await handler(req, url, body, match.groups ?? {}, res);
          if (result !== undefined) sendJson(res, 200, result);
          return;
        }
        throw new HttpError(404, `없는 API 입니다: ${req.method} ${url.pathname}`);
      }
      if (req.method !== 'GET') throw new HttpError(405, '허용되지 않는 요청입니다');
      await serveStatic(uiDir, url.pathname, res);
    } catch (err) {
      if (res.headersSent) return res.end();
      sendJson(res, err.status ?? 500, { error: err.message, ...(err.aiCalls ? { aiCalls: err.aiCalls } : {}) });
    }
  });

  for (let attempt = 0; ; attempt += 1) {
    try {
      await new Promise((ok, fail) => {
        server.once('error', fail);
        server.listen(actualPort, '127.0.0.1', () => {
          server.off('error', fail);
          ok();
        });
      });
      break;
    } catch (err) {
      if (err.code !== 'EADDRINUSE' || strictPort || attempt >= 10) throw err;
      actualPort += 1;
    }
  }
  actualPort = /** @type {import('node:net').AddressInfo} */ (server.address()).port;
  const url = `http://localhost:${actualPort}`;
  const uiUrl = `${url}/?token=${token}`;
  setUiUrl(uiUrl);

  return {
    url,
    /** 브라우저로 열 주소 (토큰 포함) */
    uiUrl,
    token,
    port: actualPort,
    runs,
    jobs,
    bridge,
    close: () => new Promise((ok) => {
      server.closeAllConnections?.();
      server.close(() => ok());
    }),
  };
}

function checkToken(req, url, token) {
  const given = String(req.headers['x-safescan-token'] ?? url.searchParams.get('token') ?? '');
  const ok = given.length === token.length && timingSafeEqual(Buffer.from(given), Buffer.from(token));
  if (!ok) throw new HttpError(401, '접속 토큰이 없거나 맞지 않습니다. 터미널(또는 Claude)이 알려 준 주소로 다시 여세요');
}

// DNS 리바인딩과 다른 사이트에서 보내는 요청(CSRF)을 막습니다.
function checkOrigin(req, port) {
  const allowedHosts = [`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`];
  if (!allowedHosts.includes(req.headers.host ?? '')) throw new HttpError(403, '허용되지 않은 Host 입니다');
  const origin = req.headers.origin;
  if (req.method !== 'GET' && origin && !allowedHosts.some((h) => origin === `http://${h}`)) {
    throw new HttpError(403, '허용되지 않은 Origin 입니다');
  }
}

async function readJson(req) {
  if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) {
    // 단순 폼 전송(CSRF)으로는 이 API 를 부를 수 없게 JSON 만 받습니다.
    throw new HttpError(415, 'Content-Type 은 application/json 이어야 합니다');
  }
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new HttpError(413, '요청이 너무 큽니다');
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new HttpError(400, 'JSON 을 읽을 수 없습니다');
  }
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function serveStatic(root, pathname, res) {
  const base = resolve(root);
  let file = resolve(base, `.${decodeURIComponent(pathname)}`);
  if (file !== base && !file.startsWith(base + sep)) throw new HttpError(403, '허용되지 않은 경로입니다');
  if (!(await stat(file).catch(() => null))?.isFile()) file = join(base, 'index.html'); // SPA
  let data;
  try {
    data = await readFile(file);
  } catch {
    res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('UI 가 아직 빌드되지 않았습니다. safescan 폴더에서 npm run build:ui 를 실행하세요.');
    return;
  }
  const immutable = file.includes(`${sep}assets${sep}`);
  res.writeHead(200, {
    'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream',
    'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  res.end(data);
}
