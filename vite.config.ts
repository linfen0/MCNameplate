import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // 预览服务器不要缓存 HTML：否则改完代码你还可能跑到旧 bundle
  define: {
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  server: {
    host: '127.0.0.1',
    port: 5273,
  },
  preview: {
    host: '127.0.0.1',
    port: 4173,
    headers: { 'Cache-Control': 'no-store' },
  },
  build: {
    target: 'es2022',
    // 像素资源不需要内联，保持 dist 结构清晰
    assetsInlineLimit: 0,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    reporters: ['default'],
  },
})
