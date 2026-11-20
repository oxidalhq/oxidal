import { expect, test } from '@playwright/test';

import type { NetworkCommand, NetworkState } from '../src/api';
import { selectSettingsSection } from './display';

test('network setup exposes current addresses and the public certificate', async ({
  page,
}) => {
  const network: NetworkState = {
    available: true,
    wireless_enabled: true,
    message: '',
    networks: [],
    saved: [],
    interfaces: [
      {
        name: 'eth0',
        kind: 'ethernet',
        state: 'connected',
        connection: 'Wired',
        addresses: ['192.168.5.20'],
      },
    ],
  };
  const fingerprint = Array(32).fill('AB').join(':');
  let installed = false;
  await page.route('**/api/v1/device/network', (route) =>
    route.fulfill({ json: network }),
  );
  await page.route('**/api/v1/device/certificate.json', (route) =>
    route.fulfill(
      installed
        ? {
            json: {
              schema_version: 1,
              file_name: 'oxidal-ca.crt',
              fingerprint_sha256: fingerprint,
              https_download: '/api/v1/device/certificate',
              hotspot_download: '/certificate.crt',
              server_names: ['oxidal.local', '10.42.0.1'],
            },
          }
        : { status: 404, json: { message: 'Not installed' } },
    ),
  );
  await page.goto('/#settings/connections');
  await expect(
    page.getByRole('link', { name: 'https://192.168.5.20' }),
  ).toBeVisible();
  await expect(
    page.getByText('Certificate unavailable', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Download certificate' }),
  ).toHaveCount(0);
  installed = true;
  await page.getByRole('button', { name: 'Retry certificate' }).click();
  const download = page.getByRole('link', { name: 'Download certificate' });
  await expect(download).toHaveAttribute('href', '/api/v1/device/certificate');
  await expect(download).toHaveAttribute('download', 'oxidal-ca.crt');
  await expect(page.getByText(fingerprint, { exact: true })).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'http://10.42.0.1/certificate.crt' }),
  ).toBeVisible();
  await page.getByRole('radio', { name: 'iPhone', exact: true }).click();
  await expect(
    page.getByText(/Certificate Trust Settings and turn on Oxidal/),
  ).toBeVisible();
  await page.getByRole('radio', { name: 'Android', exact: true }).click();
  await expect(
    page.getByText('On an Android phone or tablet, or a BOOX', { exact: true }),
  ).toBeVisible();
});

test('network setup uses explicit open, saved and radio operations with interface-scoped review', async ({
  page,
}) => {
  const first = '11111111-1111-4111-8111-111111111111';
  const second = '22222222-2222-4222-8222-222222222222';
  const state: NetworkState = {
    available: true,
    wireless_enabled: true,
    message: '',
    pending: null,
    policy: { mode: 'no_remembered', interface: 'wlan0', home_ssid: '' },
    radio: { country: 'NZ', channels: [1, 6, 11] },
    hotspot: { ssid: 'Actual recovery AP', channel: 6 },
    capabilities: {
      schema_version: 1,
      saved_connect: true,
      open_join: true,
      hotspot_radio: true,
    },
    interfaces: ['wlan0', 'wlan1'].map((name) => ({
      name,
      kind: 'wifi',
      state: 'disconnected',
      connection: '--',
    })),
    networks: [
      { ssid: 'Venue Guest', security: '--', signal: 50, active: false },
    ],
    saved: [first, second].map((uuid) => ({
      uuid,
      ssid: 'Same name',
      name: 'oxidal-wifi',
      managed: true,
      active: false,
    })),
  };
  const commands: NetworkCommand[] = [];
  await page.route('**/api/v1/device/network', async (route) => {
    if (route.request().method() === 'POST') {
      const command = route.request().postDataJSON() as NetworkCommand;
      commands.push(command);
      if (
        command.type === 'join_open' ||
        command.type === 'connect' ||
        command.type === 'hotspot_radio'
      )
        state.pending = {
          transaction: 'b'.repeat(32),
          seconds_remaining: 87,
          phase:
            command.type === 'join_open'
              ? 'connecting'
              : 'awaiting_confirmation',
        };
      if (command.type === 'confirm' || command.type === 'cancel')
        state.pending = null;
      if (command.type === 'forget')
        state.saved = state.saved.filter(
          (profile) => profile.uuid !== command.uuid,
        );
    }
    await route.fulfill({ json: state });
  });
  await page.goto('/#settings/connections');
  const panel = page.getByRole('region', { name: 'Wi-Fi and hotspot' });
  await expect(
    panel.getByRole('button', { name: 'Join Venue Guest' }),
  ).toBeEnabled();
  await panel.getByRole('combobox', { name: 'Wireless interface' }).click();
  await page.getByRole('option', { name: 'wlan1', exact: true }).click();
  await panel.getByRole('button', { name: 'Join Venue Guest' }).click();
  let review = page.getByRole('dialog');
  await expect(
    review.getByLabel('Wi-Fi password', { exact: true }),
  ).toHaveCount(0);
  await review.getByRole('button', { name: 'Apply network change' }).click();
  await expect(
    page
      .getByRole('dialog')
      .getByRole('button', { name: 'Keep this connection' }),
  ).toBeDisabled();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Go back now' })
    .click();
  expect(commands.find((command) => command.type === 'join_open')).toEqual({
    type: 'join_open',
    interface: 'wlan1',
    ssid: 'Venue Guest',
  });
  await panel.getByText('Saved networks', { exact: true }).click();
  await panel
    .getByRole('button', {
      name: `Connect saved Same name (${second})`,
      exact: true,
    })
    .click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Apply network change' })
    .click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Keep this connection' })
    .click();
  expect(commands.find((command) => command.type === 'connect')).toEqual({
    type: 'connect',
    interface: 'wlan1',
    uuid: second,
  });
  await panel
    .getByRole('button', { name: 'Change…', exact: true })
    .nth(1)
    .click();
  review = page.getByRole('dialog', { name: 'Change country and channel?' });
  await expect(
    review.getByLabel('Wi-Fi password', { exact: true }),
  ).toHaveCount(0);
  await review.getByLabel('Wireless country').fill('AU');
  await review.getByRole('button', { name: 'Apply network change' }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Keep this connection' })
    .click();
  expect(commands.find((command) => command.type === 'hotspot_radio')).toEqual({
    type: 'hotspot_radio',
    interface: 'wlan1',
    country: 'AU',
    channel: 6,
  });
  await expect(
    panel.getByText('Actual recovery AP', { exact: true }),
  ).toBeVisible();
  await panel
    .getByRole('button', {
      name: `Forget saved Same name (${first})`,
      exact: true,
    })
    .click();
  expect(commands.some((command) => command.type === 'forget')).toBe(false);
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Forget network' })
    .click();
  await expect(
    panel.getByRole('button', {
      name: `Forget saved Same name (${first})`,
      exact: true,
    }),
  ).toHaveCount(0);
  expect(commands.find((command) => command.type === 'forget')).toEqual({
    type: 'forget',
    uuid: first,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

// Browser recovery workflow with a controlled transport. The Rust suite exercises
// durable rollback; physical Wi-Fi switching is an additional hardware gate.
test('network setup reviews link loss, clears credentials and confirms recovery', async ({
  page,
}) => {
  const state: NetworkState = {
    available: true,
    wireless_enabled: true,
    capabilities: {
      schema_version: 1,
      saved_connect: true,
      guarded_power: true,
    },
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
  await page.goto('/#rig');
  await expect(
    page.getByRole('complementary', { name: 'DSP and system resources' }),
  ).toHaveAttribute('data-connected', 'true');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await selectSettingsSection(page, 'Network');
  const panel = page.getByRole('region', { name: 'Wi-Fi and hotspot' });
  await expect(
    panel.getByRole('button', { name: /Guest open/ }),
  ).toBeDisabled();
  await expect(panel.getByText('Reading device network…')).toHaveCount(0);
  await expect(
    panel.getByRole('combobox', { name: 'Turn the hotspot on', exact: true }),
  ).toHaveText('When Ethernet is disconnected');
  await panel.getByRole('button', { name: 'Join Studio: Wi-Fi' }).click();
  const review = page.getByRole('dialog', { name: 'Join Studio: Wi-Fi?' });
  await review
    .getByLabel('Wi-Fi password', { exact: true })
    .fill('test-only-password');
  await review
    .getByRole('button', { name: 'Show password', exact: true })
    .click();
  await expect(
    review.getByLabel('Wi-Fi password', { exact: true }),
  ).toHaveAttribute('type', 'text');
  await review
    .getByRole('button', { name: 'Hide password', exact: true })
    .click();
  await expect(
    review.getByLabel('Wi-Fi password', { exact: true }),
  ).toHaveAttribute('type', 'password');
  expect(commands.filter((c) => c.type === 'join')).toHaveLength(0);
  await expect(review.getByText(/Your phone may disconnect/)).toBeVisible();
  await review.getByRole('button', { name: 'Apply network change' }).click();
  expect(commands.find((c) => c.type === 'join')).toMatchObject({
    ssid: 'Studio: Wi-Fi',
    interface: 'wlan0',
  });
  await expect(
    page.getByRole('dialog', { name: 'Keep this connection?' }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole('dialog', { name: 'Keep this connection?' }),
  ).toBeVisible();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Keep this connection' })
    .click();
  await expect(
    panel.getByText('Network settings saved', { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel('Wi-Fi password', { exact: true })).toHaveCount(
    0,
  );
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(
    'test-only-password',
  );
  await panel
    .getByRole('button', { name: 'Change…', exact: true })
    .first()
    .click();
  const hotspot = page.getByRole('dialog', {
    name: 'Change hotspot name and password?',
  });
  await expect(
    hotspot.getByLabel('Wi-Fi password', { exact: true }),
  ).toHaveValue('');
  await expect(hotspot.getByLabel('Hotspot name', { exact: true })).toHaveValue(
    '',
  );
  await expect(hotspot.getByLabel('Wireless country')).toHaveValue('NZ');
  await hotspot.getByRole('combobox', { name: 'Hotspot channel' }).click();
  await page.getByRole('option', { name: '6 · 2.4 GHz' }).click();
  await hotspot.getByRole('button', { name: 'Cancel', exact: true }).click();
  await panel
    .getByRole('combobox', { name: 'Turn the hotspot on', exact: true })
    .click();
  await page
    .getByRole('option', { name: 'When home Wi-Fi is out of range' })
    .click();
  const policy = page.getByRole('dialog', {
    name: 'Change automatic hotspot?',
  });
  await policy.getByLabel('Home Wi-Fi name').fill('Studio: Wi-Fi');
  expect(commands.filter((c) => c.type === 'policy')).toHaveLength(0);
  await policy.getByRole('button', { name: 'Apply network change' }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Keep this connection' })
    .click();
  expect(commands.find((c) => c.type === 'policy')).toMatchObject({
    settings: { mode: 'not_at_home', home_ssid: 'Studio: Wi-Fi' },
  });
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await selectSettingsSection(page, 'Device');
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
