import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { PerformView } from './PerformView';
import {
  monitoring,
  nativeState,
  presetLibrary,
  rigLibrary,
  type AudioState,
  type Monitoring,
} from './api';
vi.mock('./api', () => ({
  monitoring: vi.fn(),
  nativeState: vi.fn(),
  presetLibrary: vi.fn(),
  rigLibrary: vi.fn(),
}));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
const state = {
  session: 's',
  phase: 'running',
  preset_name: 'Stereo Fuzz',
  modified: true,
  configured: { preset_id: 'a', owned: false, draft: false },
} as AudioState;
const snapshot = {
  audio: {
    deadline_us: 1333,
    process_us_p95: 320,
    xruns: 7,
    input: [
      { peak_dbfs: -18, rms_dbfs: -30, clips: 0 },
      { peak_dbfs: -20, rms_dbfs: -32, clips: 0 },
    ],
    output: [
      { peak_dbfs: -9, rms_dbfs: -20, clips: 2 },
      { peak_dbfs: -10, rms_dbfs: -21, clips: 0 },
    ],
  },
  host: { cpu_percent: 12, temperature_c: 52.6 },
  stream: { input: { period_frames: 64, sample_rate: 48000 } },
} as unknown as Monitoring;

it('shows edge meters and live stats measured from this preset, and toggles stomps', async () => {
  vi.mocked(monitoring).mockResolvedValue(snapshot);
  vi.mocked(presetLibrary).mockResolvedValue([]);
  vi.mocked(rigLibrary).mockResolvedValue({
    presets: [],
    native_profile: 'tone3000-plugin:test',
  });
  vi.mocked(nativeState).mockResolvedValue({
    owned: [],
  } as unknown as Awaited<ReturnType<typeof nativeState>>);
  const toggle = vi.fn();
  const edit = vi.fn();
  render(
    <PerformView
      state={state}
      disabled={false}
      lanes={[
        {
          id: 'left',
          input: 'IN L',
          blocks: [
            { id: 'amp', label: 'AC30', kind: 'amp', on: true, face: null },
          ],
        },
        {
          id: 'right',
          input: 'IN R',
          blocks: [
            { id: 'fuzz', label: 'Muff', kind: 'pedal', on: false, face: null },
          ],
        },
      ]}
      onToggle={toggle}
      onRecall={() => {}}
      onEdit={edit}
    />,
  );
  expect(
    await screen.findByRole('meter', { name: 'Input level' }),
  ).toHaveAttribute('aria-valuetext', '-18.0 dBFS peak');
  expect(screen.getByRole('meter', { name: 'Output level' })).toHaveAttribute(
    'aria-valuetext',
    '-9.0 dBFS peak',
  );
  const stats = screen.getByRole('group', { name: 'Live stats' });
  // DSP p95 against the deadline; xruns and clips count from this preset only.
  expect(stats).toHaveTextContent('24%');
  expect(stats).toHaveTextContent('since this preset');
  expect(stats).toHaveTextContent('of 1.33 ms · 64 @ 48k');
  expect(stats).toHaveTextContent('-18 / -9');
  // Rails are an overlay that shows only while there is signal.
  expect(screen.getByRole('meter', { name: 'Input level' })).toHaveAttribute(
    'data-showing',
  );
  expect(stats).toHaveTextContent('53°C');
  expect(stats).toHaveTextContent('None');
  expect(screen.getByText('Stereo Fuzz')).toBeInTheDocument();
  expect(screen.getByText('edited, not saved')).toBeInTheDocument();
  const muff = screen.getByRole('button', { name: 'Muff on' });
  expect(muff).toHaveAttribute('aria-pressed', 'false');
  fireEvent.click(muff);
  expect(toggle).toHaveBeenCalledWith('fuzz');
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
  expect(edit).toHaveBeenCalled();
});
