import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { MixedRig } from './MixedRig';
import { rigAudioState, rigAudioCommand, rigDocument } from './api';
vi.mock('./api', () => ({
  rigAudioState: vi.fn(),
  rigAudioCommand: vi.fn(),
  rigDocument: vi.fn(),
}));
vi.mock('./SceneMidi', () => ({ SceneMidi: () => null }));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
it('groups native controls in hybrid rigs and toggles booleans without a slider', async () => {
  const controls = [
    ['outputLevel', 'Output', '0 dB', false],
    ['gateEnabled', 'Gate enabled', 'Off', true],
    ['pitchSemitones', 'Pitch', '-12 st', false],
    ['alignOffset', 'Alignment offset', '0 ms', false],
  ].map(([parameter, label, display, toggle]) => ({
    target: { kind: 'native', node: 'amp', parameter },
    label,
    display,
    toggle,
    value: 0,
    minimum: 0,
    maximum: 1,
    integer: false,
    logarithmic: false,
  }));
  const state = {
    phase: 'running',
    session: 'daemon',
    revision: 2,
    configured: { revision: 'rig' },
    control: {
      session: 'audio',
      revision: 3,
      controls,
      eq: [],
      slots: [{ node: 'amp', slots: [] }],
    },
  } as unknown as Awaited<ReturnType<typeof rigAudioState>>;
  vi.mocked(rigAudioState).mockResolvedValue(state);
  vi.mocked(rigAudioCommand).mockResolvedValue(state);
  vi.mocked(rigDocument).mockResolvedValue({
    revision: 'rig',
    manifest: {
      name: 'Test rig',
      extensions: {},
      tone3000: { instances: [{ id: 'native' }] },
      oxidal: {
        lv2: [],
        graph: { nodes: [{ id: 'amp', kind: 'tone3000', instance: 'native' }] },
      },
    },
  } as unknown as Awaited<ReturnType<typeof rigDocument>>);
  render(
    <MixedRig
      connected
      onPlaying={() => {}}
      onPresent={() => {}}
      otherPlaying={false}
    />,
  );
  await screen.findByRole('button', { name: 'Adjust Output' });
  expect(
    screen.queryByRole('button', { name: 'Adjust Pitch' }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Pitch' }));
  expect(
    screen.getByRole('button', { name: 'Adjust Pitch' }),
  ).toHaveTextContent('-12 st');
  expect(
    screen.queryByRole('button', { name: 'Adjust Output' }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Stereo' }));
  expect(
    screen.getByRole('button', { name: 'Adjust Alignment offset' }),
  ).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Gate' }));
  const toggle = screen.getByRole('button', { name: 'Adjust Gate enabled' });
  expect(toggle).toHaveAttribute('aria-pressed', 'false');
  fireEvent.click(toggle);
  await waitFor(() =>
    expect(rigAudioCommand).toHaveBeenCalledWith(state, {
      kind: 'control',
      command: {
        session: 'audio',
        expected_revision: 3,
        target: { kind: 'native', node: 'amp', parameter: 'gateEnabled' },
        value: 1,
      },
    }),
  );
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
