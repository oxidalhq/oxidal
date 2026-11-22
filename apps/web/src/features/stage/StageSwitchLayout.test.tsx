import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import { midiMap, presetSwitchLayout } from '../../api';
import type { Status2 } from '../../generated/contract';
import { StageSwitchLayout } from './StageSwitchLayout';

vi.mock('../../api', () => ({
  midiMap: vi.fn(),
  presetSwitchLayout: vi.fn(),
  learnMidi: vi.fn(async () => {}),
  pressPresetSwitch: vi.fn(),
}));
vi.mock('../../components/media/sessionMedia', () => ({
  useProtect: () => false,
}));
it('offers observed presses on configured ports and keeps saved inputs across an action edit', async () => {
  const input = { port: 'disconnected', channel: 1, controller: 106 };
  const state = {
    revision: 'a'.repeat(64),
    layout: {
      version: 1,
      switches: [
        {
          profile: 'four' as const,
          position: 1,
          gesture: 'tap' as const,
          action: { kind: 'tap_tempo' as const, note: 'quarter' as const },
          input,
        },
      ],
    },
  };
  vi.mocked(presetSwitchLayout).mockResolvedValue(state);
  vi.mocked(midiMap).mockResolvedValue({
    input: 'first',
    channel: 1,
    extra_inputs: [{ input: 'extra', channel: 2 }],
    revision: 'b'.repeat(64),
    entries: [],
  });
  const midi: Status2 = {
    events: 4,
    connected: true,
    input_ports: ['unrelated', 'extra'],
    sources: [{ connected: true }],
    recent: [
      {
        source: 0,
        seq: 1,
        message: { kind: 'control', channel: 1, controller: 100, value: 127 },
      },
      {
        source: 1,
        seq: 2,
        message: { kind: 'control', channel: 1, controller: 102, value: 127 },
      },
      {
        source: 1,
        seq: 3,
        message: { kind: 'control', channel: 2, controller: 103, value: 0 },
      },
      {
        source: 1,
        seq: 4,
        message: { kind: 'control', channel: 2, controller: 104, value: 127 },
      },
    ],
  };
  render(
    <StageSwitchLayout
      preset={{ kind: 'rig', id: 'rig', session: 'worker', targets: [], midi }}
      profile="four"
      names={['A', 'B', 'C', 'D']}
    >
      {() => null}
    </StageSwitchLayout>,
  );
  const edit = screen.getByRole('button', { name: 'Edit preset switches' });
  await waitFor(() => expect(edit).toBeEnabled());
  fireEvent.click(edit);
  const select = screen.getByRole('combobox', { name: 'Physical MIDI input' });
  await waitFor(() =>
    expect(
      within(select)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual([
      'On-screen only',
      'disconnected · Channel 1 · CC 106',
      'extra · Channel 2 · CC 104',
    ]),
  );
  fireEvent.change(screen.getByRole('combobox', { name: 'Tap note' }), {
    target: { value: 'eighth' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save switch' }));
  await waitFor(() =>
    expect(presetSwitchLayout).toHaveBeenCalledWith(
      '/api/v1/presets/switch-layout/rig/rig',
      {
        expected_revision: state.revision,
        layout: {
          version: 1,
          switches: [
            {
              ...state.layout.switches[0],
              input,
              action: { kind: 'tap_tempo', note: 'eighth' },
            },
          ],
        },
      },
    ),
  );
});
