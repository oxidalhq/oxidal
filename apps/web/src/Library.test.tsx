import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { importPreset, presetLibrary } from './api';
import { Library } from './Library';

vi.mock('./api', () => ({
  importPreset: vi.fn(),
  presetLibrary: vi.fn(async () => []),
  playbackState: vi.fn(() => new Promise(() => {})),
  presetDetails: vi.fn(async () => ({ revision: 'r', entries: [] })),
  libraryCatalog: vi.fn(async () => ({
    revision: 'c',
    items: [],
    starter_offered: true,
  })),
}));
// Library sections have their own tests; this one covers the import form.
vi.mock('./features/library/oxidal', () => ({ OxidalSounds: () => null }));
vi.mock('./ModelLibrary', () => ({ ModelLibrary: () => null }));
vi.mock('./SavedRigs', () => ({ SavedRigs: () => null }));
vi.mock('./components/media/BackingTracks', () => ({
  BackingTracks: () => null,
}));
vi.mock('./LibraryManagement', () => ({ LibraryManagement: () => null }));
vi.mock('./components/media/StemSongs', () => ({ StemSongs: () => null }));
afterEach(() => {
  cleanup();
  window.location.hash = '';
});

it('stops a preset import in flight and says what may still happen', async () => {
  window.location.hash = '#library/tone3000';
  let signal: AbortSignal | undefined;
  vi.mocked(importPreset).mockImplementation(
    (_file, abort) =>
      new Promise((_, reject) => {
        signal = abort;
        abort?.addEventListener('abort', () =>
          reject(new DOMException('Aborted', 'AbortError')),
        );
      }),
  );
  render(<Library connected onOpenRig={() => {}} />);
  const input = await screen.findByLabelText('TONE3000 preset file');
  fireEvent.change(input, {
    target: { files: [new File(['x'], 'a.t3kpreset')] },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Import' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Cancel import' }));
  expect(signal?.aborted).toBe(true);
  expect(await screen.findByText(/Import stopped/)).toBeVisible();
  await waitFor(() => expect(presetLibrary).toHaveBeenCalledTimes(2));
});

it.each([
  ['presets', 'Mine', 'mine'],
  ['sounds', 'Tones and IRs', 'tones'],
  ['discover', 'Oxidal sounds', 'oxidal'],
])('old link #library/%s lands on %s', async (old, tab, id) => {
  window.location.hash = `#library/${old}`;
  render(<Library connected onOpenRig={() => {}} />);
  expect(await screen.findByRole('button', { name: tab })).toHaveAttribute(
    'aria-current',
    'page',
  );
  expect(window.location.hash).toBe(`#library/${id}`);
});

it('switches between sounds and media from the same directory', async () => {
  window.location.hash = '#library/setlist';
  render(<Library connected onOpenRig={() => {}} />);
  const backing = await screen.findByRole('button', {
    name: 'Backing tracks',
  });
  fireEvent.click(backing);
  expect(backing).toHaveAttribute('aria-current', 'page');
  expect(window.location.hash).toBe('#library/backing');
  const mine = screen.getByRole('button', { name: 'Mine' });
  fireEvent.click(mine);
  expect(mine).toHaveAttribute('aria-current', 'page');
  expect(backing).not.toHaveAttribute('aria-current');
});
