import { expect, test } from '@playwright/test';

import {
  capsuleMenu,
  currentDestination,
  expectSettingsSection,
  goTo,
  mainNavigation,
  openCapsule,
} from './display';

/**
 * The floating capsule at the top of every screen (8.2): its pages, its ☰
 * menu wired to the app's existing actions, the device health, and the
 * "Keep the menu open while playing" setting.
 */

test('the capsule goes to every main screen', async ({ page }) => {
  await page.goto('/#rig');
  await expect(mainNavigation(page)).toBeVisible();
  for (const name of [
    'Library',
    'Levels',
    'Guitars',
    'Settings',
    'Rig',
  ] as const) {
    await goTo(page, name);
    await expect.poll(() => currentDestination(page)).toBe(name);
  }
});

test('the ☰ menu opens the existing settings and power confirmations', async ({
  page,
}) => {
  await page.goto('/#library');
  await capsuleMenu(page, /Display mode/);
  await expectSettingsSection(page, 'Display');
  const keep = page.getByRole('switch', {
    name: 'Keep the menu open while playing',
  });
  await expect(keep).not.toBeChecked();
  await keep.click();
  await page.reload();
  await expect(
    page.getByRole('switch', { name: 'Keep the menu open while playing' }),
  ).toBeChecked();

  await capsuleMenu(page, /Restart device/);
  const confirm = page.getByRole('dialog', { name: 'Restart device?' });
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(confirm).toBeHidden();
  await expectSettingsSection(page, 'Device');

  await capsuleMenu(page, /About/);
  await expectSettingsSection(page, 'About');
});

test('the device health stays in reach in the capsule', async ({ page }) => {
  await page.goto('/#library');
  const health = page.getByRole('complementary', {
    name: 'DSP and system resources',
  });
  await expect(health).toHaveAttribute('data-connected', 'true');
  await openCapsule(page);
  await health.getByRole('button', { name: /device health/ }).click();
  await expect(
    page.getByRole('dialog', { name: 'Device health' }),
  ).toBeVisible();
});
