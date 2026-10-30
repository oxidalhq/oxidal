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
const side = (direction: 'capture' | 'playback', frames: number) => ({
  endpoint: 'hw:CARD=Audio,DEV=0',
  direction,
  sample_rate: 48000,
  channels: direction === 'capture' ? 1 : 2,
  format: 's24_packed' as const,
  period_frames: frames,
  periods: 3,
});
const stream = (frames: number): StartAudio['stream'] => ({
  input: side('capture', frames),
  output: side('playback', frames),
  input_map: [0, 0],
  output_map: [0, 1],
  hear_yourself: true,
});
let live = { frames: 128, xruns: 0, sequence: 0 };
const reading = (): Monitoring =>
  ({
    sequence: ++live.sequence,
    audio_phase: 'running',
    graph_phase: 'stopped',
    rig_phase: 'stopped',
    host: {},
    source: 'native',
    stream: stream(live.frames),
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
  live = { frames: 128, xruns: 0, sequence: 0 };
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

it('halves the buffer while clean and falls back to the last clean size on dropouts', async () => {
  const apply = vi.fn((next: StartAudio['stream']) => {
    live = { ...live, frames: next.input.period_frames, xruns: 0 };
  });
  render(
    <BufferFinder
      stream={stream(128)}
      running
      disabled={false}
      apply={apply}
    />,
  );
  expect(
    screen.getByText(/128 samples × 3 at 48000 Hz = 8\.0 ms/),
  ).toBeVisible();
  fireEvent.click(
    screen.getByRole('button', { name: 'Find lowest stable buffer' }),
  );
  expect(apply).toHaveBeenLastCalledWith(stream(64));
  await tick(22000);
  expect(apply).toHaveBeenLastCalledWith(stream(32));
  expect(screen.getByText('64 samples: clean for 20 s.')).toBeVisible();
  await tick(2000);
  live.xruns = 3;
  await tick(2000);
  expect(apply).toHaveBeenLastCalledWith(stream(64));
  expect(screen.getByText('32 samples: 3 dropouts.')).toBeVisible();
  expect(
    screen.getByText('Lowest stable buffer: 64 samples × 3 (4.0 ms).'),
  ).toBeVisible();
});

it('keeps the original buffer when the interface refuses the first step', async () => {
  const apply = vi.fn();
  render(
    <BufferFinder
      stream={stream(128)}
      running
      disabled={false}
      apply={apply}
    />,
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Find lowest stable buffer' }),
  );
  await tick(17000);
  expect(apply).toHaveBeenLastCalledWith(stream(128));
  expect(
    screen.getByText(
      '64 samples: the interface refused it or audio did not start.',
    ),
  ).toBeVisible();
});
