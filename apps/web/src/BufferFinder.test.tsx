import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { BufferFinder } from './BufferFinder';
import { monitoring, type Monitoring, type StartAudio } from './api';
vi.mock('./api', () => ({ monitoring: vi.fn() }));

class Events extends EventTarget {
  close() {}
}
const side = (
  direction: 'capture' | 'playback',
  frames: number,
  periods: number,
) => ({
  endpoint: 'hw:CARD=Audio,DEV=0',
  direction,
  sample_rate: 48000,
  channels: direction === 'capture' ? 1 : 2,
  format: 's24_packed' as const,
  period_frames: frames,
  periods,
});
const stream = (frames: number, periods = 4): StartAudio['stream'] => ({
  input: side('capture', frames, periods),
  output: side('playback', frames, periods),
  input_map: [0, 0],
  output_map: [0, 1],
  hear_yourself: true,
});
let live = { frames: 64, periods: 4, xruns: 0, sequence: 0 };
const reading = (): Monitoring =>
  ({
    sequence: ++live.sequence,
    audio_phase: 'running',
    graph_phase: 'stopped',
    rig_phase: 'stopped',
    host: {},
    source: 'native',
    stream: stream(live.frames, live.periods),
    audio: null,
    audio_age_ms: null,
    xruns: live.xruns,
    error: null,
  }) as unknown as Monitoring;

beforeEach(() => {
  vi.useFakeTimers({
    toFake: [
      'setTimeout',
      'clearTimeout',
      'setInterval',
      'clearInterval',
      'performance',
      'Date',
    ],
  });
  vi.stubGlobal('EventSource', Events);
  live = { frames: 64, periods: 4, xruns: 0, sequence: 0 };
  vi.mocked(monitoring).mockImplementation(async () => reading());
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

// Like a USB interface: it refuses periods below 48 frames and keeps the old
// session, and it drops out with only two periods.
function device() {
  return vi.fn((next: StartAudio['stream']) => {
    const frames = next.input.period_frames;
    const periods = next.input.periods;
    if (frames < 48) return;
    live = { ...live, frames, periods, xruns: periods < 3 ? 5 : 0 };
  });
}

it('steps the size down, then the periods, and keeps the last clean buffer', async () => {
  const apply = device();
  render(
    <BufferFinder stream={stream(64)} running disabled={false} apply={apply} />,
  );
  expect(
    screen.getByText(/64 samples × 4 at 48000 Hz = 5\.3 ms/),
  ).toBeVisible();
  fireEvent.click(
    screen.getByRole('button', { name: 'Find lowest stable buffer' }),
  );
  expect(apply).toHaveBeenLastCalledWith(stream(48));
  await tick(22000);
  expect(screen.getByText('48 × 4: clean for 20 s.')).toBeVisible();
  expect(apply).toHaveBeenLastCalledWith(stream(32));
  await tick(16000);
  expect(
    screen.getByText(
      '32 × 4: the interface refused it or audio did not start.',
    ),
  ).toBeVisible();
  expect(apply).toHaveBeenLastCalledWith(stream(48, 3));
  await tick(22000);
  expect(screen.getByText('48 × 3: clean for 20 s.')).toBeVisible();
  expect(apply).toHaveBeenLastCalledWith(stream(48, 2));
  live.xruns = 0;
  await tick(2000);
  live.xruns = 9;
  await tick(2000);
  expect(screen.getByText(/48 × 2: \d+ dropouts?\./)).toBeVisible();
  expect(apply).toHaveBeenLastCalledWith(stream(48, 3));
  expect(
    screen.getByText('Lowest stable buffer: 48 × 3 (3.0 ms).'),
  ).toBeVisible();
});

it('keeps the original buffer when nothing smaller works', async () => {
  live = { ...live, frames: 48, periods: 2 };
  const apply = vi.fn();
  render(
    <BufferFinder
      stream={stream(48, 2)}
      running
      disabled={false}
      apply={apply}
    />,
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Find lowest stable buffer' }),
  );
  expect(apply).toHaveBeenLastCalledWith(stream(32, 2));
  await tick(17000);
  expect(apply).toHaveBeenLastCalledWith(stream(48, 2));
  expect(
    screen.getByText('Lowest stable buffer: 48 × 2 (2.0 ms).'),
  ).toBeVisible();
});
