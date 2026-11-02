import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ResourceStrip } from './ResourceStrip';
import { monitoring, type Monitoring } from './api';
import { refreshMonitorFeed } from './monitorFeed';
vi.mock('./api', () => ({ monitoring: vi.fn() }));
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
  const view = render(<ResourceStrip displayMode="epaper" connected />);
  await act(async () => {});
  expect(screen.getByTestId('resource-state')).toHaveTextContent(
    'Audio failed',
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000);
  });
  expect(monitoring).toHaveBeenCalledTimes(2);
  await act(async () => {
    refreshMonitorFeed();
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
    refreshMonitorFeed();
  });
  expect(screen.getByTestId('resource-state')).toHaveTextContent(
    'Audio stopping',
  );
  view.unmount();
  refreshMonitorFeed();
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
      input: [
        { peak_dbfs: -120, rms_dbfs: -120, clips: 0 },
        { peak_dbfs: -120, rms_dbfs: -120, clips: 0 },
      ],
      output: [
        { peak_dbfs: -120, rms_dbfs: -120, clips: 0 },
        { peak_dbfs: -120, rms_dbfs: -120, clips: 0 },
      ],
      process_us_p95: 10,
      deadline_us: 1000,
    },
  } as unknown as Monitoring;
  vi.mocked(monitoring)
    .mockResolvedValueOnce(reading)
    .mockResolvedValueOnce({ ...reading, sequence: 2, xruns: 6 });
  render(<ResourceStrip displayMode="stage" connected />);
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
  render(<ResourceStrip displayMode="stage" connected />);
  await act(async () => {});
  expect(screen.getByRole('status')).toHaveTextContent('Audio stopped');
});

it('retains a session peak after the recent callback window becomes quiet', async () => {
  const reading = {
    ...snapshot(1, 'running'),
    audio_age_ms: 0,
    audio: {
      frames: 128,
      input: [
        { peak_dbfs: -120, rms_dbfs: -120, clips: 0 },
        { peak_dbfs: -120, rms_dbfs: -120, clips: 0 },
      ],
      output: [
        { peak_dbfs: -120, rms_dbfs: -120, clips: 0 },
        { peak_dbfs: -120, rms_dbfs: -120, clips: 0 },
      ],
      process_us_p50: 20,
      process_us_p95: 30,
      process_us_max: 40,
      process_us_peak: 1200,
      deadline_misses: 1,
      deadline_us: 1000,
      invalid_samples: 0,
    },
  } satisfies Monitoring;
  vi.mocked(monitoring).mockResolvedValue(reading);
  render(<ResourceStrip displayMode="stage" connected />);
  await act(async () => {});
  expect(screen.getByText('pk 120%')).toHaveAttribute('data-warning', 'true');
  expect(screen.getByText('DSP p95').parentElement).toHaveTextContent('3%');
});

it('warns before a callback reaches its deadline', async () => {
  const reading = {
    ...snapshot(1, 'running'),
    audio_age_ms: 0,
    audio: {
      frames: 128,
      input: [
        { peak_dbfs: -120, rms_dbfs: -120, clips: 0 },
        { peak_dbfs: -120, rms_dbfs: -120, clips: 0 },
      ],
      output: [
        { peak_dbfs: -120, rms_dbfs: -120, clips: 0 },
        { peak_dbfs: -120, rms_dbfs: -120, clips: 0 },
      ],
      process_us_p50: 400,
      process_us_p95: 760,
      process_us_max: 820,
      process_us_peak: 860,
      deadline_misses: 0,
      deadline_us: 1000,
      invalid_samples: 0,
    },
  } satisfies Monitoring;
  vi.mocked(monitoring).mockResolvedValue(reading);
  render(<ResourceStrip displayMode="stage" connected />);
  await act(async () => {});
  expect(screen.getByText('DSP p95').parentElement).toHaveAttribute(
    'data-warning',
    'true',
  );
  expect(screen.getByText('pk 86%')).toHaveAttribute('data-warning', 'false');
});
