import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    strictPort: true,
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.OXIDAL_DEV_API_ORIGIN ?? 'http://127.0.0.1:3210',
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: 'jsdom',
    // Bound concurrent DOM suites so busy development hosts retain timely input.
    maxWorkers: 4,
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test-setup.ts'],
  },
});
