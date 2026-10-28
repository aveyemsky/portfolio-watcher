import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5175,
    proxy: {
      '/api': 'http://127.0.0.1:5739',
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    root: __dirname,
    include: ['src/test/**/*.test.{js,jsx}'],
    setupFiles: [resolve(__dirname, 'src/test/setup.js')],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
    },
  },
});

