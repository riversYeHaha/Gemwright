import { defineConfig } from 'vite';

/**
 * 纯静态单页：`base: './'` 让产物可以直接丢到任意静态托管（GitHub Pages / OSS / 本地文件服务器）。
 * 游戏没有后端，两个 AI API 由浏览器直连（CORS 已实测通过），详见 docs/珍宝猎人-方案v8-MVP.md。
 */
export default defineConfig({
  base: './',
  // three 是动态 import 的（viewer chunk）。预打包它，避免首次进验货页时
  // Vite 才发现新依赖 -> 重新优化 -> 整页刷新，把正在飞的动态 import 打断
  // （表现为 "Failed to fetch dynamically imported module: .../viewer.ts"）。
  optimizeDeps: {
    include: [
      'three',
      'three/examples/jsm/controls/OrbitControls.js',
      'three/examples/jsm/loaders/GLTFLoader.js',
    ],
  },
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
    warmup: {
      clientFiles: ['./src/render/viewer.ts'],
    },
  },
});
