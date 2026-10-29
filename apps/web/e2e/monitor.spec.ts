import { setDisplayMode } from './display';
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdir, readFile } from 'node:fs/promises';
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

test('monitor shows device history after browser reload and exports retained samples', async ({
  page,
  request,
}) => {
  await expect
    .poll(
      async () => {
        const response = await request.get('/api/v1/monitor/history');
        expect(response.ok()).toBe(true);
        return (await response.json()).records.length;
      },
      { timeout: 10000 },
    )
    .toBeGreaterThan(0);
  const initial = await (await request.get('/api/v1/monitor/history')).json();
  await page.goto('/');
  await page.getByRole('button', { name: 'Monitor', exact: true }).click();
  await page.getByText('Device history', { exact: true }).click();
  await expect(
    page.getByRole('figure', { name: 'Recorded DSP and CPU · %' }),
  ).toBeVisible();
  await page.getByLabel('History range', { exact: true }).selectOption('5');
  await page
    .getByLabel('History metric', { exact: true })
    .selectOption('memory');
  await expect(
    page.getByRole('figure', { name: 'Recorded RAM · %' }),
  ).toBeVisible();
  await page
    .getByLabel('History metric', { exact: true })
    .selectOption('xruns');
  await expect(
    page.getByRole('figure', { name: 'Recorded New xruns per sample · count' }),
  ).toBeVisible();
  const csvPending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export shown CSV' }).click();
  const csvDownload = await csvPending;
  expect(csvDownload.suggestedFilename()).toBe('oxidal-monitor-shown.csv');
  const csv = await readFile((await csvDownload.path())!, 'utf8');
  expect(csv).toContain(
    'recorded_at_utc,recorder_session,audio_session,elapsed_ms',
  );
  expect(csv).toContain('xruns_total');
  expect(csv.split('\r\n').length).toBeGreaterThan(2);
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
  const download = await request.get('/api/v1/monitor/history/export');
  expect(download.headers()['content-disposition']).toContain(
    'monitor-history.json',
  );
  const exported = await download.json();
  expect(exported.records).toEqual(
    expect.arrayContaining([initial.records[0]]),
  );
  await page.getByRole('button', { name: 'Reset view', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: 'Monitor', exact: true }).click();
  await page.getByText('Device history', { exact: true }).click();
  await expect(
    page.getByRole('figure', { name: 'Recorded DSP and CPU · %' }),
  ).toBeVisible();
  const restored = await (await request.get('/api/v1/monitor/history')).json();
  expect(restored.records).toEqual(
    expect.arrayContaining([initial.records[0]]),
  );
  const portrait = page.viewportSize()!;
  for (const size of [
    portrait,
    { width: portrait.height, height: portrait.width },
  ]) {
    await page.setViewportSize(size);
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      )
      .toBe(true);
  }
});

test('monitor shows redacted control audit with filters and reload persistence', async ({
  page,
  request,
}, info) => {
  await request.post('/api/v1/device/network?password=PRIVATE_QUERY', {
    data: { password: 'PRIVATE_BODY' },
  });
  await expect
    .poll(async () => {
      const history = await (await request.get('/api/v1/audit')).json();
      return history.records.some(
        (r: { operation: string }) => r.operation === 'network',
      );
    })
    .toBe(true);
  await page.goto('/');
  await page.getByRole('button', { name: 'Monitor', exact: true }).click();
  await page.getByText('Control audit', { exact: true }).click();
  const panel = page.getByRole('region', { name: 'Control request history' });
  await expect(panel.getByText(/Accepted means/)).toBeVisible();
  await panel.getByLabel('Operation', { exact: true }).selectOption('network');
  await panel.getByLabel('Outcome', { exact: true }).selectOption('rejected');
  await expect(
    panel.getByRole('list', { name: 'Audit entries' }),
  ).toContainText('Wi-Fi / device');
  await panel.getByLabel('From', { exact: true }).fill('2099-01-01T00:00');
  await expect(panel.getByText('No matching requests.')).toBeVisible();
  await panel.getByLabel('From', { exact: true }).fill('');
  await panel.getByLabel('Outcome', { exact: true }).selectOption('accepted');
  await expect(panel.getByText('No matching requests.')).toBeVisible();
  await panel.getByLabel('Outcome', { exact: true }).selectOption('all');
  const download = await request.get('/api/v1/audit/export');
  expect(download.headers()['content-disposition']).toContain(
    'control-audit.json',
  );
  expect(await download.text()).not.toContain('PRIVATE');
  const portrait = page.viewportSize()!;
  for (const size of [
    portrait,
    { width: portrait.height, height: portrait.width },
  ]) {
    await page.setViewportSize(size);
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      )
      .toBe(true);
  }
  await page.setViewportSize(portrait);
  await panel.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: info.outputPath('control-audit.png'),
    fullPage: true,
  });
  await page.reload();
  await page.getByRole('button', { name: 'Monitor', exact: true }).click();
  await page.getByText('Control audit', { exact: true }).click();
  await expect(page.getByRole('list', { name: 'Audit entries' })).toContainText(
    'Wi-Fi / device',
  );
});
