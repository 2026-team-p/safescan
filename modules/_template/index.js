// __MODULE_NAME__ — 작성 규칙: docs/MODULE_GUIDE.md, 기준 예시: modules/npm-audit/index.js
import { defineModule } from 'safescan/sdk';

export default defineModule({
  // 1) 전처리: 소스에서 도구에 넣을 정보를 모읍니다. 검사할 대상이 없으면 ctx.skip() 으로 끝냅니다.
  async preprocess(ctx) {
    const files = await ctx.project.findFiles({ exts: ['.js', '.ts'] }); // TODO: 대상에 맞게 바꾸세요
    if (!files.length) ctx.skip('검사할 파일이 없습니다');
    ctx.log.info(`대상 파일 ${files.length}개`);
    return { files };
  },

  // 2) 툴: 공개 · 검증된 도구를 ctx.exec 로 실행하고 결과 원본을 그대로 돌려줍니다.
  //    module.json 의 requires 에 도구를 적어 두면 미설치 시 설치 안내와 함께 자동으로 건너뜁니다.
  async tool(ctx, input) {
    // 예) const { stdout } = await ctx.exec('semgrep', ['scan', '--json', '--config', 'p/xss', '.'], { quiet: true });
    //     return JSON.parse(stdout);
    ctx.skip('TODO: 도구를 연결하세요');
  },

  // 3) 후처리: 도구 결과를 Finding[] 으로 바꿉니다. 형식은 src/sdk/types.d.ts 의 Finding 참고.
  async postprocess(ctx, raw, input) {
    return [];
  },

  // 4) 검증(선택): 결과를 스스로 점검합니다. 시간 · 토큰 · 비용은 프레임워크가 자동으로 기록합니다.
  async verify(ctx, { raw, findings }) {
    return { checks: [] };
  },
});
