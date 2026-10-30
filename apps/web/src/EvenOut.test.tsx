import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { calibration, type CalibrationState } from './api';
import { EvenOut } from './EvenOut';
vi.mock('./api', () => ({ calibration: vi.fn() }));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
const idle: CalibrationState = {
  target_lufs: -20,
  entries: [
    { key: 'a', name: 'Bogner Fullstack', lufs: -14, offset_db: -6 },
    { key: 'b', name: 'Dumble Spread', lufs: -26, offset_db: 6 },
  ],
  progress: { running: false, done: 0, total: 0, measured: 0 },
};

it('summarises the evened-out level, runs, and lists each offset', async () => {
  let current = idle;
  vi.mocked(calibration).mockImplementation(async (action) => {
    if (action === 'run')
      current = {
        ...idle,
        progress: {
          running: true,
          done: 1,
          total: 3,
          measured: 1,
          current: 'Heavy',
        },
      };
    return current;
  });
  render(<EvenOut connected />);
  await act(async () => {});
  expect(
    screen.getByText(/2 presets and scenes evened out to -20\.0 LUFS/),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Levels' }));
  expect(
    screen.getByRole('list', { name: 'Measured levels' }),
  ).toHaveTextContent('Bogner Fullstack−6.0 dBDumble Spread+6.0 dB');
  fireEvent.click(screen.getByRole('button', { name: 'Even out' }));
  await act(async () => {});
  expect(calibration).toHaveBeenCalledWith('run');
  expect(screen.getByRole('status')).toHaveTextContent(
    'Measuring 2 of 3: Heavy…',
  );
  expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '1');
  fireEvent.click(screen.getByRole('button', { name: 'Stop measuring' }));
  expect(calibration).toHaveBeenLastCalledWith('cancel');
});

it('hides itself on a daemon without calibration', async () => {
  vi.mocked(calibration).mockResolvedValue(null);
  const view = render(<EvenOut connected />);
  await act(async () => {});
  expect(view.container).toBeEmptyDOMElement();
});
