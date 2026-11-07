import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { NativeEditor } from './NativeEditor';
import { capabilities, nativeCommand, nativeState } from './api';

vi.mock('./api', () => ({
  capabilities: vi.fn(),
  nativeState: vi.fn(),
  nativeCommand: vi.fn(),
}));
vi.mock('./AssetArtwork', () => ({ ArtworkDeck: () => null }));
afterEach(cleanup);

const snapshot = (over: object = {}) =>
  ({
    session: 's',
    revision: 1,
    block_controls: [],
    parameters: [],
    owned: [],
    can_undo: false,
    can_redo: false,
    dirty: false,
    live_audio: false,
    state_captures: 0,
    loaded: null,
    ...over,
  }) as never;

it('opens the requested tone on its own and reports the owned copy Save made', async () => {
  vi.mocked(capabilities).mockResolvedValue({ native_editor: true } as never);
  vi.mocked(nativeState).mockResolvedValue(snapshot());
  vi.mocked(nativeCommand).mockImplementation(async (_state, action) =>
    action.kind === 'load'
      ? snapshot({ revision: 2, loaded: 'a' })
      : snapshot({
          revision: 3,
          loaded: 'a',
          owned: [{ id: 'owned-1', preset: { name: 'Amp (edited)' } }],
        }),
  );
  const saved = vi.fn();
  render(
    <NativeEditor
      presets={[]}
      connected
      open={{ id: 'a', owned: false, name: 'Amp' }}
      onSaved={saved}
    />,
  );
  await waitFor(() =>
    expect(nativeCommand).toHaveBeenCalledWith(expect.anything(), {
      kind: 'load',
      id: 'a',
      owned: false,
    }),
  );
  expect(screen.getByDisplayValue('Amp (edited)')).toBeInTheDocument();
  const save = screen.getByRole('button', { name: 'Save owned copy' });
  await waitFor(() => expect(save).toBeEnabled());
  fireEvent.click(save);
  await waitFor(() =>
    expect(saved).toHaveBeenCalledWith({ id: 'owned-1', name: 'Amp (edited)' }),
  );
  // Opening happens once, not on every state refresh.
  expect(
    vi.mocked(nativeCommand).mock.calls.filter(([, a]) => a.kind === 'load'),
  ).toHaveLength(1);
});
