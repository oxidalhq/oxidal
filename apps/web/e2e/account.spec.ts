import AxeBuilder from '@axe-core/playwright';
import { test, expect } from '@playwright/test';
import { setDisplayMode } from './display';
import type { AccountState } from '../src/api';

test('TONE3000 account rejects secret keys before any sign-in request', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Connections', exact: true }).click();
  const panel = page.getByRole('region', { name: 'TONE3000 account' });
  await expect(panel.getByRole('status')).toHaveText('Not connected');
  await panel
    .getByLabel('Publishable API key')
    .fill('t3k_cs_not-a-real-secret');
  await expect(
    panel.getByRole('button', { name: 'Connect TONE3000' }),
  ).toBeDisabled();
  await expect(panel.getByRole('alert')).toContainText(
    'Use the publishable key',
  );
});

// UI contract fixture. The actual device grant, persistence and refresh are tested
// against a local HTTP provider in Rust; these screenshots are not real sign-in evidence.
test('TONE3000 account offers code sign-in and preserves it through rotation', async ({
  page,
}, info) => {
  let state: AccountState = {
    session: 'ui-fixture',
    revision: 0,
    phase: 'disconnected',
    client_id: null,
    user_code: null,
    verification_uri: null,
    expires_at: null,
    error: null,
  };
  let authorized = false;
  await page.route('**/api/v1/account/tone3000', async (route) => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON() as {
        action: { kind: string; client_id?: string };
      };
      if (body.action.kind === 'connect') {
        state = {
          ...state,
          revision: state.revision + 1,
          phase: 'waiting',
          client_id: body.action.client_id ?? null,
          user_code: 'ABCD-EFGH',
          verification_uri: 'https://www.tone3000.com/activate',
          expires_at: Math.floor(Date.now() / 1000) + 600,
        };
      } else {
        state = {
          ...state,
          revision: state.revision + 1,
          phase: 'disconnected',
          user_code: null,
          verification_uri: null,
          expires_at: null,
        };
        authorized = false;
      }
    } else if (authorized && state.phase === 'waiting') {
      state = {
        ...state,
        revision: state.revision + 1,
        phase: 'connected',
        user_code: null,
        verification_uri: null,
        expires_at: null,
      };
    }
    await route.fulfill({ json: state });
  });
  await page.goto('/');
  if (info.project.name === 'boox-air3c') await setDisplayMode(page, 'epaper');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Connections', exact: true }).click();
  const panel = page.getByRole('region', { name: 'TONE3000 account' });
  await panel.getByLabel('Publishable API key').fill('fixture-publishable');
  await panel.getByRole('button', { name: 'Connect TONE3000' }).click();
  await expect(panel.getByLabel('Sign-in code')).toHaveText('ABCD-EFGH');
  await expect(
    panel.getByRole('link', { name: 'Open TONE3000 sign-in' }),
  ).toHaveAttribute('href', 'https://www.tone3000.com/activate');
  const original = page.viewportSize()!;
  for (const [orientation, viewport] of [
    ['portrait', original],
    ['landscape', { width: original.height, height: original.width }],
  ] as const) {
    await page.setViewportSize(viewport);
    await panel.scrollIntoViewIfNeeded();
    await expect(panel.getByLabel('Sign-in code')).toBeVisible();
    for (const button of await panel.locator('button,a').all()) {
      const box = await button.boundingBox();
      if (box) {
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
        expect(box.height).toBeGreaterThanOrEqual(40);
      }
    }
    const accessibility = await new AxeBuilder({ page })
      .include('section[aria-labelledby="tone3000-account-heading"]')
      .withRules(['color-contrast'])
      .analyze();
    expect(accessibility.violations).toEqual([]);
    await panel.screenshot({
      path: info.outputPath(`account-${orientation}.png`),
    });
  }
  await panel.getByRole('button', { name: 'Cancel sign-in' }).click();
  await expect(panel.getByRole('status')).toHaveText('Not connected');
  await panel.getByRole('button', { name: 'Connect TONE3000' }).click();
  await expect(panel.getByLabel('Sign-in code')).toBeVisible();
  authorized = true;
  await expect(panel.getByRole('status')).toHaveText('Account connected');
  await expect(panel.getByLabel('Sign-in code')).toHaveCount(0);
  await panel.getByRole('button', { name: 'Disconnect TONE3000' }).click();
  await expect(panel.getByRole('status')).toHaveText('Not connected');
});
