import { defineConfig, devices } from '@playwright/test';

// Reuse the native load/edit/save scenario on each device when explicitly enabled.
const deviceCoverage = {
  testMatch: /(device-layout|presets|monitor|debug|account)\.spec\.ts/,
  grep: /TONE3000 account|rig controls follow|device portrait|folding and unfolding|stage display|touch adjustment|native editor loads|playback lifecycle|monitor shows|asset artwork|interactive terminal/,
};

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 30000,
  expect: { timeout: 7000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL: 'http://127.0.0.1:5173', trace: 'retain-on-failure' },
  projects: [
    {
      name: 'chromium',
      testIgnore: /device-layout\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile',
      testIgnore: /device-layout\.spec\.ts/,
      use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' },
    },
    {
      name: 'iphone-xr',
      ...deviceCoverage,
      use: {
        ...devices['iPhone XR'],
        browserName: 'webkit',
        deviceScaleFactor: 2,
      },
    },
    ...[
      { name: 'fold4-cover', width: 345, height: 883, scale: 2.625 },
      { name: 'fold4-open', width: 690, height: 829, scale: 2.625 },
      { name: 'boox-air3c', width: 930, height: 1240, scale: 2 },
    ].map(({ name, width, height, scale }) => ({
      name,
      ...deviceCoverage,
      use: {
        browserName: 'chromium' as const,
        viewport: { width, height },
        deviceScaleFactor: scale,
        isMobile: true,
        hasTouch: true,
      },
    })),
  ],
  webServer: [
    {
      command: 'node ../../scripts/tooling.mjs e2e-server',
      url: 'http://127.0.0.1:3210/api/v1/health',
      reuseExistingServer: false,
      timeout: 120000,
    },
    {
      command: 'pnpm dev',
      url: 'http://127.0.0.1:5173',
      reuseExistingServer: !process.env.CI,
      timeout: 30000,
    },
  ],
});
