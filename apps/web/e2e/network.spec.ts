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
    policy: { mode: 'no_ethernet', interface: 'wlan0', home_ssid: '' },
    radio: { country: 'NZ', channels: [1, 6, 11] },
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
      { ssid: 'Guest open', security: '--', signal: 80, active: false },
    ],
    saved: [],
    pending: null,
    message: '',
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
  await expect(
    page.getByRole('complementary', { name: 'DSP and system resources' }),
  ).toHaveAttribute('data-connected', 'true');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page
    .getByRole('tablist', { name: 'Settings sections' })
    .getByRole('tab', { name: 'Network', exact: true })
    .click();
  const panel = page.getByRole('region', { name: 'Wi-Fi and hotspot' });
  await expect(
    panel.getByRole('button', { name: /Guest open/ }),
  ).toBeDisabled();
  await expect(panel.getByText('Reading device network…')).toHaveCount(0);
  await panel.getByText('Automatic hotspot', { exact: true }).click();
  await expect(
    panel.getByRole('combobox', { name: 'Start hotspot', exact: true }),
  ).toHaveValue('no_ethernet');
  await panel.getByText('Automatic hotspot', { exact: true }).click();
  await panel.getByRole('button', { name: /Studio: Wi-Fi/ }).click();
  await panel
    .getByLabel('Wi-Fi password', { exact: true })
    .fill('test-only-password');
  await panel
    .getByRole('button', { name: 'Show password', exact: true })
    .click();
  await expect(
    panel.getByLabel('Wi-Fi password', { exact: true }),
  ).toHaveAttribute('type', 'text');
  await panel
    .getByRole('button', { name: 'Hide password', exact: true })
    .click();
  await expect(
    panel.getByLabel('Wi-Fi password', { exact: true }),
  ).toHaveAttribute('type', 'password');
  await panel.getByRole('button', { name: 'Review network change' }).click();
  expect(commands.filter((c) => c.type === 'join')).toHaveLength(0);
  const review = page.getByRole('dialog');
  await expect(review.getByText(/The phone may disconnect/)).toBeVisible();
  await review.getByRole('button', { name: 'Apply network change' }).click();
  expect(commands.find((c) => c.type === 'join')).toMatchObject({
    ssid: 'Studio: Wi-Fi',
    interface: 'wlan0',
  });
  await expect(panel.getByText(/Network change pending/)).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page
    .getByRole('tablist', { name: 'Settings sections' })
    .getByRole('tab', { name: 'Network', exact: true })
    .click();
  await panel.getByRole('button', { name: 'Keep this connection' }).click();
  await expect(panel.getByRole('status')).toHaveText('Network settings saved');
  await expect(panel.getByLabel('Wi-Fi password', { exact: true })).toHaveValue(
    '',
  );
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(
    'test-only-password',
  );
  await panel.getByRole('radio', { name: 'Edit hotspot', exact: true }).click();
  await expect(panel.getByLabel('New hotspot password')).toBeVisible();
  await expect(panel.getByLabel('Hotspot name', { exact: true })).toHaveValue(
    '',
  );
  await expect(panel.getByLabel('Wireless country')).toHaveValue('NZ');
  await panel
    .getByRole('combobox', { name: 'Hotspot channel' })
    .selectOption('6');
  await panel.getByText('Automatic hotspot', { exact: true }).click();
  await panel
    .getByRole('combobox', { name: 'Start hotspot', exact: true })
    .selectOption('not_at_home');
  await panel.getByLabel('Home Wi-Fi name').fill('Studio: Wi-Fi');
  await panel.getByRole('button', { name: 'Review hotspot policy' }).click();
  expect(commands.filter((c) => c.type === 'policy')).toHaveLength(0);
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Apply hotspot policy' })
    .click();
  await panel.getByRole('button', { name: 'Keep this connection' }).click();
  expect(commands.find((c) => c.type === 'policy')).toMatchObject({
    settings: { mode: 'not_at_home', home_ssid: 'Studio: Wi-Fi' },
  });
  await page.getByRole('tab', { name: 'Device', exact: true }).click();
  const power = page.getByRole('region', { name: 'Device power' });
  await power
    .getByRole('button', { name: 'Restart device', exact: true })
    .click();
  expect(commands.filter((c) => c.type === 'power')).toHaveLength(0);
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Confirm restart', exact: true })
    .click();
  await expect
    .poll(() => commands.find((c) => c.type === 'power'))
    .toEqual({
      type: 'power',
      action: 'reboot',
    });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
