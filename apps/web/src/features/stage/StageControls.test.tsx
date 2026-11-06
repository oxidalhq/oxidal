import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';

vi.mock('../../api', () => ({
  protectState: vi.fn(async () => ({ on: false })),
  setProtect: vi.fn(async (on: boolean) => ({ on })),
  monitoring: vi.fn(async () => ({ audio: { monitoring: {} } })),
}));
vi.mock('./outputMute', () => ({ setOutputMute: vi.fn(async () => {}) }));

import { setProtect } from '../../api';
import { setOutputMute } from './outputMute';
import { StageControls } from './StageControls';

afterEach(cleanup);

it('turns Protect on in one tap and asks before turning it off', async () => {
  const user = userEvent.setup();
  render(<StageControls connected />);
  const protect = await screen.findByRole('button', { name: /Protect/ });
  await waitFor(() => expect(protect).toBeEnabled());
  await user.click(protect);
  expect(setProtect).toHaveBeenLastCalledWith(true);
  await screen.findByRole('button', { name: /Protected/ });
  await user.click(screen.getByRole('button', { name: /Protected/ }));
  expect(screen.getByText('Turn Protect off?')).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Keep Protect on' }));
  expect(setProtect).toHaveBeenCalledTimes(1);
  await user.click(screen.getByRole('button', { name: /Protected/ }));
  await user.click(screen.getByRole('button', { name: 'Turn off' }));
  expect(setProtect).toHaveBeenLastCalledWith(false);
});

it('mutes the playing output and shows the confirmed state', async () => {
  const user = userEvent.setup();
  render(<StageControls connected />);
  const mute = await screen.findByRole('button', { name: 'Mute' });
  await waitFor(() => expect(mute).toBeEnabled());
  await user.click(mute);
  expect(setOutputMute).toHaveBeenCalledWith(true);
  expect(
    await screen.findByRole('button', { name: 'Muted', pressed: true }),
  ).toBeVisible();
});
