import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { BootPlayback } from './BootPlayback';
import {
  startupState,
  setStartupFollow,
  libraryCatalog,
  rigAudioCommand,
  type RigAudioState,
  type StartupState,
} from './api';
vi.mock('./api', () => ({
  startupState: vi.fn(),
  setStartupFollow: vi.fn(),
  libraryCatalog: vi.fn(),
  rigAudioCommand: vi.fn(),
  playbackCommand: vi.fn(),
  graphAudioCommand: vi.fn(),
  playbackState: vi.fn(),
  graphAudioState: vi.fn(),
  rigAudioState: vi.fn(),
}));
const before: StartupState = {
  policy: 'follow',
  target: { kind: 'rig', id: 'a' },
  error: null,
};
const mixed = {
  session: 'playing-b',
  revision: 9,
  phase: 'running',
  start_on_boot: true,
  configured: { revision: 'b' },
} as RigAudioState;
beforeEach(() => {
  vi.mocked(startupState).mockResolvedValue(before);
  vi.mocked(libraryCatalog).mockResolvedValue({
    revision: 'catalog',
    items: [{ kind: 'rig', id: 'b', name: 'Lead' }],
  } as Awaited<ReturnType<typeof libraryCatalog>>);
  vi.mocked(setStartupFollow).mockResolvedValue({
    policy: 'pinned',
    target: { kind: 'rig', id: 'b' },
    error: null,
  });
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
function show() {
  render(
    <BootPlayback
      native={null}
      mixed={mixed}
      effects={null}
      disabled={false}
      onNative={vi.fn()}
      onMixed={vi.fn()}
      onEffects={vi.fn()}
    />,
  );
}
it('pins the reviewed playing B even when A is already selected for startup', async () => {
  show();
  const pin = screen.getByRole('radio', { name: /Pinned saved version/ });
  await waitFor(() => expect(pin).toBeEnabled());
  fireEvent.click(pin);
  await waitFor(() =>
    expect(setStartupFollow).toHaveBeenCalledExactlyOnceWith(false, {
      expected: before,
      capture: { owner: 'mixed', session: 'playing-b', revision: 9 },
    }),
  );
  await waitFor(() => expect(pin).toBeChecked());
  await screen.findByText('Startup preset: Lead');
  expect(rigAudioCommand).not.toHaveBeenCalled();
});
it('keeps the old confirmed policy when the reviewed sound is stale or dirty', async () => {
  vi.mocked(setStartupFollow).mockRejectedValue(
    new Error(
      'Save your changes and play that saved version before choosing startup.',
    ),
  );
  show();
  const pin = screen.getByRole('radio', { name: /Pinned saved version/ });
  await waitFor(() => expect(pin).toBeEnabled());
  fireEvent.click(pin);
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Save your changes',
  );
  expect(
    screen.getByRole('radio', { name: /Last played preset/ }),
  ).toBeChecked();
  expect(rigAudioCommand).not.toHaveBeenCalled();
});
