import { setDisplayMode } from './display';
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdir } from 'node:fs/promises';
import type { Monitoring } from '../src/api';
test('monitor shows measured stereo data, freezes, resets and marks stale readings', async ({
  page,
}, info) => {
  test.setTimeout(90000);
  let sequence = 1;
  let stale = false;
  let disconnected = false;
  let mixed = false;
  const channel = { peak_dbfs: -6, rms_dbfs: -12, clips: 2 };
  await page.route('**/api/v1/monitor', async (route) => {
    if (disconnected) return route.abort('failed');
    const state: Monitoring = {
      sequence: sequence++,
      host: {
        cpu_percent: 23.4,
        memory_used_bytes: 512 * 1048576,
        memory_total_bytes: 4096 * 1048576,
        temperature_c: 48.2,
        temperature_sensor: 'cpu-thermal',
      },
      audio_phase: mixed ? 'failed' : 'running',
      graph_phase: 'stopped',
      rig_phase: mixed ? 'running' : 'stopped',
      source: mixed ? 'Mixed rig' : 'Saved preset',
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
  const strip = page.getByRole('complementary', {
    name: 'DSP and system resources',
  });
  await expect(strip.getByTestId('resource-state')).toHaveText('Audio running');
  await expect(strip).toContainText('17%');
  await expect(strip).toContainText('23%');
  await expect(strip).toContainText('0.5/4.0 GiB');
  await expect(
    strip
      .locator('dl > div')
      .filter({ has: page.getByText('Xruns', { exact: true }) })
      .getByRole('definition'),
  ).toHaveText('—');
  await page.getByRole('button', { name: 'Library', exact: true }).click();
  await expect(strip).toBeVisible();
  await strip.getByRole('button', { name: 'Open resource details' }).click();
  const panel = page.getByRole('region', {
    name: 'Audio and system monitoring',
  });
  await expect(panel.getByRole('status')).toHaveText('Saved preset · live');
  mixed = true;
  await expect(panel.getByRole('status')).toHaveText('Mixed rig · live');
  const wrapped = await panel
    .locator('.meter-heading > *')
    .evaluateAll((items) =>
      items.some((item) => {
        const range = document.createRange();
        range.selectNodeContents(item);
        const lines = new Set(
          Array.from(range.getClientRects()).map((r) => Math.round(r.top)),
        );
        return lines.size > 1 || item.scrollWidth > item.clientWidth + 1;
      }),
    );
  expect(wrapped).toBe(false);

  await expect(strip.getByTestId('resource-state')).toHaveText('Audio running');
  await expect(
    panel.getByRole('meter', { name: 'Output L peak' }),
  ).toHaveAttribute('aria-valuenow', '-3');
  await expect(panel.getByText('CLIP · 2')).toHaveCount(3);
  await panel.getByRole('button', { name: 'Freeze readings' }).click();
  // History freezes, but the always-visible strip must keep polling.
  stale = true;
  await expect(strip.getByTestId('resource-state')).toHaveText('Audio stale');
  await expect(strip).not.toContainText('17%');
  await expect(
    panel.getByRole('meter', { name: 'Output L peak' }),
  ).toHaveAttribute('aria-valuenow', '-3');
  stale = false;
  await expect(panel.getByRole('status')).toHaveText('Frozen readings');
  await panel.getByRole('button', { name: 'Reset view' }).click();
  await expect(panel.getByText('CLIP · 2')).toHaveCount(0);
  await panel.getByRole('button', { name: 'Resume readings' }).click();
  for (const mode of ['stage', 'sunlight', 'epaper'] as const) {
    await setDisplayMode(page, mode);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    const audit = await new AxeBuilder({ page })
      .include('[aria-label="Audio and system monitoring"]')
      .include('[aria-label="DSP and system resources"]')
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze();
    expect(audit.violations).toEqual([]);
  }
  if (info.project.name === 'boox-air3c') {
    await setDisplayMode(page, 'epaper');
    // E-paper must distinguish series without colour, in both plot and legend.
    for (const label of ['Output peak · dBFS', 'Processing budget · %']) {
      const chart = page.getByRole('figure', { name: label });
      await expect(chart.locator('path[stroke-dasharray="6 4"]')).toHaveCount(
        1,
      );
      expect(
        await chart
          .locator('figcaption [aria-hidden]')
          .last()
          .evaluate((element) => getComputedStyle(element).borderTopStyle),
      ).toBe('dashed');
    }
    const portrait = page.viewportSize()!;
    for (const viewport of [
      portrait,
      { width: portrait.height, height: portrait.width },
    ]) {
      await page.setViewportSize(viewport);
      await expect(strip).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      expect(
        await strip.evaluate(
          (element) => getComputedStyle(element).animationName,
        ),
      ).toBe('none');
      await page.screenshot({
        path: info.outputPath(`boox-resources-${viewport.width}.png`),
        fullPage: true,
      });
    }
    await page.setViewportSize(portrait);
  }
  await setDisplayMode(page, 'stage');
  await mkdir('../../.local/previews/monitor', { recursive: true });
  await page.screenshot({
    path: `../../.local/previews/monitor/${info.project.name}-fixture.png`,
    fullPage: true,
  });
  stale = true;
  await expect(panel.getByRole('status')).toHaveText(
    'Mixed rig · waiting for live readings',
  );
  await expect(
    panel.getByRole('meter', { name: 'Output L peak' }),
  ).not.toHaveAttribute('aria-valuenow');
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  expect((await strip.boundingBox())!.y).toBeGreaterThanOrEqual(0);
  disconnected = true;
  await expect(strip.getByTestId('resource-state')).toHaveText('Disconnected');
  await expect(strip).not.toContainText('23%');
  await expect(strip).not.toContainText('0.5/4.0 GiB');
});
