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
import { controlGroup, confirmedControlDisplay } from './rigControls';
vi.mock('./api', () => ({ nativeState: vi.fn(), presetLibrary: vi.fn() }));
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
  const picker = screen.getByRole('combobox', { name: 'Playing preset' });
  await waitFor(() => expect(picker).toBeEnabled());
  fireEvent.change(picker, { target: { value: 'copy:a' } });
  expect(select).toHaveBeenCalledWith('a', true);
  expect(picker).toHaveValue('original:a');
  fireEvent.click(screen.getByRole('button', { name: 'Next preset' }));
  expect(select).toHaveBeenLastCalledWith('b', false);
  view.rerender(<RigPresetSelector state={state} disabled onSelect={select} />);
  expect(picker).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Next preset' })).toBeDisabled();
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
  await screen.findByText('Preset list unavailable');
  expect(screen.getByRole('combobox')).toBeDisabled();
  expect(screen.getByRole('option', { name: 'Amp A' })).toBeInTheDocument();
  library();
  fireEvent.click(screen.getByRole('button', { name: 'Retry presets' }));
  await waitFor(() => expect(screen.getByRole('combobox')).toBeEnabled());
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
