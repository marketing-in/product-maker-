import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': 'http://127.0.0.1:8787' },
    // Saved projects and generations are data, not source: writing them must never reload the page.
    watch: { ignored: ['**/data/**', '**/dist/**'] },
  },
  build: { chunkSizeWarningLimit: 900 },
});
