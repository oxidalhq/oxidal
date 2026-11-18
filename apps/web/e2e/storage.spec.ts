import { expect, test } from '@playwright/test';

import type { NetworkCommand, StorageState } from '../src/api';

// Controlled HTTP transport only. These checks never change a real filesystem or power state.
test('storage protection queues the next boot and rechecks network safety before confirmed restart', async ({
  page,
}) => {
  let state: StorageState = {
    available: true,
    current: 'unlocked',
    next_boot: 'unlocked',
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
  await page.goto('/#settings/device');
  const storage = page.getByRole('region', {
    name: 'Storage lock',
    exact: true,
  });
  await expect(
    storage.getByText('Unlocked now', { exact: true }),
  ).toBeVisible();
  await storage.getByRole('button', { name: /^Locked/ }).click();
  await expect(
    storage.getByText('Next boot: Locked.', { exact: true }),
  ).toBeVisible();
  await expect(
    storage.getByText('Unlocked now', { exact: true }),
  ).toBeVisible();
  expect(choices).toEqual(['locked']);
  expect(power).toEqual([]);
  await page.reload();
  await expect(
    storage.getByText('Next boot: Locked.', { exact: true }),
  ).toBeVisible();
  await expect(
    storage.getByText('Unlocked now', { exact: true }),
  ).toBeVisible();
  await storage.getByRole('button', { name: 'Reboot now' }).click();
  const review = page.getByRole('dialog', {
    name: 'Restart into Locked mode?',
  });
  await review.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(power).toEqual([]);
  await storage.getByRole('button', { name: 'Reboot now' }).click();
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
  expect(power).toEqual([{ type: 'power', action: 'reboot' }]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
