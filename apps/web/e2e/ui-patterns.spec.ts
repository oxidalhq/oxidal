import { expect, test } from '@playwright/test';

import { openSounds } from './display';

test('IR discovery keeps its empty state full width and returns keyboard focus', async ({
  page,
}, testInfo) => {
  await page.route('**/api/v1/tone3000/tones?*', (route) =>
    route.fulfill({ json: { data: [], total_pages: 1 } }),
  );
  await page.goto('/#library');
  await expect(
    page.getByRole('complementary', { name: 'DSP and system resources' }),
  ).toHaveAttribute('data-connected', 'true');
  await openSounds(page, 'ir');
  const launch = page
    .getByRole('region', { name: 'IRs library' })
    .getByRole('button', { name: 'TONE3000', exact: true });
  await launch.click();
  const dialog = page.getByRole('dialog', { name: 'Get IRs' });
  // The shared TONE3000 browser: its count, and a plain empty message that
  // runs the full width of the list.
  await expect(dialog.getByRole('status').first()).toContainText(
    '0 from TONE3000',
  );
  const empty = dialog.getByText('Nothing on TONE3000 matches.');
  await expect(empty).toBeVisible();
  const widths = await empty.evaluate((element) => ({
    content: element.parentElement!.getBoundingClientRect().width,
    empty: element.getBoundingClientRect().width,
  }));
  expect(widths.empty).toBeGreaterThanOrEqual(widths.content - 2);
  // The collection and gear filters sit side by side, clear of each other.
  const [collection, gear] = await dialog.getByRole('combobox').all();
  const a = (await collection!.boundingBox())!;
  const b = (await gear!.boundingBox())!;
  expect(b.x >= a.x + a.width || b.y >= a.y + a.height).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath('ir-empty-state.png'),
    fullPage: true,
  });
  await dialog.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(launch).toBeFocused();
});
