import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// 개발: npm run dev:ui (5173) + safescan run (3000). 배포: npm run build:ui → ui/dist 를 safescan run 이 제공
export default defineConfig({
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true },
  server: {
    port: 5173,
    proxy: {
      // 서버는 다른 Origin 의 요청을 막으므로, 개발 프록시는 서버 자신의 Origin 으로 보냅니다.
      '/api': { target: 'http://localhost:3000', changeOrigin: true, headers: { origin: 'http://localhost:3000' } },
    },
  },
});
