import { defineConfig, devices } from '@playwright/test';

// Dedicated ports keep qualification isolated from a running authoring preview.
function port(name: string, fallback: number) {
  const value = process.env[name] ?? String(fallback);
  if (!/^\d+$/.test(value) || Number(value) < 1024 || Number(value) > 65535)
    throw new Error(`${name} must be a port from 1024 to 65535`);
  return Number(value);
}
const apiPort = port('OXIDAL_E2E_API_PORT', 3210);
const webPort = port('OXIDAL_E2E_WEB_PORT', 5173);
if (apiPort === webPort) throw new Error('E2E API and web ports must differ');
const apiOrigin = `http://127.0.0.1:${apiPort}`;
const webOrigin = `http://127.0.0.1:${webPort}`;

// Reuse the native load/edit/save scenario on each device when explicitly enabled.
const deviceCoverage = {
  testMatch:
    /(device-layout|presets|library|monitor|debug|account|network)\.spec\.ts/,
  grep: /library sections|new preset creates|sounds deletes|protect refuses|live model comparison|network setup|mixed rig authoring|graph authoring|TONE3000 account|rig controls follow|device portrait|folding and unfolding|stage display|touch adjustment|native editor loads|playback lifecycle|monitor shows|asset artwork|interactive terminal/,
};

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 30000,
  expect: { timeout: 7000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL: webOrigin, trace: 'retain-on-failure' },
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
      url: `${apiOrigin}/api/v1/health`,
      env: { OXIDAL_ADDR: `127.0.0.1:${apiPort}` },
      reuseExistingServer: false,
      timeout: 120000,
    },
    {
      command: `pnpm dev --port ${webPort}`,
      url: webOrigin,
      env: { OXIDAL_DEV_API_ORIGIN: apiOrigin },
      reuseExistingServer: false,
      timeout: 30000,
    },
  ],
});
