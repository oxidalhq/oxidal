import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { storybookTest } from '@storybook/addon-vitest/vitest-plugin';
import { playwright } from '@vitest/browser-playwright';

const storybook = fileURLToPath(new URL('./.storybook', import.meta.url));

/**
 * Two test projects:
 * - `unit`: behaviour tests in jsdom (`src/**\/*.test.ts(x)`).
 * - `storybook`: every story rendered in real Chromium; its play function
 *   (if any) runs as an interaction test and axe checks it (a11y: 'error').
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  test: {
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
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          environment: 'jsdom',
          include: ['src/**/*.test.{ts,tsx}'],
          setupFiles: ['./src/test-setup.ts'],
          // A busy machine (a Pi, or Storybook running beside the tests) can take more than 5 s.
          testTimeout: 15000,
        },
      },
      {
        extends: true,
        plugins: [storybookTest({ configDir: storybook })],
        test: {
          name: 'storybook',
          // Long flows (save a version, learn MIDI) need room when the machine is busy.
          testTimeout: 30000,
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            // Every story twice: a laptop, and the narrowest screen the owner
            // plays from (Galaxy Z Fold 4 cover screen, 344 × 882 CSS px).
            instances: [
              {
                browser: 'chromium',
                name: 'laptop',
                viewport: { width: 1280, height: 800 },
              },
              {
                browser: 'chromium',
                name: 'fold-cover',
                viewport: { width: 344, height: 882 },
              },
            ],
          },
          setupFiles: ['./.storybook/vitest.setup.ts'],
        },
      },
    ],
  },
});
