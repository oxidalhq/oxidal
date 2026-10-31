import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { MidiMapScreen } from './MidiMapScreen';
import {
  applyMidiTemplate,
  libraryCatalog,
  midiDevices,
  midiMap,
  testMidi,
  updateMidiMap,
  type AudioState,
  type LibraryCatalog,
  type MidiMap,
  type RigAudioState,
} from './api';

vi.mock('./api', () => ({
  applyMidiTemplate: vi.fn(),
  libraryCatalog: vi.fn(),
  midiDevices: vi.fn(),
  midiMap: vi.fn(),
  testMidi: vi.fn(),
  updateMidiMap: vi.fn(),
}));

const id = (letter: string) => letter.repeat(64);
const catalog: LibraryCatalog = {
  revision: 'catalog-1',
  items: [
    {
      kind: 'rig',
      id: id('a'),
      name: 'Stage Rig',
      source_name: 'Stage Rig',
      origin: 'mine',
      archived: false,
    },
    {
      kind: 'owned',
      id: id('b'),
      name: 'Clean Amp',
      source_name: 'Clean Amp',
      origin: 'mine',
      archived: false,
    },
  ],
};
const map: MidiMap = {
  revision: 'map-1',
  input: 'hw:Controller,0,0',
  channel: 2,
  entries: [
    {
      entry: { kind: 'rig', id: id('a') },
      bindings: [{ scene: 'lead', program: 0, controller: null }],
      branch_bindings: [{ branch: 'hold', controller: 20, mode: 'toggle' }],
      parameter_bindings: [],
    },
  ],
};

function rig(events = 0, last: unknown = null): RigAudioState {
  return {
    phase: 'running',
    configured: { revision: id('a') },
    control: {
      midi: { connected: true, events, last, error: null },
      scenes: {
        fade_ms: 50,
        scenes: [{ id: 'lead', name: 'Lead', gains: [] }],
        branches: [],
      },
      branches: [{ id: 'hold', name: 'Hold', enabled: false, partial: false }],
      controls: [],
    },
  } as unknown as RigAudioState;
}

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

function arrange() {
  vi.mocked(midiMap).mockResolvedValue(map);
  vi.mocked(libraryCatalog).mockResolvedValue(catalog);
  vi.mocked(midiDevices).mockResolvedValue({
    available: true,
    inputs: [{ id: 'hw:Controller,0,0', name: 'Controller' }],
    warnings: [],
  });
  vi.mocked(updateMidiMap).mockImplementation(async (update) => ({
    revision: 'map-2',
    input: update.input,
    channel: update.channel,
    template: update.template,
    entries: update.entries,
  }));
  vi.mocked(applyMidiTemplate).mockResolvedValue({
    ...map,
    revision: 'map-3',
    template: { scene_buttons: 4, first_controller: 40 },
  });
  vi.mocked(testMidi).mockResolvedValue();
}

it('shows the whole hierarchy, live message, number search and precedence conflict', async () => {
  arrange();
  render(
    <MidiMapScreen
      connected
      native={{ phase: 'stopped' } as AudioState}
      mixed={rig(4, {
        kind: 'control',
        channel: 2,
        controller: 20,
        value: 127,
      })}
      onMapApplied={vi.fn()}
    />,
  );
  expect(
    await screen.findByRole('heading', { name: 'Stage Rig' }),
  ).toBeVisible();
  expect(screen.getAllByText('Scene · Lead')[0]).toBeVisible();
  expect(screen.getAllByText('Switch · Hold')[0]).toBeVisible();
  expect(screen.getByLabelText('Last MIDI message')).toHaveTextContent(
    'CC 20 · value 127',
  );
  expect(screen.getAllByText('Conflict').length).toBeGreaterThan(0);

  fireEvent.change(screen.getByPlaceholderText('Find preset, Program or CC…'), {
    target: { value: 'CC 20' },
  });
  expect(screen.getByRole('heading', { name: 'Stage Rig' })).toBeVisible();
  expect(
    screen.queryByRole('heading', { name: 'Clean Amp' }),
  ).not.toBeInTheDocument();
});

it('learns a fresh message on a row and tests through the hardware-free path', async () => {
  arrange();
  const applied = vi.fn(async () => undefined);
  const view = render(
    <MidiMapScreen
      connected
      native={{ phase: 'stopped' } as AudioState}
      mixed={rig()}
      onMapApplied={applied}
    />,
  );
  fireEvent.click(
    await screen.findByRole('button', { name: /Learn.*Scene · Lead/ }),
  );
  view.rerender(
    <MidiMapScreen
      connected
      native={{ phase: 'stopped' } as AudioState}
      mixed={rig(1, {
        kind: 'control',
        channel: 2,
        controller: 42,
        value: 127,
      })}
      onMapApplied={applied}
    />,
  );
  await waitFor(() => expect(updateMidiMap).toHaveBeenCalled());
  expect(
    vi.mocked(updateMidiMap).mock.calls[0]![0].entries[0]!.bindings[0],
  ).toMatchObject({ program: null, controller: 42 });
  expect(applied).toHaveBeenCalled();

  fireEvent.click(screen.getByRole('button', { name: /Test.*Scene · Lead/ }));
  await waitFor(() =>
    expect(testMidi).toHaveBeenCalledWith({
      entry: { kind: 'rig', id: id('a') },
      message: {
        kind: 'control',
        channel: 2,
        controller: 42,
        value: 127,
      },
    }),
  );
});

it('saves and applies a scene-button template without hardware', async () => {
  arrange();
  render(
    <MidiMapScreen
      connected
      native={{ phase: 'stopped' } as AudioState}
      mixed={rig()}
      onMapApplied={vi.fn(async () => undefined)}
    />,
  );
  fireEvent.change(await screen.findByLabelText('Scene button template'), {
    target: { value: '4' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save template' }));
  await waitFor(() =>
    expect(updateMidiMap).toHaveBeenCalledWith(
      expect.objectContaining({
        template: { scene_buttons: 4, first_controller: 40 },
      }),
    ),
  );
  fireEvent.click(
    await screen.findByRole('button', { name: 'Apply template' }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Replace mappings' }));
  await waitFor(() =>
    expect(applyMidiTemplate).toHaveBeenCalledWith({
      expected_revision: 'map-2',
      entry: { kind: 'rig', id: id('a') },
    }),
  );
});

it('copies and preview-confirms clearing a preset map', async () => {
  arrange();
  render(
    <MidiMapScreen
      connected
      native={{ phase: 'stopped' } as AudioState}
      mixed={rig()}
      onMapApplied={vi.fn(async () => undefined)}
    />,
  );
  fireEvent.change(await screen.findByLabelText('Copy MIDI mappings from'), {
    target: { value: `rig:${id('a')}` },
  });
  fireEvent.change(screen.getByLabelText('Copy MIDI mappings to'), {
    target: { value: `owned:${id('b')}` },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Copy mappings' }));
  await waitFor(() =>
    expect(updateMidiMap).toHaveBeenCalledWith(
      expect.objectContaining({
        entries: expect.arrayContaining([
          expect.objectContaining({
            entry: { kind: 'owned', id: id('b') },
          }),
        ]),
      }),
    ),
  );

  fireEvent.click(screen.getAllByRole('button', { name: 'Clear' })[0]!);
  expect(screen.getByRole('button', { name: 'Clear mappings' })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Clear mappings' }));
  await waitFor(() => expect(updateMidiMap).toHaveBeenCalledTimes(2));
  expect(vi.mocked(updateMidiMap).mock.calls[1]![0].entries).not.toEqual(
    expect.arrayContaining([
      expect.objectContaining({ entry: { kind: 'rig', id: id('a') } }),
    ]),
  );
});
