import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';

import { NetworkChangeDialog } from './network-change-dialog';

afterEach(cleanup);
const base = {
  interfaces: ['wlan0', 'wlan1'],
  defaultInterface: 'wlan1',
  onCancel: vi.fn(),
};

it('keeps a password draft across readback and clears it before a repeated apply', async () => {
  const onApply = vi.fn();
  const props = {
    ...base,
    draft: { kind: 'join' as const, ssid: 'Studio', secured: true },
    onApply,
  };
  const view = render(<NetworkChangeDialog {...props} />);
  const user = userEvent.setup();
  await user.type(
    screen.getByLabelText('Wi-Fi password', { exact: true }),
    'private-password',
  );
  view.rerender(<NetworkChangeDialog {...props} hotspotName="New readback" />);
  expect(screen.getByLabelText('Wi-Fi password', { exact: true })).toHaveValue(
    'private-password',
  );
  expect(onApply).not.toHaveBeenCalled();
  await user.click(
    screen.getByRole('button', { name: 'Apply network change' }),
  );
  expect(onApply).toHaveBeenCalledExactlyOnceWith({
    type: 'join',
    interface: 'wlan1',
    ssid: 'Studio',
    password: 'private-password',
  });
  expect(screen.getByLabelText('Wi-Fi password', { exact: true })).toHaveValue(
    '',
  );
  expect(
    screen.getByRole('button', { name: 'Apply network change' }),
  ).toBeDisabled();
});

it('sends an explicit open join without a password field', async () => {
  const onApply = vi.fn();
  render(
    <NetworkChangeDialog
      {...base}
      draft={{ kind: 'join', ssid: 'Venue', secured: false }}
      onApply={onApply}
    />,
  );
  expect(
    screen.queryByLabelText('Wi-Fi password', { exact: true }),
  ).not.toBeInTheDocument();
  await userEvent
    .setup()
    .click(screen.getByRole('button', { name: 'Apply network change' }));
  expect(onApply).toHaveBeenCalledExactlyOnceWith({
    type: 'join_open',
    interface: 'wlan1',
    ssid: 'Venue',
  });
});

it('changes radio settings without copying hotspot credentials and blocks stale writes', async () => {
  const onApply = vi.fn();
  const props = {
    ...base,
    draft: { kind: 'radio' as const },
    hotspotName: 'Actual AP',
    hotspotChannel: 6,
    radio: { country: 'NZ', channels: [1, 6, 11] },
    onApply,
  };
  const view = render(<NetworkChangeDialog {...props} disabled />);
  expect(
    screen.queryByLabelText('Wi-Fi password', { exact: true }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByRole('button', { name: 'Apply network change' }),
  ).toBeDisabled();
  view.rerender(<NetworkChangeDialog {...props} />);
  await userEvent
    .setup()
    .click(screen.getByRole('button', { name: 'Apply network change' }));
  expect(onApply).toHaveBeenCalledExactlyOnceWith({
    type: 'hotspot_radio',
    interface: 'wlan1',
    country: 'NZ',
    channel: 6,
  });
});

it('uses saved UUID identity and requires a valid home SSID for home policy', async () => {
  const onApply = vi.fn();
  const view = render(
    <NetworkChangeDialog
      {...base}
      draft={{ kind: 'saved', ssid: 'Same name', uuid: 'second-id' }}
      onApply={onApply}
    />,
  );
  await userEvent
    .setup()
    .click(screen.getByRole('button', { name: 'Apply network change' }));
  expect(onApply).toHaveBeenCalledExactlyOnceWith({
    type: 'connect',
    interface: 'wlan1',
    uuid: 'second-id',
  });
  view.unmount();
  render(
    <NetworkChangeDialog
      {...base}
      draft={{ kind: 'policy', policy: 'not_at_home' }}
      onApply={onApply}
    />,
  );
  expect(
    screen.getByRole('button', { name: 'Apply network change' }),
  ).toBeDisabled();
  await userEvent
    .setup()
    .type(screen.getByLabelText('Home Wi-Fi name'), 'Studio');
  await userEvent
    .setup()
    .click(screen.getByRole('button', { name: 'Apply network change' }));
  expect(onApply).toHaveBeenLastCalledWith({
    type: 'policy',
    settings: { interface: 'wlan1', mode: 'not_at_home', home_ssid: 'Studio' },
  });
});
