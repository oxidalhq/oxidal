import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdir } from 'node:fs/promises';
import type { Monitoring } from '../src/api';
test('monitor shows measured stereo data, freezes, resets and marks stale readings', async ({
  page,
}, info) => {
  let sequence = 1;
  let stale = false;
  let requests = 0;
  const channel = { peak_dbfs: -6, rms_dbfs: -12, clips: 2 };
  await page.route('**/api/v1/monitor', async (route) => {
    requests++;
    const state: Monitoring = {
      sequence: sequence++,
      host: {
        cpu_percent: 23.4,
        memory_used_bytes: 512 * 1048576,
        memory_total_bytes: 4096 * 1048576,
        temperature_c: 48.2,
        temperature_sensor: 'cpu-thermal',
      },
      audio_phase: 'running',
      graph_phase: 'stopped',
      source: 'Saved preset',
      audio_age_ms: stale ? 5000 : 150,
      xruns: null,
      error: null,
      stream: {
        input: {
          endpoint: 'hw:CARD=Test,DEV=0',
          direction: 'capture',
          sample_rate: 48000,
          channels: 2,
          format: 's16',
          period_frames: 128,
          periods: 3,
        },
        output: {
          endpoint: 'hw:CARD=Test,DEV=0',
          direction: 'playback',
          sample_rate: 48000,
          channels: 2,
          format: 's16',
          period_frames: 128,
          periods: 3,
        },
        input_map: [0, 1],
        output_map: [0, 1],
      },
      audio: {
        frames: sequence * 48000,
        input: [channel, { ...channel, clips: 0 }],
        output: [
          { ...channel, peak_dbfs: -3 },
          { ...channel, peak_dbfs: -9 },
        ],
        process_us_p50: 300,
        process_us_p95: 450,
        process_us_max: 620,
        deadline_us: 2666.67,
        invalid_samples: 0,
      },
    };
    await route.fulfill({ json: state });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Monitor', exact: true }).click();
  const panel = page.getByRole('region', {
    name: 'Audio and system monitoring',
  });
  await expect(panel.getByRole('status')).toHaveText('Saved preset · live');
  await expect(
    panel.getByRole('meter', { name: 'Output L peak' }),
  ).toHaveAttribute('aria-valuenow', '-3');
  await expect(panel.getByText('CLIP · 2')).toHaveCount(3);
  await panel.getByRole('button', { name: 'Freeze readings' }).click();
  const count = requests;
  await page.waitForTimeout(1200);
  expect(requests).toBe(count);
  await expect(panel.getByRole('status')).toHaveText('Frozen readings');
  await panel.getByRole('button', { name: 'Reset view' }).click();
  await expect(panel.getByText('CLIP · 2')).toHaveCount(0);
  await panel.getByRole('button', { name: 'Resume readings' }).click();
  for (const mode of ['stage', 'sunlight', 'epaper']) {
    await page.getByLabel('Display mode').selectOption(mode);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    const audit = await new AxeBuilder({ page })
      .include('[aria-label="Audio and system monitoring"]')
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze();
    expect(audit.violations).toEqual([]);
  }
  await page.getByLabel('Display mode').selectOption('stage');
  await mkdir('../../.local/previews/monitor', { recursive: true });
  await page.screenshot({
    path: `../../.local/previews/monitor/${info.project.name}-fixture.png`,
    fullPage: true,
  });
  stale = true;
  await expect(panel.getByRole('status')).toHaveText(
    'Saved preset · waiting for live readings',
  );
  await expect(
    panel.getByRole('meter', { name: 'Output L peak' }),
  ).not.toHaveAttribute('aria-valuenow');
});
