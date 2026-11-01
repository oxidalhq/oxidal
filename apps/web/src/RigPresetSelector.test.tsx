import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { RigPresetSelector } from './RigPresetSelector';
import {
  nativeState,
  presetLibrary,
  rigLibrary,
  libraryCatalog,
  presetDetails,
} from './api';
import {
  assertAuditionOwner,
  controlGroup,
  confirmedControlDisplay,
  movedBlockOrder,
} from './rigControls';
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
  expect(
    screen.queryByRole('button', { name: 'Next preset' }),
  ).not.toBeInTheDocument();
  fireEvent.click(picker);
  expect(
    screen.getByRole('button', { name: /^Amp A\s*Playing$/ }),
  ).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByText(/Mine is your set list/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /^My A\s*My copy$/ }));
  expect(select).toHaveBeenCalledWith(tone('a', true));
  expect(picker).toHaveAccessibleName('Playing preset: Amp A');
  fireEvent.click(picker);
  fireEvent.change(screen.getByRole('searchbox', { name: 'Find a preset' }), {
    target: { value: 'b' },
  });
  expect(
    screen.queryByRole('button', { name: /^My A\s*My copy$/ }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /^Amp B\s*TONE3000$/ }));
  expect(select).toHaveBeenLastCalledWith(tone('b', false));
  view.rerender(
    <RigPresetSelector current={state} disabled onSelect={select} />,
  );
  expect(picker).toBeDisabled();
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
    screen.getByRole('button', { name: /^Amp B\s*TONE3000$/ }),
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
  fireEvent.click(screen.getByRole('button', { name: /^Amp B\s*TONE3000$/ }));
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
  fireEvent.click(screen.getByRole('button', { name: /^My A\s*My copy$/ }));
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
  const select = vi.fn();
  render(
    <RigPresetSelector current={state} disabled={false} onSelect={select} />,
  );
  const picker = screen.getByRole('button', { name: 'Playing preset: Amp A' });
  await waitFor(() => expect(picker).toBeEnabled());
  fireEvent.click(picker);
  const groups = screen
    .getAllByRole('region')
    .map((g) => g.getAttribute('aria-label'));
  expect(groups).toEqual(['Mine', 'TONE3000']);
  fireEvent.click(
    screen.getByRole('button', {
      name: /Clean to heavy.*Mine.*3 scenes.*3 native engines.*0 effects/,
    }),
  );
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
  fireEvent.click(
    await screen.findByRole('button', { name: 'Manage current preset: Amp A' }),
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
    screen.queryByRole('dialog', { name: 'Switch preset' }),
  ).not.toBeInTheDocument();
  expect(select).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }));
  expect(
    screen.getByRole('dialog', { name: 'Switch preset' }),
  ).toBeInTheDocument();
});
