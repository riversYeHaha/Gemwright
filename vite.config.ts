import { defineConfig } from 'vite';

/**
 * 纯静态单页：`base: './'` 让产物可以直接丢到任意静态托管（GitHub Pages / OSS / 本地文件服务器）。
 * DeepSeek 由浏览器直连；Lux3D 在 dev 下经 Vite 同源代理（见 server.proxy），
 * 避免浏览器被 Lux3D 错误响应的 CORS 头缺失卡住；生产构建仍走官方端点。
 */
export default defineConfig({
  base: './',
  // three 由验货 viewer 与开始页缩略图 Worker 按需加载。预打包它，避免首次使用时
  // Vite 才发现新依赖 -> 重新优化 -> 整页刷新，把正在飞的动态 import 打断
  // （表现为 "Failed to fetch dynamically imported module: .../viewer.ts"）。
  optimizeDeps: {
    include: [
      'three',
      'three/examples/jsm/controls/OrbitControls.js',
      'three/examples/jsm/loaders/GLTFLoader.js',
      'three/examples/jsm/environments/RoomEnvironment.js',
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
    proxy: {
      // 国际区必须放在 /lux3d 前面，否则会被国内前缀先匹配。
      '/lux3d-global': {
        target: 'https://api.aholo.ai',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/lux3d-global/, '/global'),
      },
      '/lux3d': {
        target: 'https://api.aholo.cn',
        changeOrigin: true,
      },
    },
  },
});
