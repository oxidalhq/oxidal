import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { SettingDialog } from './SettingDialog';

afterEach(cleanup);
it('shows target loudness in LUFS while keeping the normalized engine contract', async () => {
  const apply = vi.fn(async () => {});
  render(
    <SettingDialog
      control={{
        target: 'targetLoudness',
        label: 'Target loudness',
        value: 0.7,
        display: '-18',
        toggle: false,
      }}
      busy={false}
      stale={false}
      onCancel={() => {}}
      onApply={apply}
    />,
  );
  expect(await screen.findByText('-18.0 LUFS')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
  await waitFor(() => expect(apply).toHaveBeenCalledWith(0.7));
});

it('offers only real pitch-window choices and sends the selected normalized index', async () => {
  const apply = vi.fn(async () => {});
  render(
    <SettingDialog
      control={{
        target: 'pitchWindow',
        label: 'Pitch window',
        value: 1 / 3,
        display: '30 ms',
        toggle: false,
      }}
      busy={false}
      stale={false}
      onCancel={() => {}}
      onApply={apply}
    />,
  );
  fireEvent.click(await screen.findByRole('radio', { name: '60 ms' }));
  fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
  await waitFor(() => expect(apply).toHaveBeenCalledWith(1));
  expect(screen.queryByRole('slider')).toBeNull();
});
