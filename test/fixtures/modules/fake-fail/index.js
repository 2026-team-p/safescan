import { defineModule } from 'safescan/sdk';

export default defineModule({
  preprocess() { return {}; },
  tool() { throw new Error('도구 고장'); },
  postprocess() { return []; },
});
