import { openSounds } from './display';
import { expect, test } from '@playwright/test';

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
  const launch = page.getByRole('button', { name: 'TONE3000', exact: true });
  await launch.click();
  const dialog = page.getByRole('dialog', { name: 'Get IRs' });
  const empty = dialog.getByRole('status');
  await expect(empty).toContainText('No IRs in the latest feed');
  const widths = await empty.evaluate((element) => ({
    content: element.parentElement!.getBoundingClientRect().width,
    empty: element.getBoundingClientRect().width,
  }));
  expect(widths.empty).toBeGreaterThanOrEqual(widths.content - 2);
  const collection = await dialog.getByRole('combobox').boundingBox();
  const filter = await dialog
    .getByRole('radiogroup', { name: 'Gear type' })
    .boundingBox();
  expect(filter!.y - collection!.y - collection!.height).toBeGreaterThanOrEqual(
    8,
  );
  await page.screenshot({
    path: testInfo.outputPath('ir-empty-state.png'),
    fullPage: true,
  });
  await dialog.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(launch).toBeFocused();
});
