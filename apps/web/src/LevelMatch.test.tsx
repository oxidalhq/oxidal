import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LevelMatch } from './LevelMatch';
import { monitoring, unitLevels, type Monitoring } from './api';
import { averageDb, outputDb, outputValue } from './loudnessMatch';
vi.mock('./api', () => ({ monitoring: vi.fn(), unitLevels: vi.fn() }));

class Events extends EventTarget {
  close() {}
}
let input = -20;
let output = -24;
let sequence = 0;
beforeEach(() => {
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'performance', 'Date'],
  });
  vi.stubGlobal('EventSource', Events);
  input = -20;
  output = -24;
  vi.mocked(monitoring).mockImplementation(
    async () =>
      ({
        sequence: ++sequence,
        audio: {
          input: [{ peak_dbfs: input }, { peak_dbfs: input }],
          output: [{ rms_dbfs: output }, { rms_dbfs: output - 3 }],
        },
      }) as unknown as Monitoring,
  );
  vi.mocked(unitLevels).mockResolvedValue({
    input_trim_db: 0,
    output_level_db: -6,
    mono: false,
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const tick = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

it('maps the Output level control and averages power, not dB', () => {
  expect(outputDb(0.5)).toBe(0);
  expect(outputDb(1)).toBe(24);
  expect(outputValue(-30)).toBe(0);
  expect(outputValue(6)).toBeCloseTo(0.625);
  expect(averageDb([-20, -20, -20])).toBeNull();
  expect(averageDb([-20, -20, -20, -20])).toBeCloseTo(-20);
  expect(averageDb([-10, -100, -100, -100])).toBeCloseTo(-16.02, 1);
});

it('measures while playing, removes the master level and proposes the preset trim', async () => {
  const apply = vi.fn();
  render(
    <LevelMatch
      output={{ value: 0.5 }}
      disabled={false}
      onApply={apply}
      onClose={() => {}}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Start listening' }));
  await tick(9000);
  // Output −24 dBFS with Level at −6 dB → the preset itself plays at −18: no change.
  expect(screen.getByRole('status')).toHaveTextContent(
    'This preset plays at −18.0 dB on average. Output level 0.0 dB → 0.0 dB.',
  );
  fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
  await act(async () => {});
  expect(apply).toHaveBeenCalledWith(0.5);
});

it('refuses a match when nobody played', async () => {
  input = -90;
  render(
    <LevelMatch
      output={{ value: 0.5 }}
      disabled={false}
      onApply={() => {}}
      onClose={() => {}}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Start listening' }));
  await tick(9000);
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Not enough playing heard',
  );
});
