import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import legacy from '@vitejs/plugin-legacy';

export default defineConfig({
  plugins: [
    react(),
    // Smart-TV browsers are often years old (Chromium 53 to 80). This adds a second, older build that only those
    // browsers download, with the missing JavaScript features filled in. Current browsers never load it.
    legacy({ targets: ['chrome >= 53', 'safari >= 10', 'firefox >= 52', 'edge >= 16'], renderLegacyChunks: true })
  ],
  build: {
    // Pages load on demand. The one large piece left is the live-TV video
    // library (hls.js, about 500 kB), which is only fetched when Live TV opens.
    chunkSizeWarningLimit: 650,
    // Turn modern CSS (inset, logical properties, ...) into what older browsers understand.
    cssTarget: 'chrome61',
    rollupOptions: { output: { manualChunks: { hls: ['hls.js'] } } }
  },
  server: {
    port: 3001,
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: true }
    }
  }
});
