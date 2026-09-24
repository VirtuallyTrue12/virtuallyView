import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    // Pages load on demand. The one large piece left is the live-TV video
    // library (hls.js, about 500 kB), which is only fetched when Live TV opens.
    chunkSizeWarningLimit: 650,
    rollupOptions: { output: { manualChunks: { hls: ['hls.js'] } } }
  },
  server: {
    port: 3001,
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: true }
    }
  }
});
