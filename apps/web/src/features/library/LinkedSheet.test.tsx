import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import {
  chordSheet,
  chordSheetLinks,
  type SheetDocument,
  type SheetLinks,
} from '../../api';
import { LinkedSheet, LinkedSheetProvider } from './LinkedSheet';
import { resolveSheet, SHEETS_CHANGED } from './sheetResolution';

const live = vi.hoisted(() => ({
  preset: { kind: 'rig' as const, id: 'a'.repeat(64) },
  track: 'track-one',
}));
vi.mock('../../api', () => ({ chordSheet: vi.fn(), chordSheetLinks: vi.fn() }));
vi.mock('../../monitorFeed', () => ({
  useMonitorFeed: () => ({
    snapshot: { preset: live.preset },
    disconnected: false,
  }),
}));
vi.mock('../../components/media/sessionMedia', () => ({
  useSessionMedia: () => ({ player: { track: { id: live.track } } }),
}));
const sheet = (id: string, title: string): SheetDocument => ({
  id,
  title,
  revision: `rev-${id}`,
  format: 'chordpro',
  source: `{title: ${title}}\n[G]Words`,
});
const links = (): SheetLinks => ({
  registry_revision: 'r1',
  links: [
    {
      target: { kind: 'preset', preset: { kind: 'rig', id: 'a'.repeat(64) } },
      sheet: 'one',
      available: true,
    },
    {
      target: { kind: 'preset', preset: { kind: 'rig', id: 'b'.repeat(64) } },
      sheet: 'two',
      available: true,
    },
    {
      target: { kind: 'track', asset: 'track-one' },
      sheet: 'track-song',
      available: true,
    },
  ],
});
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  live.preset.id = 'a'.repeat(64);
  vi.mocked(chordSheetLinks).mockResolvedValue(links());
  vi.mocked(chordSheet).mockImplementation(async (id) =>
    sheet(id, id === 'one' ? 'First' : 'Second'),
  );
});
afterEach(cleanup);

it('resolves exact preset identity before track and retains missing links', () => {
  const all = links().links;
  all[0]!.available = false;
  expect(resolveSheet(all, live.preset, live.track)?.sheet).toBe('one');
  expect(
    resolveSheet(all, { kind: 'owned', id: live.preset.id }, live.track)?.sheet,
  ).toBe('track-song');
  expect(resolveSheet(all, undefined, undefined)).toBeUndefined();
});
it('shares one read owner and retains viewer position and chords when a view moves', async () => {
  const view = (key: string) => (
    <LinkedSheetProvider connected>
      <LinkedSheet key={key} />
      <LinkedSheet stage />
    </LinkedSheetProvider>
  );
  const rendered = render(view('sheet'));
  await screen.findAllByRole('heading', { name: 'First' });
  expect(chordSheetLinks).toHaveBeenCalledTimes(1);
  expect(chordSheet).toHaveBeenCalledTimes(1);
  const words = screen.getAllByRole('document')[0]!;
  words.scrollTop = 120;
  fireEvent.scroll(words);
  fireEvent.click(screen.getAllByRole('button', { name: 'Chords' })[0]!);
  rendered.rerender(view('float'));
  expect(screen.getAllByRole('document')[0]!.scrollTop).toBe(120);
  expect(screen.getAllByRole('button', { name: 'Chords' })[0]).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  expect(chordSheet).toHaveBeenCalledTimes(1);
});
it('ignores the previous source reply after the actual sounding preset changes', async () => {
  let finish!: (document: SheetDocument) => void;
  vi.mocked(chordSheet).mockImplementation((id) =>
    id === 'one'
      ? new Promise((resolve) => {
          finish = resolve;
        })
      : Promise.resolve(sheet(id, 'Second')),
  );
  const view = () => (
    <LinkedSheetProvider connected>
      <LinkedSheet />
    </LinkedSheetProvider>
  );
  const rendered = render(view());
  await waitFor(() => expect(chordSheet).toHaveBeenCalledWith('one'));
  live.preset.id = 'b'.repeat(64);
  rendered.rerender(view());
  await screen.findByRole('heading', { name: 'Second' });
  finish(sheet('one', 'Late first'));
  await waitFor(() =>
    expect(screen.queryByRole('heading', { name: 'Late first' })).toBeNull(),
  );
});
it('labels the previous sheet when a changed link cannot be read', async () => {
  render(
    <LinkedSheetProvider connected>
      <LinkedSheet />
    </LinkedSheetProvider>,
  );
  await screen.findByRole('heading', { name: 'First' });
  const changed = links();
  changed.registry_revision = 'r2';
  changed.links[0]!.sheet = 'missing';
  vi.mocked(chordSheetLinks).mockResolvedValue(changed);
  vi.mocked(chordSheet).mockRejectedValue(new Error('Song not found'));
  fireEvent(window, new Event(SHEETS_CHANGED));
  await screen.findByText('Previous sheet: First');
  expect(screen.getByText('Previous sheet')).toBeVisible();
});
