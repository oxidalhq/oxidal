import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { AudioReconfigure } from './AudioReconfigure';
import type { AudioProbe, StartAudio } from './api';
afterEach(cleanup);
const input: AudioProbe = {
  endpoint: 'hw:test',
  direction: 'capture',
  channels: 2,
  format: 's16',
  sample_rate: 48000,
  period_frames: 64,
  periods: 3,
};
const initial: StartAudio['stream'] = {
  input,
  output: { ...input, direction: 'playback' },
  input_map: [0, 1],
  output_map: [0, 1],
  hear_yourself: false,
};
it('offers supported buffers with timing while applying only after explicit confirmation', async () => {
  const user = userEvent.setup();
  const apply = vi.fn();
  render(
    <AudioReconfigure
      initial={initial}
      checkedInput={null}
      checkedOutput={null}
      disabled={false}
      running
      onApply={apply}
    />,
  );
  const button = screen.getByRole('button', { name: 'Apply & restart audio' });
  expect(button).toBeDisabled();
  const buffer = screen.getByRole('combobox', {
    name: 'Session buffer (samples)',
  });
  await user.click(buffer);
  expect(screen.queryByRole('option', { name: /^129/ })).toBeNull();
  await user.click(screen.getByRole('option', { name: /^256 ·/ }));
  expect(screen.getByText(/one period 5\.33 ms/)).toBeVisible();
  expect(apply).not.toHaveBeenCalled();
  await user.click(button);
  expect(apply).toHaveBeenCalledWith({
    ...initial,
    input: { ...input, period_frames: 256 },
    output: { ...initial.output, period_frames: 256 },
  });
  await user.click(screen.getByRole('button', { name: 'Reset changes' }));
  expect(buffer).toHaveTextContent(/^64 ·/);
  expect(button).toBeDisabled();
});
it('retains the monitoring preference when choosing a checked interface', () => {
  const apply = vi.fn();
  render(
    <AudioReconfigure
      initial={initial}
      checkedInput={{ ...input, endpoint: 'hw:new' }}
      checkedOutput={{ ...initial.output, endpoint: 'hw:new' }}
      disabled={false}
      running={false}
      onApply={apply}
    />,
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Use checked interface' }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Apply & resume audio' }));
  expect(apply.mock.calls[0]![0]).toMatchObject({
    hear_yourself: false,
    input: { endpoint: 'hw:new' },
    output: { endpoint: 'hw:new' },
  });
});
