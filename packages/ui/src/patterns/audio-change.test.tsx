import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';

import { AudioChange } from './audio-change';

afterEach(cleanup);
const current = { rate: 48000, frames: 64, periods: 3 };

it('retains an unsaved choice when fresh readback has the same hardware values', async () => {
  const user = userEvent.setup();
  const apply = vi.fn();
  const props = {
    current,
    phase: 'idle' as const,
    secondsLeft: 0,
    onApply: apply,
    onSettle: vi.fn(),
  };
  const view = render(<AudioChange {...props} />);
  await user.click(screen.getByRole('radio', { name: '96' }));
  view.rerender(<AudioChange {...props} current={{ ...current }} />);
  await user.click(
    screen.getByRole('button', { name: 'Apply and restart audio' }),
  );
  expect(apply).toHaveBeenCalledWith({ ...current, frames: 96 });
});

it('leaves rollback available when editing is locked and Keep is unavailable', async () => {
  const user = userEvent.setup();
  const settle = vi.fn();
  render(
    <AudioChange
      current={current}
      phase="proving"
      secondsLeft={0}
      onApply={vi.fn()}
      onSettle={settle}
      disabled
      confirmationDisabled={false}
      canKeep={false}
    />,
  );
  const dialog = within(
    screen.getByRole('dialog', { name: 'Keep this audio setting?' }),
  );
  expect(dialog.getByRole('button', { name: 'Keep' })).toBeDisabled();
  await user.click(dialog.getByRole('button', { name: 'Go back now' }));
  expect(settle).toHaveBeenCalledWith(false);
});

it('refuses Apply for invalid routing without locking the fields needed to fix it', async () => {
  const user = userEvent.setup();
  render(
    <AudioChange
      current={current}
      phase="idle"
      secondsLeft={0}
      onApply={vi.fn()}
      onSettle={vi.fn()}
      canApply={false}
    />,
  );
  await user.click(screen.getByRole('radio', { name: '96' }));
  expect(screen.getByRole('radio', { name: '96' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  expect(
    screen.getByRole('button', { name: 'Apply and restart audio' }),
  ).toBeDisabled();
});
