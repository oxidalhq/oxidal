import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import {
  libraryCatalog,
  nativeState,
  presetDetails,
  presetLibrary,
  rigLibrary,
} from './api';
import { allFactoryRecipes } from './factoryCatalog';
import {
  saveReadySound,
  unsavedReadySounds,
} from './features/library/oxidal/readySounds';
import { choiceSummary } from './presetChoices';
import {
  assertAuditionOwner,
  confirmedControlDisplay,
  controlGroup,
  movedBlockOrder,
} from './rigControls';
import { RigPresetSelector } from './RigPresetSelector';
vi.mock('./features/library/oxidal/readySounds', () => ({
  unsavedReadySounds: vi.fn().mockResolvedValue([]),
  saveReadySound: vi.fn(),
}));
vi.mock('./api', () => ({
  nativeState: vi.fn(),
  presetLibrary: vi.fn(),
  rigLibrary: vi.fn(),
  presetDetails: vi.fn().mockResolvedValue({ revision: 'empty', entries: [] }),
  libraryCatalog: vi.fn(),
}));
// jsdom has no modal dialog; the picker list opens in one.
HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
  this.open = true;
};
HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
  this.open = false;
};
beforeEach(() => {
  vi.mocked(presetDetails).mockResolvedValue({
    revision: 'empty',
    entries: [],
  });
  vi.mocked(libraryCatalog).mockResolvedValue({ revision: 'empty', items: [] });
  vi.mocked(unsavedReadySounds).mockResolvedValue([]);
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
const state = { key: 'original:a', name: 'Amp A', modified: false };
const tone = (id: string, owned: boolean) =>
  expect.objectContaining({ kind: 'tone3000', id, owned });
function library() {
  vi.mocked(libraryCatalog).mockResolvedValue({ revision: 'empty', items: [] });
  vi.mocked(rigLibrary).mockResolvedValue({
    presets: [],
    native_profile: 'tone3000-plugin:test',
  });
  vi.mocked(presetLibrary).mockResolvedValue([
    { sha256: 'a', name: 'Amp A' },
    { sha256: 'b', name: 'Amp B' },
  ] as Awaited<ReturnType<typeof presetLibrary>>);
  vi.mocked(nativeState).mockResolvedValue({
    owned: [{ id: 'a', preset: { name: 'My A' } }],
  } as Awaited<ReturnType<typeof nativeState>>);
}
it('selects original and owned identities without optimistically changing the sounding preset', async () => {
  library();
  const select = vi.fn();
  const view = render(
    <RigPresetSelector current={state} disabled={false} onSelect={select} />,
  );
  const picker = screen.getByRole('button', {
    name: 'Playing preset: Amp A',
  });
  await waitFor(() => expect(picker).toBeEnabled());
  const next = screen.getByRole('button', { name: 'Next preset: Amp B' });
  expect(
    screen.getByRole('button', { name: 'Previous preset' }),
  ).toBeDisabled();
  fireEvent.click(next);
  expect(select).toHaveBeenCalledWith(tone('b', false));
  expect(picker).toHaveAccessibleName('Playing preset: Amp A');
  select.mockClear();
  fireEvent.click(picker);
  // Opens on the playing preset's source; every row has one summary form.
  expect(screen.getByRole('tab', { name: /TONE3000/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  expect(
    screen.getByRole('button', { name: /^Amp A\s*Playing · NAM chain$/ }),
  ).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByText(/editing one saves a copy/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab', { name: /Mine/ }));
  fireEvent.click(screen.getByRole('button', { name: /^My A\s*NAM chain$/ }));
  expect(select).toHaveBeenCalledWith(tone('a', true));
  expect(picker).toHaveAccessibleName('Playing preset: Amp A');
  fireEvent.click(picker);
  fireEvent.change(screen.getByRole('searchbox', { name: 'Find a preset' }), {
    target: { value: 'b' },
  });
  // Search covers every source and names the source of each hit.
  expect(screen.queryByRole('tab', { name: /Mine/ })).toBeNull();
  expect(
    screen.queryByRole('button', { name: /^My A/ }),
  ).not.toBeInTheDocument();
  fireEvent.click(
    screen.getByRole('button', { name: /^Amp B\s*NAM chain · TONE3000$/ }),
  );
  expect(select).toHaveBeenLastCalledWith(tone('b', false));
  view.rerender(
    <RigPresetSelector current={state} disabled onSelect={select} />,
  );
  expect(picker).toBeDisabled();
});
it('scrolls the playing preset into view once per opening, not on every redraw', async () => {
  library();
  const scroll = vi.fn();
  const original = HTMLElement.prototype.scrollIntoView;
  HTMLElement.prototype.scrollIntoView = scroll;
  try {
    const select = vi.fn();
    const view = render(
      <RigPresetSelector current={state} disabled={false} onSelect={select} />,
    );
    const picker = screen.getByRole('button', {
      name: 'Playing preset: Amp A',
    });
    await waitFor(() => expect(picker).toBeEnabled());
    fireEvent.click(picker);
    expect(scroll).toHaveBeenCalledTimes(1);
    // The rig view redraws while audio runs; the open list must stay put.
    for (let i = 0; i < 5; i++)
      view.rerender(
        <RigPresetSelector
          current={{ ...state }}
          disabled={false}
          onSelect={select}
        />,
      );
    expect(scroll).toHaveBeenCalledTimes(1);
  } finally {
    HTMLElement.prototype.scrollIntoView = original;
  }
});
it('keeps the current rig visible when the library fails, and permits retry', async () => {
  vi.mocked(presetLibrary).mockRejectedValue(new Error('offline'));
  vi.mocked(rigLibrary).mockResolvedValue({
    presets: [],
    native_profile: 'tone3000-plugin:test',
  });
  vi.mocked(nativeState).mockResolvedValue({
    owned: [],
    block_controls: [],
    can_redo: false,
    can_undo: false,
    dirty: false,
    live_audio: false,
    parameters: [],
    revision: 0,
    session: 'test',
    state_captures: 0,
  });
  render(
    <RigPresetSelector current={state} disabled={false} onSelect={() => {}} />,
  );
  await screen.findByText('Some presets are unavailable (originals)');
  const picker = screen.getByRole('button', { name: 'Playing preset: Amp A' });
  library();
  fireEvent.click(screen.getByRole('button', { name: 'Retry presets' }));
  await waitFor(() =>
    expect(
      screen.queryByText('Some presets are unavailable (originals)'),
    ).toBeNull(),
  );
  fireEvent.click(picker);
  expect(
    screen.getByRole('button', { name: /^Amp B\s*NAM chain$/ }),
  ).toBeEnabled();
});
it('groups imaging separately and never substitutes normalized percentages for physical readback', () => {
  for (const id of [
    'alignOffset',
    'chainPanLeft',
    'chainInvertRight',
    'spreadEnabled',
    'outputBalance',
  ])
    expect(controlGroup(id)).toBe('stereo');
  expect(controlGroup('pitchSemitones')).toBe('pitch');
  expect(controlGroup('gateThreshold')).toBe('gate');
  expect(controlGroup('toneBass')).toBe('tone');
  expect(confirmedControlDisplay('-12.0 st', true)).toBe('-12.0 st · updating');
  expect(confirmedControlDisplay('2.5 dB', false)).toBe('2.5 dB');
});

it('reorders actual chain models without dropping or moving insertion slots', () => {
  const blocks = [
    { id: 'amp', insert: false },
    { id: 'slot', insert: true },
    { id: 'cab', insert: false },
  ];
  expect(movedBlockOrder(blocks, 'amp', 1)).toEqual(['cab', 'slot', 'amp']);
  expect(movedBlockOrder(blocks, 'cab', -1)).toEqual(['cab', 'slot', 'amp']);
  expect(movedBlockOrder(blocks, 'amp', -1)).toBeNull();
  expect(movedBlockOrder(blocks, 'missing', 1)).toBeNull();
  expect(movedBlockOrder(blocks, 'slot', 1)).toBeNull();
});

it('uses the same authoritative recall from performance pads and preserves owned identity', async () => {
  library();
  vi.mocked(nativeState).mockResolvedValue({
    owned: [
      { id: 'a', preset: { name: 'My A' } },
      { id: 'b', preset: { name: 'My B' } },
    ],
  } as Awaited<ReturnType<typeof nativeState>>);
  const select = vi.fn();
  render(
    <RigPresetSelector
      current={{ key: 'copy:a', name: 'My A', modified: false }}
      disabled={false}
      onSelect={select}
      pads
    />,
  );
  const playing = await screen.findByRole('button', { name: /My A.*Playing/ });
  expect(playing).toBeDisabled();
  expect(playing).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(screen.getByRole('button', { name: /My B.*Next/ }));
  expect(select).toHaveBeenCalledWith(tone('b', true));
  expect(playing).toHaveAttribute('aria-pressed', 'true');
  // Fewer than eight presets need no bank paging.
  expect(
    screen.queryByRole('button', { name: 'Next bank' }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Next preset: My B' }));
  expect(select).toHaveBeenLastCalledWith(tone('b', true));
});

it('opens Mine gig pads on the playing bank and keeps playing identity during initial loading', async () => {
  library();
  vi.mocked(nativeState).mockResolvedValue({
    owned: Array.from({ length: 12 }, (_, i) => ({
      id: String(i),
      preset: { name: `Tone ${i}` },
    })),
  } as unknown as Awaited<ReturnType<typeof nativeState>>);
  vi.mocked(presetLibrary).mockResolvedValue(
    Array.from({ length: 12 }, (_, i) => ({
      sha256: String(i),
      name: `Original ${i}`,
    })) as Awaited<ReturnType<typeof presetLibrary>>,
  );
  const playing = { key: 'copy:10', name: 'Tone 10', modified: false };
  const view = render(
    <RigPresetSelector
      current={playing}
      disabled={false}
      onSelect={() => {}}
    />,
  );
  expect(
    screen.getByRole('button', { name: 'Playing preset: Tone 10' }),
  ).toBeInTheDocument();
  view.rerender(
    <RigPresetSelector
      current={playing}
      disabled={false}
      onSelect={() => {}}
      pads
    />,
  );
  const active = await screen.findByRole('button', { name: /Tone 10/ });
  expect(active).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByText('2 / 2')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Previous bank' }));
  expect(screen.getByText('1 / 2')).toBeInTheDocument();
});

it('allows repeat audition only after its own terminal receipt and rejects a changed session', () => {
  const opening = { session: 'a', revision: 1 };
  expect(() =>
    assertAuditionOwner(opening, opening, undefined, null),
  ).not.toThrow();
  expect(() =>
    assertAuditionOwner(opening, { ...opening, revision: 2 }, undefined, null),
  ).toThrow(/target changed/);
  for (const phase of ['applied', 'failed', 'cancelled'])
    expect(() =>
      assertAuditionOwner(opening, { ...opening, revision: 5 }, 7, {
        request: 7,
        phase,
      }),
    ).not.toThrow();
  expect(() =>
    assertAuditionOwner(opening, { session: 'b', revision: 5 }, 7, {
      request: 7,
      phase: 'applied',
    }),
  ).toThrow();
  expect(() =>
    assertAuditionOwner(opening, { ...opening, revision: 5 }, 7, {
      request: 8,
      phase: 'applied',
    }),
  ).toThrow();
  expect(() =>
    assertAuditionOwner(opening, { ...opening, revision: 5 }, 7, {
      request: 7,
      phase: 'applying',
    }),
  ).toThrow();
});

it('keeps available originals selectable when saved copies cannot be read', async () => {
  library();
  vi.mocked(nativeState).mockRejectedValue(new Error('worker offline'));
  const select = vi.fn();
  render(
    <RigPresetSelector current={state} disabled={false} onSelect={select} />,
  );
  await screen.findByText('Some presets are unavailable (saved copies)');
  fireEvent.click(
    screen.getByRole('button', { name: 'Playing preset: Amp A' }),
  );
  fireEvent.click(screen.getByRole('button', { name: /^Amp B\s*NAM chain$/ }));
  expect(select).toHaveBeenCalledWith(tone('b', false));
});
it('keeps saved copies selectable when originals cannot be read', async () => {
  library();
  vi.mocked(presetLibrary).mockRejectedValue(new Error('storage unavailable'));
  const select = vi.fn();
  render(
    <RigPresetSelector current={state} disabled={false} onSelect={select} />,
  );
  await screen.findByText('Some presets are unavailable (originals)');
  fireEvent.click(
    screen.getByRole('button', { name: 'Playing preset: Amp A' }),
  );
  fireEvent.click(screen.getByRole('button', { name: /^My A\s*NAM chain$/ }));
  expect(select).toHaveBeenCalledWith(tone('a', true));
});

it('lists presets with scenes first, tagged by scene count, and plays them as one choice', async () => {
  library();
  const revision = 'f'.repeat(64);
  vi.mocked(rigLibrary).mockResolvedValue({
    presets: [
      {
        revision,
        id: 'clean-to-heavy',
        name: 'Clean to heavy',
        origin: 'mine',
        native_instances: 3,
        lv2_instances: 0,
        topology: 'scenes',
        scenes: ['Clean', 'Crunch', 'Heavy'],
      },
    ],
    native_profile: 'tone3000-plugin:test',
  });
  // The rig is in the Library set list; set-list rows carry their number.
  vi.mocked(libraryCatalog).mockResolvedValue({
    revision: 'set-one',
    items: [
      {
        kind: 'rig',
        id: revision,
        name: 'Clean to heavy',
        source_name: 'Clean to heavy',
        archived: false,
        origin: 'mine',
        in_set_list: true,
      },
    ],
  });
  const select = vi.fn();
  render(
    <RigPresetSelector current={state} disabled={false} onSelect={select} />,
  );
  const picker = screen.getByRole('button', { name: 'Playing preset: Amp A' });
  await waitFor(() => expect(picker).toBeEnabled());
  fireEvent.click(picker);
  expect(
    screen.getAllByRole('tab').map((t) => t.textContent?.replace(/\s+/g, ' ')),
  ).toEqual(['Set list 1', 'Mine 2', 'Oxidal sounds 0', 'TONE3000 2']);
  fireEvent.click(screen.getByRole('tab', { name: /Set list/ }));
  const row = screen.getByRole('button', {
    name: /^Clean to heavy\s*3 scenes · 3 NAM$/,
  });
  // Set-list rows carry their number; zero counts are not listed.
  expect(row.closest('li')).toHaveTextContent(/^1Clean to heavy/);
  fireEvent.click(row);
  expect(select).toHaveBeenCalledWith(
    expect.objectContaining({ kind: 'scenes', revision }),
  );
});

it('renames from the rig header and refreshes its device label without recalling audio', async () => {
  library();
  const select = vi.fn();
  const item = {
    kind: 'original' as const,
    id: 'a',
    name: 'Amp A',
    source_name: 'Amp A',
    archived: false,
  };
  vi.mocked(libraryCatalog).mockResolvedValue({
    revision: 'labels-one',
    items: [item],
  });
  render(
    <RigPresetSelector current={state} disabled={false} onSelect={select} />,
  );
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Playing preset: Amp A' }),
    ).toBeEnabled(),
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Playing preset: Amp A' }),
  );
  // Manage lives in the playing preset's Details.
  fireEvent.click(
    await screen.findByRole('button', { name: 'Details: Amp A' }),
  );
  fireEvent.click(
    await screen.findByRole('button', { name: 'Manage preset: Amp A' }),
  );
  const name = await screen.findByRole('textbox', {
    name: 'Name on this device',
  });
  await waitFor(() => expect(name).toBeEnabled());
  vi.mocked(presetLibrary).mockResolvedValue([
    { sha256: 'a', name: 'My new label' },
  ] as Awaited<ReturnType<typeof presetLibrary>>);
  vi.mocked(libraryCatalog).mockResolvedValue({
    revision: 'labels-two',
    items: [{ ...item, name: 'My new label' }],
  });
  fireEvent.change(name, { target: { value: 'My new label' } });
  fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
  await waitFor(() =>
    expect(
      screen.getByRole('button', {
        name: 'Playing preset: My new label',
        hidden: true,
      }),
    ).toBeInTheDocument(),
  );
  expect(select).not.toHaveBeenCalled();
  expect(libraryCatalog).toHaveBeenCalledWith({
    expected_revision: 'labels-one',
    entry_kind: 'original',
    id: 'a',
    action: { kind: 'rename', name: 'My new label' },
  });
});

it('searches descriptions and opens preset details without recalling it', async () => {
  library();
  vi.mocked(presetDetails).mockResolvedValue({
    revision: 'details-one',
    entries: [
      {
        entry: { kind: 'original', id: 'b' },
        details: {
          description: 'Use a neck pickup',
          categories: ['Ambient'],
          copied_from: null,
        },
      },
    ],
  });
  const select = vi.fn();
  render(
    <RigPresetSelector current={state} disabled={false} onSelect={select} />,
  );
  const trigger = screen.getByRole('button', { name: 'Playing preset: Amp A' });
  await waitFor(() => expect(trigger).toBeEnabled());
  fireEvent.click(trigger);
  fireEvent.change(
    await screen.findByRole('searchbox', { name: 'Find a preset' }),
    { target: { value: 'neck pickup' } },
  );
  const detail = await screen.findByRole('button', { name: 'Details: Amp B' });
  fireEvent.click(detail);
  await screen.findByText('Use a neck pickup');
  expect(
    screen.queryByRole('dialog', { name: 'Choose a preset' }),
  ).not.toBeInTheDocument();
  expect(select).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }));
  expect(
    screen.getByRole('dialog', { name: 'Choose a preset' }),
  ).toBeInTheDocument();
});

it('summarises every preset in one form with zero counts left out', () => {
  const rig = (
    topology: 'serial' | 'parallel' | 'scenes',
    nativeInstances: number,
    lv2Instances: number,
    scenes: string[] = [],
  ) =>
    choiceSummary({
      kind: 'scenes',
      origin: 'mine',
      revision: 'r',
      name: 'x',
      scenes,
      topology,
      nativeInstances,
      lv2Instances,
    });
  expect(rig('serial', 1, 1)).toBe('Serial · NAM + 1 fx');
  expect(rig('parallel', 2, 0)).toBe('Parallel paths · 2 NAM');
  expect(rig('scenes', 3, 0, ['a', 'b', 'c'])).toBe('3 scenes · 3 NAM');
  expect(rig('serial', 0, 0)).toBe('Serial');
  expect(
    choiceSummary({
      kind: 'tone3000',
      origin: 'tone3000',
      id: 'a',
      owned: false,
      name: 'A',
    }),
  ).toBe('NAM chain');
});

it('offers ready Oxidal sounds that are not saved yet, and saves one before playing it', async () => {
  library();
  const recipe = allFactoryRecipes.find((r) => r.id === 'OX-01')!;
  const revision = 'e'.repeat(64);
  vi.mocked(unsavedReadySounds).mockResolvedValue([recipe]);
  vi.mocked(saveReadySound).mockResolvedValue(revision);
  const select = vi.fn();
  render(
    <RigPresetSelector current={state} disabled={false} onSelect={select} />,
  );
  const picker = screen.getByRole('button', { name: 'Playing preset: Amp A' });
  await waitFor(() => expect(picker).toBeEnabled());
  fireEvent.click(picker);
  fireEvent.click(await screen.findByRole('tab', { name: /Oxidal sounds 1/ }));
  const row = screen.getByRole('button', { name: /saved when chosen/ });
  expect(row).toHaveTextContent(recipe.name);
  fireEvent.click(row);
  await waitFor(() =>
    expect(select).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'scenes',
        revision,
        origin: 'oxidal_example',
      }),
    ),
  );
  expect(saveReadySound).toHaveBeenCalledWith(recipe);
});

it('keeps the confirmed name while the device prepares a different preset or refuses it', async () => {
  library();
  const select = vi.fn();
  const other = { ...state, key: 'original:b', name: 'Amp B' };
  const view = render(
    <RigPresetSelector
      current={state}
      phase="running"
      disabled={false}
      onSelect={select}
    />,
  );
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Playing preset: Amp A' }),
    ).toBeEnabled(),
  );
  view.rerender(
    <RigPresetSelector
      current={other}
      phase="starting"
      disabled={false}
      onSelect={select}
    />,
  );
  expect(
    screen.getByRole('button', { name: 'Last playing preset: Amp A' }),
  ).toBeDisabled();
  expect(
    screen.queryByRole('button', { name: 'Playing preset: Amp B' }),
  ).toBeNull();
  view.rerender(
    <RigPresetSelector
      current={other}
      phase="failed"
      disabled={false}
      onSelect={select}
    />,
  );
  expect(
    screen.getByRole('button', { name: 'Last playing preset: Amp A' }),
  ).toHaveTextContent('Audio failed');
  view.rerender(
    <RigPresetSelector
      current={other}
      phase="running"
      disabled={false}
      onSelect={select}
    />,
  );
  expect(
    screen.getByRole('button', { name: 'Playing preset: Amp B' }),
  ).toBeEnabled();
});
