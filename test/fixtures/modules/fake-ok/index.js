import { defineModule } from 'safescan/sdk';

export default defineModule({
  async preprocess(ctx) {
    const files = await ctx.project.findFiles({ exts: ['.js'] });
    return { files };
  },
  async tool(ctx, { files }) {
    const script = 'console.log(JSON.stringify({ hits: [{ file: process.argv[1], line: 3 }] }))';
    const { stdout } = await ctx.exec(process.execPath, ['-e', script, files[0]]);
    return JSON.parse(stdout);
  },
  async postprocess(ctx, raw) {
    const ai = await ctx.ai.complete({ prompt: '분류해 줘', purpose: '설명 보강', json: true });
    const finding = {
      ruleId: 'fake.xss', title: `가짜 ${ai.json.label} ${ctx.options.label}`, severity: 'high', confidence: 0.8,
      location: { file: raw.hits[0].file, startLine: raw.hits[0].line },
    };
    return [finding, { ...finding }, { ...finding, ruleId: 'fake.low', severity: 'low', confidence: 0.5 }];
  },
  verify(ctx, { findings }) {
    return { checks: [{ name: '중복 제거', passed: findings.length === 2 }], confidence: 0.75 };
  },
});
