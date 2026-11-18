import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

/** Behaviour tests in jsdom. Stories run from `apps/storybook` in real Chromium. */
export default defineConfig({
  plugins: [react()],
  test: {
    name: 'unit',
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test-setup.ts'],
    // A busy machine (a Pi, or Storybook running beside the tests) can take more than 5 s.
    testTimeout: 15000,
    coverage: {
      provider: 'v8',
      include: [
        'src/components/**',
        'src/widgets/**',
        'src/patterns/**',
        'src/lib/**',
      ],
      exclude: [
        '**/*.stories.tsx',
        '**/*.test.{ts,tsx}',
        '**/*.fixtures.ts',
        '**/*.data.ts',
      ],
      reporter: ['text-summary', 'html'],
    },
  },
});
