import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PerformView } from './PerformView';
import { setPerform } from './performState';
import {
  navigateMidi,
  monitoring,
  nativeState,
  libraryCatalog,
  presetDetails,
  presetLibrary,
  rigLibrary,
  type AudioState,
  type Monitoring,
} from './api';
vi.mock('./api', () => ({
  navigateMidi: vi.fn(),
  monitoring: vi.fn(),
  nativeState: vi.fn(),
  presetDetails: vi.fn().mockResolvedValue({ revision: 'empty', entries: [] }),
  libraryCatalog: vi.fn().mockResolvedValue({ revision: 'empty', items: [] }),
  presetLibrary: vi.fn(),
  rigLibrary: vi.fn(),
}));
beforeEach(() => {
  vi.mocked(presetDetails).mockResolvedValue({
    revision: 'empty',
    entries: [],
  });
  vi.mocked(libraryCatalog).mockResolvedValue({ revision: 'empty', items: [] });
});
afterEach(() => {
  setPerform({ on: false, mode: 'play' });
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
      now={{
        session: state.session,
        playing: true,
        name: state.preset_name,
        modified: state.modified,
      }}
      selector={<p>Preset pads</p>}
      disabled={false}
      lanes={[
        {
          id: 'left',
          input: 'IN L',
          blocks: [
            { id: 'amp', label: 'AC30', kind: 'amp', on: true, face: null },
            {
              id: 'slot',
              label: 'Empty slot',
              kind: 'other',
              on: false,
              face: null,
              empty: true,
            },
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
  // Empty slots are not shown on stage.
  expect(screen.queryByText('Empty slot')).not.toBeInTheDocument();
  const muff = screen.getByRole('button', { name: 'Muff on' });
  expect(muff).toHaveAttribute('aria-pressed', 'false');
  fireEvent.click(muff);
  expect(toggle).toHaveBeenCalledWith('fuzz');
  // Presets is its own full screen; Play brings the boxes back.
  expect(screen.queryByText('Preset pads')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Presets' }));
  expect(screen.getByText('Preset pads')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Muff on' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Play' }));
  expect(screen.getByRole('button', { name: 'Muff on' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Back to Rig' }));
  expect(edit).toHaveBeenCalled();
});

it('stays in Perform on the same screen when the view is rebuilt, as when a preset hands over to another engine', async () => {
  vi.mocked(monitoring).mockResolvedValue(snapshot);
  const props = {
    now: { session: 's', playing: true, name: 'A', modified: false },
    lanes: [],
    disabled: false,
    onToggle: () => {},
    onEdit: () => {},
    selector: <p>Preset pads</p>,
  };
  const first = render(<PerformView {...props} />);
  fireEvent.click(screen.getByRole('button', { name: 'Presets' }));
  first.unmount();
  render(<PerformView {...props} now={{ ...props.now, name: 'B' }} />);
  expect(screen.getByText('Preset pads')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Presets' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});

it('steps through the set list and explains a refused step without losing the sound', async () => {
  vi.mocked(monitoring).mockResolvedValue({} as Monitoring);
  vi.mocked(navigateMidi)
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(
      new Error('Already at the last preset in the Set list'),
    );
  render(
    <PerformView
      now={{ session: 's', playing: true, name: 'Clean', modified: false }}
      lanes={[]}
      disabled={false}
      onToggle={vi.fn()}
      onEdit={vi.fn()}
      selector={null}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: /Previous/ }));
  await vi.waitFor(() => expect(navigateMidi).toHaveBeenCalledWith('previous'));
  await vi.waitFor(() =>
    expect(screen.getByRole('button', { name: /Next/ })).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole('button', { name: /Next/ }));
  await vi.waitFor(() => expect(navigateMidi).toHaveBeenCalledWith('next'));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'last preset in the Set list',
  );
  // Switching disables both steps so a second press cannot race the first.
  cleanup();
  render(
    <PerformView
      now={{ session: 's', playing: true, name: 'Clean', modified: false }}
      lanes={[]}
      disabled={false}
      switching
      onToggle={vi.fn()}
      onEdit={vi.fn()}
      selector={null}
    />,
  );
  expect(screen.getByRole('button', { name: /Next/ })).toBeDisabled();
});
