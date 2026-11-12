import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { GlobalTuner } from './GlobalTuner';
import { tuner, type TunerState } from './api';
vi.mock('./api', () => ({ tuner: vi.fn() }));
vi.mock('./AdjustmentDialog', () => ({
  AdjustmentDialog: ({
    children,
    onCancel,
    className,
  }: {
    children: ReactNode;
    onCancel: () => void;
    className?: string;
  }) => (
    <div role="dialog" className={className}>
      {children}
      <button onClick={onCancel}>Close</button>
    </div>
  ),
}));
const listening = (frequency?: number): TunerState => ({
  available: true,
  enabled: true,
  output_muted: true,
  ...(frequency
    ? { reading: { frequency, confidence: 0.98, level: 0.1 } }
    : {}),
});
beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

it('starts listening muted under any preset and restores monitoring on close', async () => {
  vi.mocked(tuner).mockImplementation(async (update) =>
    update
      ? listening(110)
      : { available: true, enabled: false, output_muted: false },
  );
  const onClose = vi.fn();
  render(<GlobalTuner onClose={onClose} />);
  await waitFor(() =>
    expect(tuner).toHaveBeenCalledWith({ enabled: true, output_muted: true }),
  );
  expect(await screen.findByText('In tune')).toBeVisible();
  expect(screen.getByLabelText('Detected note')).toHaveTextContent('A2');
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  await waitFor(() => expect(onClose).toHaveBeenCalled());
  expect(tuner).toHaveBeenCalledWith({
    enabled: false,
    output_muted: false,
  });
});

it('shows how far and which way a string is out', async () => {
  // 5 cents flat of A2.
  vi.mocked(tuner).mockResolvedValue(listening(110 * 2 ** (-5 / 1200)));
  render(<GlobalTuner onClose={vi.fn()} />);
  expect(await screen.findByText('−5.0 cents')).toBeVisible();
  expect(screen.getByText('◀ flat')).toHaveAttribute('data-on', 'true');
  expect(screen.getByText('sharp ▶')).toHaveAttribute('data-on', 'false');
  expect(screen.getByRole('meter', { name: 'Tuning cents' })).toHaveAttribute(
    'aria-valuenow',
    '-5',
  );
});

it('lets the player hear the guitar, change the reference and fill the screen', async () => {
  vi.mocked(tuner).mockResolvedValue(listening(440));
  render(<GlobalTuner onClose={vi.fn()} />);
  expect(await screen.findByText('In tune')).toBeVisible();
  fireEvent.click(screen.getByRole('radio', { name: 'Hear sound' }));
  await waitFor(() =>
    expect(tuner).toHaveBeenCalledWith({ enabled: true, output_muted: false }),
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Raise reference pitch' }),
  );
  expect(await screen.findByText('A4 441')).toBeVisible();
  await waitFor(() => expect(screen.queryByText('In tune')).toBeNull());
  fireEvent.click(screen.getByRole('button', { name: 'Full screen' }));
  expect(screen.getByRole('dialog')).toHaveClass('tuner-full');
  fireEvent.click(screen.getByRole('button', { name: 'Day look' }));
  expect(localStorage.getItem('oxidal.tuner.look')).toBe('day');
  expect(localStorage.getItem('oxidal.tuner.full')).toBe('1');
});

it('says to play a preset when no audio runs, and starts by itself once it does', async () => {
  vi.mocked(tuner).mockResolvedValue({
    available: false,
    enabled: false,
    output_muted: false,
  });
  render(<GlobalTuner onClose={vi.fn()} />);
  expect(await screen.findByText('Play a preset to tune')).toBeVisible();
  expect(screen.getByRole('radio', { name: 'Mute' })).toBeDisabled();
  expect(tuner).not.toHaveBeenCalledWith(expect.anything());
  vi.mocked(tuner).mockImplementation(async (update) =>
    update
      ? listening()
      : { available: true, enabled: false, output_muted: false },
  );
  await waitFor(() =>
    expect(tuner).toHaveBeenCalledWith({ enabled: true, output_muted: true }),
  );
  expect(await screen.findByText('Play one string')).toBeVisible();
});
