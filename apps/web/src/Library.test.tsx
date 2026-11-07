import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { Library } from './Library';
import { importPreset, presetLibrary } from './api';

vi.mock('./api', () => ({
  importPreset: vi.fn(),
  presetLibrary: vi.fn(async () => []),
  playbackState: vi.fn(() => new Promise(() => {})),
  nativeState: vi.fn(async () => ({ owned: [] })),
  presetDetails: vi.fn(async () => ({ revision: 'r', entries: [] })),
}));
// Library sections have their own tests; this one covers the import form.
vi.mock('./FactoryCollection', () => ({ DiscoverPage: () => null }));
vi.mock('./ModelLibrary', () => ({ ModelLibrary: () => null }));
vi.mock('./LibraryManagement', () => ({ LibraryManagement: () => null }));
afterEach(() => {
  cleanup();
  window.location.hash = '';
});

it('stops a preset import in flight and says what may still happen', async () => {
  window.location.hash = '#library/discover';
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
