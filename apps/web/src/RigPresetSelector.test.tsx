import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { RigPresetSelector } from './RigPresetSelector';
import { nativeState, presetLibrary, type AudioState } from './api';
import {
  assertAuditionOwner,
  controlGroup,
  confirmedControlDisplay,
  movedBlockOrder,
} from './rigControls';
vi.mock('./api', () => ({ nativeState: vi.fn(), presetLibrary: vi.fn() }));
// jsdom has no modal dialog; the picker list opens in one.
HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
  this.open = true;
};
HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
  this.open = false;
};
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
const state = {
  configured: { preset_id: 'a', owned: false, draft: false },
  preset_name: 'Amp A',
} as AudioState;
function library() {
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
    <RigPresetSelector state={state} disabled={false} onSelect={select} />,
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
  expect(
    screen.getByText(/Unsaved edits stay with each preset/),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'My A' }));
  expect(select).toHaveBeenCalledWith('a', true);
  expect(picker).toHaveAccessibleName('Playing preset: Amp A');
  fireEvent.click(picker);
  fireEvent.change(screen.getByRole('searchbox', { name: 'Find a preset' }), {
    target: { value: 'b' },
  });
  expect(
    screen.queryByRole('button', { name: 'My A' }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Amp B' }));
  expect(select).toHaveBeenLastCalledWith('b', false);
  view.rerender(<RigPresetSelector state={state} disabled onSelect={select} />);
  expect(picker).toBeDisabled();
});
it('keeps the current rig visible when the library fails, and permits retry', async () => {
  vi.mocked(presetLibrary).mockRejectedValue(new Error('offline'));
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
    <RigPresetSelector state={state} disabled={false} onSelect={() => {}} />,
  );
  await screen.findByText('Original presets unavailable');
  const picker = screen.getByRole('button', { name: 'Playing preset: Amp A' });
  library();
  fireEvent.click(screen.getByRole('button', { name: 'Retry presets' }));
  await waitFor(() =>
    expect(screen.queryByText('Original presets unavailable')).toBeNull(),
  );
  fireEvent.click(picker);
  expect(screen.getByRole('button', { name: 'Amp B' })).toBeEnabled();
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
  const select = vi.fn();
  render(
    <RigPresetSelector state={state} disabled={false} onSelect={select} pads />,
  );
  const playing = await screen.findByRole('button', { name: /Amp A.*Playing/ });
  expect(playing).toBeDisabled();
  expect(playing).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(screen.getByRole('button', { name: /My A.*My copy/ }));
  expect(select).toHaveBeenCalledWith('a', true);
  expect(playing).toHaveAttribute('aria-pressed', 'true');
  // Fewer than eight presets need no bank paging.
  expect(
    screen.queryByRole('button', { name: 'Next bank' }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Amp B.*Next/ })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: 'Next preset: Amp B' }));
  expect(select).toHaveBeenLastCalledWith('b', false);
  fireEvent.click(
    screen.getByRole('button', { name: 'Previous preset: My A' }),
  );
  expect(select).toHaveBeenLastCalledWith('a', true);
});

it('opens gig pads on the playing bank and keeps playing identity during initial loading', async () => {
  library();
  vi.mocked(presetLibrary).mockResolvedValue(
    Array.from({ length: 12 }, (_, i) => ({
      sha256: String(i),
      name: `Tone ${i}`,
    })) as Awaited<ReturnType<typeof presetLibrary>>,
  );
  vi.mocked(nativeState).mockResolvedValue({ owned: [] } as unknown as Awaited<
    ReturnType<typeof nativeState>
  >);
  const playing = {
    ...state,
    configured: { ...state.configured!, preset_id: '10' },
    preset_name: 'Tone 10',
  };
  const view = render(
    <RigPresetSelector state={playing} disabled={false} onSelect={() => {}} />,
  );
  expect(
    screen.getByRole('button', { name: 'Playing preset: Tone 10' }),
  ).toBeInTheDocument();
  view.rerender(
    <RigPresetSelector
      state={playing}
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
    <RigPresetSelector state={state} disabled={false} onSelect={select} />,
  );
  await screen.findByText('Saved copies unavailable');
  fireEvent.click(
    screen.getByRole('button', { name: 'Playing preset: Amp A' }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Amp B' }));
  expect(select).toHaveBeenCalledWith('b', false);
});
it('keeps saved copies selectable when originals cannot be read', async () => {
  library();
  vi.mocked(presetLibrary).mockRejectedValue(new Error('storage unavailable'));
  const select = vi.fn();
  render(
    <RigPresetSelector state={state} disabled={false} onSelect={select} />,
  );
  await screen.findByText('Original presets unavailable');
  fireEvent.click(
    screen.getByRole('button', { name: 'Playing preset: Amp A' }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'My A' }));
  expect(select).toHaveBeenCalledWith('a', true);
});
