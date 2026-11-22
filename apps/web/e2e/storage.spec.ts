import { expect, test } from '@playwright/test';

import type { NetworkCommand, StorageState } from '../src/api';

// Controlled HTTP transport only. These checks never change a real filesystem or power state.
for (const target of ['locked', 'unlocked'] as const)
  test(`storage protection queues ${target} and rechecks network safety before confirmed restart`, async ({
    page,
  }) => {
    const targetLabel = target === 'locked' ? 'Locked' : 'Unlocked';
    const before = target === 'locked' ? 'unlocked' : 'locked';
    const beforeLabel = before === 'locked' ? 'Locked' : 'Unlocked';
    let state: StorageState = {
      available: true,
      current: before,
      next_boot: before,
      reboot_required: false,
      message: '',
    };
    let pending = false;
    const choices: string[] = [];
    const power: NetworkCommand[] = [];
    await page.route('**/api/v1/device/storage', async (route) => {
      if (route.request().method() === 'POST') {
        const { mode } = route.request().postDataJSON() as {
          mode: 'locked' | 'unlocked';
        };
        choices.push(mode);
        state = {
          ...state,
          next_boot: mode,
          reboot_required: mode !== state.current,
          message: 'Storage mode changes at the next restart',
        };
      }
      await route.fulfill({ json: state });
    });
    await page.route('**/api/v1/device/network', async (route) => {
      if (route.request().method() === 'POST')
        power.push(route.request().postDataJSON() as NetworkCommand);
      await route.fulfill({
        json: {
          available: true,
          capabilities: {
            schema_version: 1,
            saved_connect: true,
            guarded_power: true,
          },
          wireless_enabled: true,
          message: '',
          interfaces: [],
          networks: [],
          saved: [],
          pending: pending
            ? {
                transaction: 'c'.repeat(32),
                seconds_remaining: 80,
                phase: 'connecting',
              }
            : null,
        },
      });
    });
    await page.goto('/#settings/maintenance');
    const storage = page.getByRole('region', {
      name: 'Storage lock',
      exact: true,
    });
    await expect(
      storage.getByText(`${beforeLabel} now`, { exact: true }),
    ).toBeVisible();
    await storage
      .getByRole('button', { name: new RegExp('^' + targetLabel) })
      .click();
    await expect(
      storage.getByText(`Next boot: ${targetLabel}.`, { exact: true }),
    ).toBeVisible();
    await expect(
      storage.getByText(`${beforeLabel} now`, { exact: true }),
    ).toBeVisible();
    expect(choices).toEqual([target]);
    expect(power).toEqual([]);
    await page.reload();
    await expect(
      storage.getByText(`Next boot: ${targetLabel}.`, { exact: true }),
    ).toBeVisible();
    await expect(
      storage.getByText(`${beforeLabel} now`, { exact: true }),
    ).toBeVisible();
    await storage
      .getByRole('button', { name: `Restart into ${targetLabel} mode…` })
      .click();
    const review = page.getByRole('dialog', {
      name: `Restart into ${targetLabel} mode?`,
    });
    await review.getByRole('button', { name: 'Cancel', exact: true }).click();
    expect(power).toEqual([]);
    await storage
      .getByRole('button', { name: `Restart into ${targetLabel} mode…` })
      .click();
    pending = true;
    await review.getByRole('button', { name: 'Confirm restart' }).click();
    await expect(review.getByRole('alert')).toContainText(
      'Finish the pending network change',
    );
    expect(power).toEqual([]);
    pending = false;
    await review.getByRole('button', { name: 'Confirm restart' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(
      storage.getByRole('status').filter({ hasText: 'Restart requested' }),
    ).toContainText('Restart requested');
    expect(power).toEqual([{ type: 'restart_storage', expected_mode: target }]);
    state = { ...state, current: target, reboot_required: false };
    await page.reload();
    await expect(
      storage.getByText(`${targetLabel} now`, { exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });

test('maintenance opens the Songbook JSON restore review', async ({ page }) => {
  // An existing library on a shared test server must survive this workflow.
  await page.route(/\/api\/v1\/media\/sheets(\?.*)?$/, (route) =>
    route.fulfill({ json: { registry_revision: '', sheets: [] } }),
  );
  await page.route('**/api/v1/media/sheets/links', (route) =>
    route.fulfill({ json: { registry_revision: '', links: [] } }),
  );
  await page.goto('/#settings/maintenance');
  await expect(
    page.getByRole('link', { name: 'Download backup' }),
  ).toHaveAttribute('href', '/api/v1/backup/library');
  await page.getByRole('link', { name: 'Open Songbook' }).click();
  await expect(page).toHaveURL(/#library\/songbook$/);
  const chooseFile = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Restore Songbook backup…' }).click();
  await (
    await chooseFile
  ).setFiles({
    name: 'chord-sheets.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ schema: 1, sheets: [], links: [] })),
  });
  const review = page.getByRole('dialog', { name: 'Restore Songbook backup?' });
  await expect(review).toContainText('0 songs and 0 links');
  await review.getByRole('button', { name: 'Close dialog' }).click();
  await expect(review).toHaveCount(0);
});
