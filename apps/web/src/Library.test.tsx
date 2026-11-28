import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';

import { importPreset, presetDetails, presetLibrary } from './api';
import { Library } from './Library';

vi.mock('./api', () => ({
  // The TONE3000 browser above the imported files.
  localModels: vi.fn(async () => ({ data: [] })),
  tone3000Tones: vi.fn(async () => ({ data: [], page: 1, total_pages: 1 })),
  tone3000Models: vi.fn(async () => ({ data: [] })),
  stageTone3000: vi.fn(),
  toneImage: (id: number) => `/api/v1/tone3000/tones/${id}/image`,
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
  sessionStorage.removeItem('oxidal-page:library-preset-category');
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
  // Imported preset files have their own tab under TONE3000.
  fireEvent.click(
    await screen.findByRole('radio', { name: /^Imported presets/ }),
  );
  const input = await screen.findByLabelText('TONE3000 preset file');
  fireEvent.change(input, {
    target: { files: [new File(['x'], 'a.t3kpreset')] },
  });
  // Choosing the file imports it: there is no second Import step.
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

it('keeps the selected category on return and explains a filtered TONE3000 result', async () => {
  window.location.hash = '#library/tone3000';
  const available = {
    revision: 'details',
    entries: [
      {
        entry: { kind: 'rig' as const, id: 'a'.repeat(64) },
        details: { categories: ['Clean'], description: '' },
      },
    ],
  };
  vi.mocked(presetDetails)
    .mockResolvedValueOnce(available)
    .mockResolvedValueOnce(available);
  const user = userEvent.setup();
  const first = render(<Library connected onOpenRig={() => {}} />);
  fireEvent.click(
    await screen.findByRole('radio', { name: /^Imported presets/ }),
  );
  const category = await screen.findByRole('combobox', { name: 'Category' });
  await user.click(category);
  await user.click(screen.getByRole('option', { name: 'Clean' }));
  expect(
    screen.getByText('No TONE3000 presets match these filters.'),
  ).toBeVisible();
  first.unmount();
  render(<Library connected onOpenRig={() => {}} />);
  expect(
    await screen.findByRole('combobox', { name: 'Category' }),
  ).toHaveTextContent('Clean');
  const field = screen.getByRole('searchbox', { name: 'Search presets' });
  fireEvent.change(field, { target: { value: 'test' } });
  const clear = screen.getByRole('button', { name: 'Clear preset search' });
  clear.focus();
  fireEvent.click(clear);
  expect(field).toHaveFocus();
  expect(screen.getByRole('combobox', { name: 'Category' })).toHaveTextContent(
    'Clean',
  );
});
