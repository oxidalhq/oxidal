import { test, expect } from '@playwright/test';
import type { NetworkState, NetworkCommand } from '../src/api';

// Browser recovery workflow with a controlled transport. The Rust suite exercises
// durable rollback; physical Wi-Fi switching is an additional hardware gate.
test('network setup reviews link loss, clears credentials and confirms recovery', async ({
  page,
}) => {
  const state: NetworkState = {
    available: true,
    wireless_enabled: true,
    policy: null,
    interfaces: [
      {
        name: 'wlan0',
        kind: 'wifi',
        state: 'connected',
        connection: 'oxidal-hotspot',
      },
    ],
    networks: [
      { ssid: 'Studio: Wi-Fi', security: 'WPA2', signal: 75, active: false },
    ],
    saved: [],
    pending: null,
    message: 'Network ready',
  };
  const commands: NetworkCommand[] = [];
  await page.route('**/api/v1/device/network', async (route) => {
    if (route.request().method() === 'POST') {
      const command = route.request().postDataJSON() as NetworkCommand;
      commands.push(command);
      if (command.type === 'policy') state.policy = command.settings;
      if (command.type === 'join' || command.type === 'policy')
        state.pending = {
          transaction: 'a'.repeat(32),
          seconds_remaining: 89,
          phase: 'awaiting_confirmation',
        };
      if (command.type === 'confirm') {
        state.pending = null;
        state.message = 'Network settings saved';
      }
    }
    await route.fulfill({ json: state });
  });
  await page.goto('/');
  await expect(page.getByText('Device connected')).toBeVisible();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const panel = page.getByRole('region', { name: 'Wi-Fi and hotspot' });
  await panel.getByRole('button', { name: /Studio: Wi-Fi/ }).click();
  await panel
    .getByLabel('Wi-Fi password', { exact: true })
    .fill('test-only-password');
  await panel.getByRole('button', { name: 'Review network change' }).click();
  expect(commands.filter((c) => c.type === 'join')).toHaveLength(0);
  await expect(panel.getByText(/The phone may disconnect/)).toBeVisible();
  await panel.getByRole('button', { name: 'Apply network change' }).click();
  expect(commands.find((c) => c.type === 'join')).toMatchObject({
    ssid: 'Studio: Wi-Fi',
    interface: 'wlan0',
  });
  await expect(panel.getByText(/Network change pending/)).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await panel.getByRole('button', { name: 'Keep this connection' }).click();
  await expect(panel.getByRole('status')).toHaveText('Network settings saved');
  await expect(panel.getByLabel('Wi-Fi password', { exact: true })).toHaveValue(
    '',
  );
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(
    'test-only-password',
  );
  await panel
    .getByRole('button', { name: 'Edit hotspot', exact: true })
    .click();
  await expect(panel.getByLabel('New hotspot password')).toBeVisible();
  await panel.getByText('Automatic hotspot', { exact: true }).click();
  await panel
    .getByRole('combobox', { name: 'Start hotspot', exact: true })
    .selectOption('not_at_home');
  await panel.getByLabel('Home Wi-Fi name').fill('Studio: Wi-Fi');
  await panel.getByRole('button', { name: 'Review hotspot policy' }).click();
  expect(commands.filter((c) => c.type === 'policy')).toHaveLength(0);
  await panel.getByRole('button', { name: 'Apply hotspot policy' }).click();
  await panel.getByRole('button', { name: 'Keep this connection' }).click();
  expect(commands.find((c) => c.type === 'policy')).toMatchObject({
    settings: { mode: 'not_at_home', home_ssid: 'Studio: Wi-Fi' },
  });
  await panel.getByText('System power', { exact: true }).click();
  await panel
    .getByRole('button', { name: 'Reboot device', exact: true })
    .click();
  expect(commands.filter((c) => c.type === 'power')).toHaveLength(0);
  await panel
    .getByRole('button', { name: 'Confirm reboot', exact: true })
    .click();
  expect(commands.find((c) => c.type === 'power')).toEqual({
    type: 'power',
    action: 'reboot',
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
