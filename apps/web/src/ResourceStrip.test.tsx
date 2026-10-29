import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ResourceStrip } from './ResourceStrip';
import { monitoring, type Monitoring } from './api';
vi.mock('./api', () => ({ monitoring: vi.fn() }));
class Events extends EventTarget {
  static latest: Events;
  closed = false;
  constructor() {
    super();
    Events.latest = this;
  }
  close() {
    this.closed = true;
  }
}
const snapshot = (sequence: number, phase: string): Monitoring => ({
  sequence,
  audio_phase: 'stopped',
  graph_phase: 'failed',
  rig_phase: phase,
  host: {},
  source: null,
  stream: null,
  audio: null,
  audio_age_ms: null,
  xruns: null,
  error: null,
});
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('EventSource', Events);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.resetAllMocks();
});
it('refreshes BOOX on confirmed lifecycle changes without accepting an older in-flight reading', async () => {
  let late: (state: Monitoring) => void = () => {};
  vi.mocked(monitoring)
    .mockResolvedValueOnce(snapshot(1, 'stopped'))
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          late = resolve;
        }),
    )
    .mockResolvedValueOnce(snapshot(3, 'starting'))
    .mockResolvedValueOnce(snapshot(4, 'running'))
    .mockResolvedValueOnce(snapshot(5, 'stopping'));
  const view = render(
    <ResourceStrip displayMode="epaper" connected onDetails={() => {}} />,
  );
  await act(async () => {});
  expect(screen.getByTestId('resource-state')).toHaveTextContent(
    'Audio failed',
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000);
  });
  expect(monitoring).toHaveBeenCalledTimes(2);
  await act(async () => {
    Events.latest.dispatchEvent(new Event('lifecycle'));
  });
  expect(screen.getByTestId('resource-state')).toHaveTextContent(
    'Audio starting',
  );
  await act(async () => {
    late(snapshot(2, 'stopped'));
  });
  expect(screen.getByTestId('resource-state')).toHaveTextContent(
    'Audio starting',
  );
  // No rapid repeating meter loop after invalidation; keep the e-paper interval.
  await act(async () => {
    await vi.advanceTimersByTimeAsync(4999);
  });
  expect(monitoring).toHaveBeenCalledTimes(3);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
  expect(screen.getByTestId('resource-state')).toHaveTextContent(
    'Awaiting meters',
  );
  await act(async () => {
    Events.latest.dispatchEvent(new Event('lifecycle'));
  });
  expect(screen.getByTestId('resource-state')).toHaveTextContent(
    'Audio stopping',
  );
  view.unmount();
  expect(Events.latest.closed).toBe(true);
  Events.latest.dispatchEvent(new Event('lifecycle'));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(6000);
  });
  expect(monitoring).toHaveBeenCalledTimes(5);
});

it('shows a measured zero and recovered xruns instead of treating zero as unavailable', async () => {
  const reading = {
    ...snapshot(1, 'running'),
    xruns: 0,
    audio_age_ms: 0,
    audio: {
      frames: 128,
      input: [],
      output: [],
      process_us_p95: 10,
      deadline_us: 1000,
    },
  } as unknown as Monitoring;
  vi.mocked(monitoring)
    .mockResolvedValueOnce(reading)
    .mockResolvedValueOnce({ ...reading, sequence: 2, xruns: 6 });
  render(<ResourceStrip displayMode="stage" connected onDetails={() => {}} />);
  await act(async () => {});
  expect(screen.getByText('Xruns').parentElement).toHaveTextContent('0');
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });
  expect(screen.getByText('Xruns').parentElement).toHaveTextContent('6');
});

it('keeps stopped audio visible without showing a normal running badge', async () => {
  vi.mocked(monitoring).mockResolvedValue({
    ...snapshot(1, 'stopped'),
    graph_phase: 'stopped',
  });
  render(<ResourceStrip displayMode="stage" connected onDetails={() => {}} />);
  await act(async () => {});
  expect(screen.getByRole('status')).toHaveTextContent('Audio stopped');
});
