import { defineModule } from 'safescan/sdk';

export default defineModule({
  preprocess() { return {}; },
  tool() { return {}; },
  postprocess() {
    return [
      { ruleId: 'bad', title: '등급 오류', severity: 'urgent', confidence: 2 },
      { ruleId: 'abs', title: '절대 경로', severity: 'low', confidence: 0.5, location: { file: 'C:/x/app.js' } },
      { ruleId: 'good', title: '정상', severity: 'medium', confidence: 0.6, location: { file: 'src/app.js' } },
    ];
  },
});
