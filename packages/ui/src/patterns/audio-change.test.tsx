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

it('closing a device buffer test is presentation only; explicit Stop test requests restoration', async () => {
  const user = userEvent.setup();
  const cancel = vi.fn();
  render(
    <AudioChange
      current={current}
      phase="idle"
      secondsLeft={0}
      disabled
      onApply={vi.fn()}
      onSettle={vi.fn()}
      finder={{
        state: 'running',
        trials: [],
        total: 3,
        onStart: vi.fn(),
        onCancel: cancel,
      }}
    />,
  );
  await user.click(screen.getByRole('button', { name: 'View buffer test…' }));
  await user.click(screen.getByRole('button', { name: 'Close panel' }));
  expect(cancel).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'View buffer test…' }));
  await user.click(
    screen.getByRole('button', { name: 'Stop test and restore' }),
  );
  expect(cancel).toHaveBeenCalledTimes(1);
});

it('unknown measurements are unavailable and never become a clean recommendation', async () => {
  const user = userEvent.setup();
  render(
    <AudioChange
      current={current}
      phase="idle"
      secondsLeft={0}
      onApply={vi.fn()}
      onSettle={vi.fn()}
      finder={{
        state: 'done',
        trials: [
          {
            frames: 64,
            periods: 2,
            outcome: 'unavailable',
            reason: 'Counters unavailable',
          },
        ],
        total: 1,
        onStart: vi.fn(),
        onCancel: vi.fn(),
        recommended: null,
      }}
    />,
  );
  await user.click(
    screen.getByRole('button', { name: 'View buffer results…' }),
  );
  expect(screen.getByText(/xruns unknown/)).toBeVisible();
  expect(screen.getByText('Counters unavailable')).toBeVisible();
  expect(screen.queryByRole('button', { name: /^Use / })).toBeNull();
});
