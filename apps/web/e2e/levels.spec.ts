import { expect, test } from '@playwright/test';

test('level actions stay above a long chart on desktop and phone', async ({
  page,
}, info) => {
  const entries = Array.from({ length: 40 }, (_, i) => ({
    key: `preset-${i}`,
    name: `Preset ${i + 1}`,
    lufs: -20,
    offset_db: 0,
  }));
  await page.route('**/api/v1/calibration', (route) =>
    route.fulfill({
      json: {
        target_lufs: -20,
        entries,
        progress: { running: false, done: 40, total: 40, measured: 40 },
      },
    }),
  );
  await page.route('**/api/v1/calibration/coverage', (route) =>
    route.fulfill({
      json: { total: 40, measured: 40, stale: 0, unmeasured: 0 },
    }),
  );
  for (const width of [1280, 393]) {
    await page.setViewportSize({ width, height: 852 });
    await page.goto('/#levels/loudness');
    const section = page.getByRole('region', { name: 'Even out all' });
    const chart = section.getByRole('figure', {
      name: 'Loudness after correction',
    });
    await expect(chart).toBeVisible();
    const top = (await chart.boundingBox())!.y;
    for (const name of [/^Show each sound/, 'Measure all again', 'Reset']) {
      const button = section.getByRole('button', { name, exact: true });
      const box = (await button.boundingBox())!;
      expect(box.y + box.height).toBeLessThan(top);
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    // What the button opens appears right under it, in view.
    await section.getByRole('button', { name: /^Show each sound/ }).click();
    const table = section.getByRole('table', { name: 'Measured levels' });
    await expect(table).toBeInViewport();
    await page.screenshot({ path: info.outputPath(`levels-${width}.png`) });
    await section.getByRole('button', { name: 'Hide each sound' }).click();
  }
});
