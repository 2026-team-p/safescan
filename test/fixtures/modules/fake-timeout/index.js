import { defineModule } from 'safescan/sdk';

export default defineModule({
  preprocess() { return {}; },
  async tool(ctx) {
    await ctx.exec(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], { timeoutMs: 60000 });
  },
  postprocess() { return []; },
});
