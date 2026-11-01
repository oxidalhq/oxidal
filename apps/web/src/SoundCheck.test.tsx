import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  boosts,
  calibration,
  calibrationCoverage,
  guitarProfiles,
  unitLevels,
  type BoostState,
  type CalibrationState,
  type GuitarProfiles,
  type Monitoring,
  type UnitLevels,
} from './api';
import { useMonitorFeed } from './monitorFeed';
import { SoundCheck } from './SoundCheck';

vi.mock('./api', () => ({
  boosts: vi.fn(),
  calibration: vi.fn(),
  calibrationCoverage: vi.fn(),
  guitarProfiles: vi.fn(),
  unitLevels: vi.fn(),
}));
vi.mock('./monitorFeed', () => ({ useMonitorFeed: vi.fn() }));
vi.mock('./EvenOut', () => ({
  EvenOut: () => <section aria-label="Even out">Even out controls</section>,
}));
vi.mock('./Monitoring', () => ({
  Monitoring: () => (
    <section aria-label="Audio and system monitoring">Live diagnostics</section>
  ),
}));

const calibrationState: CalibrationState = {
  target_lufs: -20,
  entries: [
    { key: 'loud', name: 'Modern Lead', lufs: -14, offset_db: -6 },
    { key: 'quiet', name: 'Ambient Clean', lufs: -25, offset_db: 5 },
  ],
  progress: { running: false, done: 0, total: 0, measured: 0 },
};
const boostState: BoostState = {
  applied_db: 4.5,
  calibrated_db: 1.5,
  boosts: { loud: 2, 'loud:solo': 1 },
  playing: ['loud', 'loud:solo'],
};
const profiles: GuitarProfiles = {
  active: 'jiva',
  reference: 'jiva',
  guitars: [
    {
      id: 'jiva',
      name: 'Jiva',
      trim_db: 2.5,
      peak_dbfs: -11.5,
      noise_dbfs: -68.5,
      gate: true,
      verification: {
        endpoint: 'Jogg capture',
        sample_rate: 48000,
        channels: 2,
        format: 's32',
        period_frames: 128,
        periods: 3,
        input_map: [0, 1],
        verified_at_ms: Date.UTC(2026, 10, 1, 6, 0),
      },
    },
  ],
};
const levels: UnitLevels = {
  input_trim_db: 2.5,
  output_level_db: -6,
  boost_db: 4.5,
  gate_db: -60,
  mono: false,
};
const monitoring: Monitoring = {
  sequence: 7,
  host: {},
  audio_phase: 'running',
  graph_phase: 'running',
  rig_phase: 'running',
  audio_age_ms: 12,
  xruns: 0,
  stream: {
    input: {
      endpoint: 'Jogg capture',
      direction: 'capture',
      sample_rate: 48000,
      channels: 2,
      format: 's32',
      period_frames: 128,
      periods: 3,
    },
    output: {
      endpoint: 'Jogg playback',
      direction: 'playback',
      sample_rate: 48000,
      channels: 2,
      format: 's32',
      period_frames: 128,
      periods: 3,
    },
    input_map: [0, 1],
    output_map: [0, 1],
  },
  audio: {
    frames: 1000,
    input: [
      { peak_dbfs: -11.5, rms_dbfs: -24, clips: 0 },
      { peak_dbfs: -80, rms_dbfs: -90, clips: 0 },
    ],
    output: [
      { peak_dbfs: -8, rms_dbfs: -20, clips: 0 },
      { peak_dbfs: -9, rms_dbfs: -21, clips: 0 },
    ],
    process_us_p50: 250,
    process_us_p95: 500,
    process_us_max: 700,
    deadline_us: 2666,
    deadline_misses: 0,
    invalid_samples: 0,
  },
};

beforeEach(() => {
  vi.mocked(calibration).mockResolvedValue(calibrationState);
  vi.mocked(calibrationCoverage).mockResolvedValue({
    total: 4,
    measured: 2,
    stale: 1,
    unmeasured: 1,
  });
  vi.mocked(boosts).mockResolvedValue(boostState);
  vi.mocked(guitarProfiles).mockResolvedValue(profiles);
  vi.mocked(unitLevels).mockResolvedValue(levels);
  vi.mocked(useMonitorFeed).mockReturnValue({
    snapshot: monitoring,
    link: 2,
    disconnected: false,
    error: '',
    at: 1,
  });
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

it('summarises measured loudness, guitar, interface and distinct level stages', async () => {
  const onLibrary = vi.fn();
  render(
    <SoundCheck
      connected
      displayMode="stage"
      onAudioSetup={() => {}}
      onGuitars={() => {}}
      onLibrary={onLibrary}
    />,
  );
  await act(async () => {});

  expect(screen.getByText('11.0 LU spread')).toBeVisible();
  expect(screen.getByText('0.0 LU spread')).toBeVisible();
  expect(
    screen.getByText(/2 current · 1 stale after changes · 1 never measured/),
  ).toBeVisible();
  expect(screen.getByText(/Modern Lead -14.0 LUFS/)).toBeVisible();
  expect(screen.getByText(/Ambient Clean -25.0 LUFS/)).toBeVisible();
  expect(screen.getByText(/Strum -11.5 dBFS · noise -68.5 dBFS/)).toBeVisible();
  expect(screen.getByText('Current input verified')).toBeVisible();
  expect(
    screen.getByText(/Sound Check follows the active profile automatically/),
  ).toBeVisible();
  expect(screen.getByText(/Jogg capture → Jogg playback/)).toBeVisible();
  fireEvent.click(
    screen.getAllByRole('button', { name: 'Preset library' })[0]!,
  );
  expect(onLibrary).toHaveBeenCalledOnce();
  expect(screen.getByText('+1.5 dB')).toBeVisible();
  expect(screen.getByText('+2.0 dB')).toBeVisible();
  expect(screen.getByText('+1.0 dB')).toBeVisible();
  expect(screen.getByText('+4.5 dB')).toBeVisible();
  expect(screen.getByText('−6.0 dB')).toBeVisible();
  expect(screen.getByRole('region', { name: 'Even out' })).toBeVisible();
  expect(
    screen.getByRole('region', { name: 'Audio and system monitoring' }),
  ).toBeVisible();
});

it('prioritises missing audio, incomplete guitar measurements and live faults', async () => {
  const onAudioSetup = vi.fn();
  const onGuitars = vi.fn();
  vi.mocked(guitarProfiles).mockResolvedValue({
    active: 'jiva',
    reference: null,
    guitars: [{ id: 'jiva', name: 'Jiva', trim_db: 0, peak_dbfs: null }],
  });
  vi.mocked(useMonitorFeed).mockReturnValue({
    snapshot: {
      ...monitoring,
      audio_age_ms: 4000,
      xruns: 2,
      audio: {
        ...monitoring.audio!,
        deadline_misses: 3,
        input: [
          { peak_dbfs: 0, rms_dbfs: -12, clips: 4 },
          { peak_dbfs: -80, rms_dbfs: -90, clips: 0 },
        ],
      },
    },
    link: 2,
    disconnected: false,
    error: '',
    at: 1,
  });

  render(
    <SoundCheck
      connected
      displayMode="stage"
      onAudioSetup={onAudioSetup}
      onGuitars={onGuitars}
      onLibrary={() => {}}
    />,
  );
  await act(async () => {});

  expect(screen.getByText('Choose and start an audio interface')).toBeVisible();
  expect(screen.getByText('Finish measuring Jiva')).toBeVisible();
  expect(screen.getByText('Reduce interface input gain')).toBeVisible();
  expect(screen.getByText('Increase audio headroom')).toBeVisible();
  fireEvent.click(screen.getAllByRole('button', { name: 'Audio setup' })[0]!);
  fireEvent.click(screen.getByRole('button', { name: 'Measure guitar' }));
  expect(onAudioSetup).toHaveBeenCalledOnce();
  expect(onGuitars).toHaveBeenCalledOnce();
});

it('separates physical input gain from digital output clipping advice', async () => {
  vi.mocked(useMonitorFeed).mockReturnValue({
    snapshot: {
      ...monitoring,
      audio: {
        ...monitoring.audio!,
        input: [
          { peak_dbfs: -0.1, rms_dbfs: -12, clips: 2 },
          { peak_dbfs: -80, rms_dbfs: -90, clips: 0 },
        ],
        output: [
          { peak_dbfs: 0, rms_dbfs: -8, clips: 3 },
          { peak_dbfs: -1, rms_dbfs: -10, clips: 0 },
        ],
      },
    },
    link: 2,
    disconnected: false,
    error: '',
    at: 1,
  });

  render(
    <SoundCheck
      connected
      displayMode="stage"
      onAudioSetup={() => {}}
      onGuitars={() => {}}
      onLibrary={() => {}}
    />,
  );
  await act(async () => {});

  expect(screen.getByText('Reduce interface input gain')).toBeVisible();
  expect(screen.getByText('Reduce digital output level')).toBeVisible();
  expect(
    screen.getByText('2 input clips · 3 output clips in this audio session.'),
  ).toBeVisible();
  expect(screen.getByText(/Oxidal cannot read that knob/)).toBeVisible();
  expect(
    screen.getByText(/physical volume knob cannot repair digital clipping/),
  ).toBeVisible();
});

it('warns about tight processing headroom before the first dropout', async () => {
  vi.mocked(useMonitorFeed).mockReturnValue({
    snapshot: {
      ...monitoring,
      audio: {
        ...monitoring.audio!,
        process_us_p95: 780,
        process_us_max: 820,
        process_us_peak: 870,
        deadline_us: 1000,
        deadline_misses: 0,
      },
    },
    link: 2,
    disconnected: false,
    error: '',
    at: 1,
  });

  render(
    <SoundCheck
      connected
      displayMode="stage"
      onAudioSetup={() => {}}
      onGuitars={() => {}}
      onLibrary={() => {}}
    />,
  );
  await act(async () => {});

  expect(screen.getByText('Processing headroom is tight')).toBeVisible();
  expect(screen.getByText(/DSP p95 is 78%.*session peak is 87%/)).toBeVisible();
});

it('calls out presets that hit the bounded loudness correction limit', async () => {
  vi.mocked(calibration).mockResolvedValue({
    ...calibrationState,
    entries: [
      {
        key: 'very-quiet',
        name: 'Very Quiet',
        lufs: -40,
        offset_db: 12,
      },
    ],
  });

  render(
    <SoundCheck
      connected
      displayMode="stage"
      onAudioSetup={() => {}}
      onGuitars={() => {}}
      onLibrary={() => {}}
    />,
  );
  await act(async () => {});

  expect(screen.getByText('Loudness correction limit reached')).toBeVisible();
  expect(screen.getByText(/Very Quiet needs the maximum ±12 dB/)).toBeVisible();
});
