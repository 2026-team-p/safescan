// 일부러 취약하게 만든 예제 서버입니다. SafeScan 이 실행하지 않으며, 수동으로 띄울 때만 씁니다.
//   node server.js [포트]     (기본 3999, 127.0.0.1 에만 바인딩)
import { createServer } from 'node:http';

const port = Number(process.argv[2] ?? 3999);

const routes = {
  // 디렉터리 리스팅이 켜진 것처럼 응답 (safescan-dir-listing 이 찾아야 함)
  '/files/': { type: 'text/html', body: '<html><head><title>Index of /files/</title></head><body><h1>Index of /files/</h1><a href="backup.zip">backup.zip</a></body></html>' },
  // 디버그 엔드포인트 노출 (safescan-debug-endpoint 가 찾아야 함)
  '/debug': { type: 'application/json', body: JSON.stringify({ debug: true, env: 'development', stack: 'at app.js:1' }) },
  // 안전한 경로 (오탐 확인용)
  '/': { type: 'text/html', body: '<html><body>hello</body></html>' },
};

createServer((req, res) => {
  const route = routes[req.url.split('?')[0]];
  if (!route) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    return res.end('not found');
  }
  res.writeHead(200, { 'content-type': route.type });
  res.end(route.body);
}).listen(port, '127.0.0.1', () => console.log(`listening on http://127.0.0.1:${port}`));
