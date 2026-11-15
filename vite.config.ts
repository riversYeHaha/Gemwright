import { defineConfig } from 'vite';

/**
 * 纯静态单页：`base: './'` 让产物可以直接丢到任意静态托管（GitHub Pages / OSS / 本地文件服务器）。
 * 游戏没有后端，两个 AI API 由浏览器直连（CORS 已实测通过），详见 docs/珍宝猎人-方案v8-MVP.md。
 */
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    outDir: 'dist',
    sourcemap: true,
    // three.js 已拆成独立 viewer chunk（按需加载），650KB 是这个 chunk 的预期体积。
    chunkSizeWarningLimit: 700,
  },
  server: {
    port: 5173,
    host: '127.0.0.1',
  },
});
