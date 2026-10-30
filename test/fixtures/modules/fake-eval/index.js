import { defineModule } from 'safescan/sdk';

// 도구 역할을 하는 node 스크립트: 받은 파일에서 eval( 이 있는 줄을 JSON 으로 출력
const SCRIPT = String.raw`
const fs = require('fs');
const hits = [];
for (const file of process.argv.slice(1)) {
  fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach((line, i) => {
    if (line.includes('eval(')) hits.push({ file, line: i + 1, snippet: line.trim() });
  });
}
console.log(JSON.stringify(hits));
`;

export default defineModule({
  async preprocess(ctx) {
    const files = await ctx.project.findFiles({ exts: ['.js'] });
    if (!files.length) ctx.skip('JS 파일이 없습니다');
    return { files };
  },
  async tool(ctx, { files }) {
    const { stdout } = await ctx.exec(process.execPath, ['-e', SCRIPT, ...files], { quiet: true });
    return JSON.parse(stdout);
  },
  postprocess(ctx, hits) {
    return hits.map((h) => ({
      ruleId: 'fake.eval', title: 'eval 사용', severity: 'critical', confidence: 0.9,
      location: { file: h.file, startLine: h.line, snippet: h.snippet },
      remediation: 'eval 대신 JSON.parse 등 안전한 함수를 쓰세요',
    }));
  },
});
