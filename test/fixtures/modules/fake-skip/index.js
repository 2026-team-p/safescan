import { defineModule } from 'safescan/sdk';

export default defineModule({
  preprocess(ctx) { ctx.skip('대상 없음'); },
  tool() {},
  postprocess() { return []; },
});
