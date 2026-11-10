import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { MidiMapScreen } from './MidiMapScreen';
import {
  applyMidiTemplate,
  libraryCatalog,
  midiAction,
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
  learnMidi: vi.fn(),
  midiAction: vi.fn(),
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
    navigation: update.navigation,
    saved_layouts: update.saved_layouts,
    extra_inputs: update.extra_inputs,
    entries: update.entries,
  }));
  vi.mocked(applyMidiTemplate).mockResolvedValue({
    ...map,
    revision: 'map-3',
    template: { scene_buttons: 4, first_controller: 16 },
  });
  vi.mocked(testMidi).mockResolvedValue();
  vi.mocked(midiAction).mockResolvedValue({ seq: 0, ok: true, message: '' });
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
  const user = userEvent.setup();
  arrange();
  render(
    <MidiMapScreen
      connected
      native={{ phase: 'stopped' } as AudioState}
      mixed={rig()}
      onMapApplied={vi.fn(async () => undefined)}
    />,
  );
  await user.click(await screen.findByLabelText('Scene button template'));
  await user.click(screen.getByRole('option', { name: '4 buttons' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save template' }));
  await waitFor(() =>
    expect(updateMidiMap).toHaveBeenCalledWith(
      expect.objectContaining({
        template: { scene_buttons: 4, first_controller: 16 },
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
  const user = userEvent.setup();
  arrange();
  render(
    <MidiMapScreen
      connected
      native={{ phase: 'stopped' } as AudioState}
      mixed={rig()}
      onMapApplied={vi.fn(async () => undefined)}
    />,
  );
  await user.click(await screen.findByLabelText('Copy MIDI mappings from'));
  await user.click(screen.getByRole('option', { name: 'Stage Rig' }));
  await user.click(screen.getByLabelText('Copy MIDI mappings to'));
  await user.click(screen.getByRole('option', { name: 'Clean Amp' }));
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

it('lists the previous messages from the ordered input log, newest first', async () => {
  arrange();
  const mixed = rig(3, { kind: 'program', channel: 1, program: 2 });
  (mixed.control!.midi as unknown as { recent: unknown }).recent = [
    { seq: 1, message: { kind: 'program', channel: 1, program: 0 } },
    { seq: 2, message: { kind: 'program', channel: 1, program: 1 } },
    { seq: 3, message: { kind: 'program', channel: 1, program: 2 } },
  ];
  render(
    <MidiMapScreen
      connected
      native={{ phase: 'stopped' } as AudioState}
      mixed={mixed}
      onMapApplied={vi.fn()}
    />,
  );
  const recent = await screen.findByRole('list', {
    name: 'Recent MIDI messages',
  });
  const items = within(recent).getAllByRole('listitem');
  expect(items).toHaveLength(2);
  expect(items[0]).toHaveTextContent('Program 2');
  expect(items[1]).toHaveTextContent('Program 1');
});

it('learns a device-wide Next preset trigger and keeps it through other edits', async () => {
  arrange();
  const view = render(
    <MidiMapScreen
      connected
      native={{ phase: 'stopped' } as AudioState}
      mixed={rig()}
      onMapApplied={vi.fn(async () => undefined)}
    />,
  );
  expect(
    await screen.findByRole('region', { name: 'Device controls' }),
  ).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: /Learn.*Next preset/ }));
  view.rerender(
    <MidiMapScreen
      connected
      native={{ phase: 'stopped' } as AudioState}
      mixed={rig(1, { kind: 'program', channel: 2, program: 3 })}
      onMapApplied={vi.fn(async () => undefined)}
    />,
  );
  await waitFor(() => expect(updateMidiMap).toHaveBeenCalled());
  expect(vi.mocked(updateMidiMap).mock.calls[0]![0].navigation).toEqual({
    next: { program: 3, controller: null },
  });
  // The stored trigger shows both the friendly and the raw MIDI number.
  expect(await screen.findByText('Program 4 · raw 3')).toBeVisible();
  // A later unrelated edit must carry it along rather than drop it.
  fireEvent.click(
    screen.getByRole('button', { name: /Clear.*Previous preset/ }),
  );
  expect(
    screen.getByRole('button', { name: /Clear.*Previous preset/ }),
  ).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: /Clear.*Next preset/ }));
  await waitFor(() => expect(updateMidiMap).toHaveBeenCalledTimes(2));
  expect(vi.mocked(updateMidiMap).mock.calls[1]![0].navigation).toEqual({
    next: null,
  });
});

it('shows why the last device-wide MIDI action did not run', async () => {
  arrange();
  vi.mocked(midiAction).mockResolvedValue({
    seq: 4,
    ok: false,
    message: 'Already at the last preset in the Set list',
  });
  render(
    <MidiMapScreen
      connected
      native={{ phase: 'stopped' } as AudioState}
      mixed={rig(2, { kind: 'program', channel: 2, program: 1 })}
      onMapApplied={vi.fn(async () => undefined)}
    />,
  );
  expect(
    await screen.findByText(
      'Last action: Already at the last preset in the Set list',
    ),
  ).toBeVisible();
});

function renderScreen(mixed = rig()) {
  return render(
    <MidiMapScreen
      connected
      native={{ phase: 'stopped' } as AudioState}
      mixed={mixed}
      onMapApplied={vi.fn(async () => undefined)}
    />,
  );
}

it('saves a starting layout without touching preset mappings and shows each switch', async () => {
  const user = userEvent.setup();
  arrange();
  renderScreen();
  const setup = await screen.findByRole('region', { name: 'Controller setup' });
  // Chocolate is first: A–D send Program Change; E/F are the pedal's own bank.
  const switches = within(setup).getByRole('list', {
    name: 'What each switch does',
  });
  expect(within(switches).getAllByRole('listitem')).toHaveLength(4);
  expect(setup).toHaveTextContent('CC 2 and CC 3');
  await user.click(within(setup).getByRole('radio', { name: /Two presets/ }));
  await user.click(within(setup).getByRole('button', { name: 'Save layout' }));
  await waitFor(() => expect(updateMidiMap).toHaveBeenCalled());
  const sent = vi.mocked(updateMidiMap).mock.calls[0]![0];
  expect(sent.navigation).toEqual({
    previous: { program: 2, controller: null },
    next: { program: 3, controller: null },
  });
  expect(sent.entries).toEqual(map.entries);
});

it('applies a chosen layout to an existing preset after previewing replacement', async () => {
  const user = userEvent.setup();
  arrange();
  renderScreen();
  const setup = await screen.findByRole('region', { name: 'Controller setup' });
  await user.click(within(setup).getByLabelText('Controller profile'));
  await user.click(screen.getByRole('option', { name: 'Generic controller' }));
  await user.click(within(setup).getByLabelText('Existing preset for layout'));
  await user.click(
    screen.getByRole('option', { name: 'Stage Rig · 2 mappings' }),
  );
  await user.click(
    within(setup).getByRole('button', { name: 'Apply layout to preset' }),
  );
  const replace = within(setup).getByRole('button', {
    name: 'Replace 2 mappings',
  });
  expect(applyMidiTemplate).not.toHaveBeenCalled();
  await user.click(replace);
  await waitFor(() => expect(updateMidiMap).toHaveBeenCalledTimes(1));
  expect(updateMidiMap).toHaveBeenCalledWith(
    expect.objectContaining({
      template: { scene_buttons: 4, first_controller: 16 },
      entries: map.entries,
    }),
  );
  await waitFor(() =>
    expect(applyMidiTemplate).toHaveBeenCalledWith({
      expected_revision: 'map-2',
      entry: { kind: 'rig', id: id('a') },
    }),
  );
});

it('refuses a layout whose numbers an existing preset mapping already uses', async () => {
  const user = userEvent.setup();
  arrange();
  vi.mocked(midiMap).mockResolvedValue({
    ...map,
    entries: [
      {
        ...map.entries[0]!,
        bindings: [{ scene: 'lead', program: 2, controller: null }],
      },
    ],
  });
  renderScreen();
  const setup = await screen.findByRole('region', { name: 'Controller setup' });
  await user.click(within(setup).getByRole('radio', { name: /Two presets/ }));
  expect(within(setup).getByRole('alert')).toHaveTextContent(
    'Program 3 · Stage Rig',
  );
  expect(
    within(setup).getByRole('button', { name: 'Save layout' }),
  ).toBeDisabled();
});

it('undoes and clears with a count, through revision-checked saves', async () => {
  const user = userEvent.setup();
  arrange();
  renderScreen();
  await screen.findByRole('region', { name: 'Controller setup' });
  expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();
  await user.click(screen.getByRole('button', { name: 'Clear all…' }));
  const confirm = screen.getByRole('region', {
    name: 'Confirm clearing all mappings',
  });
  expect(confirm).toHaveTextContent('Clear 2 mappings in 1 preset?');
  await user.click(
    within(confirm).getByRole('button', { name: 'Clear mappings' }),
  );
  await waitFor(() => expect(updateMidiMap).toHaveBeenCalledTimes(1));
  expect(vi.mocked(updateMidiMap).mock.calls[0]![0].entries).toEqual([]);
  expect(vi.mocked(updateMidiMap).mock.calls[0]![0].expected_revision).toBe(
    'map-1',
  );
  await user.click(await screen.findByRole('button', { name: 'Undo' }));
  await waitFor(() => expect(updateMidiMap).toHaveBeenCalledTimes(2));
  const restore = vi.mocked(updateMidiMap).mock.calls[1]![0];
  // The restore is based on the newest revision, so a concurrent edit conflicts.
  expect(restore.expected_revision).toBe('map-2');
  expect(restore.entries).toEqual(map.entries);
  expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();
});

it('learns a Mute trigger and shows it beside Previous and Next', async () => {
  arrange();
  const view = render(
    <MidiMapScreen
      connected
      native={{ phase: 'stopped' } as AudioState}
      mixed={rig()}
      onMapApplied={vi.fn(async () => undefined)}
    />,
  );
  fireEvent.click(
    await screen.findByRole('button', { name: /Learn.*Mute output/ }),
  );
  view.rerender(
    <MidiMapScreen
      connected
      native={{ phase: 'stopped' } as AudioState}
      mixed={rig(1, {
        kind: 'control',
        channel: 2,
        controller: 22,
        value: 127,
      })}
      onMapApplied={vi.fn(async () => undefined)}
    />,
  );
  await waitFor(() => expect(updateMidiMap).toHaveBeenCalled());
  expect(vi.mocked(updateMidiMap).mock.calls[0]![0].navigation).toEqual({
    mute: { program: null, controller: 22 },
  });
  expect(await screen.findByText('CC 22 · press')).toBeVisible();
});

it('learns a global Tuner trigger', async () => {
  arrange();
  const view = render(
    <MidiMapScreen
      connected
      native={{ phase: 'stopped' } as AudioState}
      mixed={rig()}
      onMapApplied={vi.fn(async () => undefined)}
    />,
  );
  fireEvent.click(await screen.findByRole('button', { name: /Learn.*Tuner/ }));
  view.rerender(
    <MidiMapScreen
      connected
      native={{ phase: 'stopped' } as AudioState}
      mixed={rig(1, {
        kind: 'control',
        channel: 2,
        controller: 23,
        value: 127,
      })}
      onMapApplied={vi.fn(async () => undefined)}
    />,
  );
  await waitFor(() => expect(updateMidiMap).toHaveBeenCalled());
  expect(vi.mocked(updateMidiMap).mock.calls[0]![0].navigation).toEqual({
    tuner: { program: null, controller: 23 },
  });
  expect(await screen.findByText('CC 23 · press')).toBeVisible();
});

it('disables an assignment without losing it and enables it again', async () => {
  const user = userEvent.setup();
  arrange();
  renderScreen();
  await user.click(
    await screen.findByRole('button', { name: /Disable.*Scene · Lead/ }),
  );
  await waitFor(() => expect(updateMidiMap).toHaveBeenCalledTimes(1));
  const sent = vi.mocked(updateMidiMap).mock.calls[0]![0].entries[0]!;
  expect(sent.bindings).toHaveLength(1);
  expect(sent.disabled).toEqual([
    { kind: 'scene', program: 0, controller: null },
  ]);
  // The row stays, marked off, and cannot be tested while it does nothing.
  expect(await screen.findByText('Disabled')).toBeVisible();
  expect(
    screen.getByRole('button', { name: /Test.*Scene · Lead/ }),
  ).toBeDisabled();
  await user.click(
    screen.getByRole('button', { name: /Enable.*Scene · Lead/ }),
  );
  await waitFor(() => expect(updateMidiMap).toHaveBeenCalledTimes(2));
  expect(
    vi.mocked(updateMidiMap).mock.calls[1]![0].entries[0]!.disabled,
  ).toEqual([]);
});

it('saves, duplicates, applies and deletes a named layout', async () => {
  const user = userEvent.setup();
  arrange();
  vi.mocked(midiMap).mockResolvedValue({
    ...map,
    template: { scene_buttons: 4, first_controller: 16 },
    navigation: { next: { program: 3, controller: null } },
  });
  renderScreen();
  const setup = await screen.findByRole('region', { name: 'Controller setup' });
  await user.type(within(setup).getByLabelText('Layout name'), 'Stage Setup');
  await user.click(
    within(setup).getByRole('button', { name: 'Save current as layout' }),
  );
  await waitFor(() => expect(updateMidiMap).toHaveBeenCalledTimes(1));
  const saved = vi.mocked(updateMidiMap).mock.calls[0]![0].saved_layouts!;
  expect(saved).toEqual([
    {
      id: 'stage-setup',
      name: 'Stage Setup',
      profile: 'chocolate',
      template: { scene_buttons: 4, first_controller: 16 },
      navigation: { next: { program: 3, controller: null } },
    },
  ]);
  expect(
    await within(setup).findByText('Stage Setup', { selector: 'strong' }),
  ).toBeVisible();
  expect(setup).toHaveTextContent(
    '4 scene buttons · CC 16–19 · Next Program 4',
  );
  await user.click(
    within(setup).getByRole('button', { name: /Duplicate Stage Setup/ }),
  );
  await waitFor(() => expect(updateMidiMap).toHaveBeenCalledTimes(2));
  const two = vi.mocked(updateMidiMap).mock.calls[1]![0].saved_layouts!;
  expect(two.map((l) => [l.id, l.name])).toEqual([
    ['stage-setup', 'Stage Setup'],
    ['copy-of-stage-setup', 'Copy of Stage Setup'],
  ]);
  expect(two[1]!.navigation).toEqual(two[0]!.navigation);
  await user.click(
    within(setup).getByRole('button', { name: /Delete Copy of Stage Setup/ }),
  );
  await waitFor(() => expect(updateMidiMap).toHaveBeenCalledTimes(3));
  expect(
    vi.mocked(updateMidiMap).mock.calls[2]![0].saved_layouts!.map((l) => l.id),
  ).toEqual(['stage-setup']);
});

it('opens the same editor from a switch in the controller view', async () => {
  const user = userEvent.setup();
  arrange();
  const view = renderScreen();
  const setup = await screen.findByRole('region', { name: 'Controller setup' });
  await user.click(within(setup).getByRole('radio', { name: /Two presets/ }));
  await user.click(
    within(setup).getByRole('button', { name: /D.*Next preset/ }),
  );
  expect(setup).toHaveTextContent(
    'D sends Program 4 (raw 3) and runs Next preset.',
  );
  await user.click(
    within(setup).getByRole('button', {
      name: 'Learn another switch for Next preset',
    }),
  );
  // The device section is now listening for that same trigger.
  expect(screen.getByText('Press the switch…')).toBeVisible();
  view.rerender(
    <MidiMapScreen
      connected
      native={{ phase: 'stopped' } as AudioState}
      mixed={rig(1, { kind: 'program', channel: 2, program: 6 })}
      onMapApplied={vi.fn(async () => undefined)}
    />,
  );
  await waitFor(() => expect(updateMidiMap).toHaveBeenCalled());
  expect(vi.mocked(updateMidiMap).mock.calls[0]![0].navigation).toEqual({
    next: { program: 6, controller: null },
  });
  // A preset switch has no device trigger: it points at the mappings instead.
  await user.click(
    within(setup).getByRole('button', { name: /A.*Set-list preset 1/ }),
  );
  expect(
    within(setup).getByRole('button', { name: 'Show in mappings' }),
  ).toBeVisible();
});

it('adds a second controller explicitly, with its own channel, and removes it again', async () => {
  const user = userEvent.setup();
  arrange();
  vi.mocked(midiDevices).mockResolvedValue({
    available: true,
    inputs: [
      { id: 'hw:Controller,0,0', name: 'Controller' },
      { id: 'hw:Captain,0,0', name: 'Captain' },
    ],
    warnings: [],
  });
  renderScreen();
  const extra = await screen.findByRole('region', {
    name: 'Additional controllers',
  });
  // Nothing is listened to until it is added.
  expect(within(extra).queryByText(/Controller 2/)).toBeNull();
  await user.click(
    within(extra).getByRole('button', { name: 'Add controller' }),
  );
  await waitFor(() => expect(updateMidiMap).toHaveBeenCalledTimes(1));
  expect(vi.mocked(updateMidiMap).mock.calls[0]![0].extra_inputs).toEqual([
    { input: 'hw:Captain,0,0', channel: 1 },
  ]);
  // Both devices are now in use, so there is nothing left to add.
  await waitFor(() =>
    expect(
      within(extra).getByRole('button', { name: 'Add controller' }),
    ).toBeDisabled(),
  );
  expect(within(extra).getByText('Not connected')).toBeVisible();
  expect(
    within(extra).getByRole('combobox', { name: 'Learn from controller' }),
  ).toBeVisible();
  await user.click(
    within(extra).getByRole('button', { name: /Remove controller 2/ }),
  );
  await waitFor(() => expect(updateMidiMap).toHaveBeenCalledTimes(2));
  expect(vi.mocked(updateMidiMap).mock.calls[1]![0].extra_inputs).toEqual([]);
});
