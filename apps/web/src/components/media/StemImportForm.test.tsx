import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { StemImportForm } from './StemImportForm';

afterEach(() => vi.unstubAllGlobals());

it('uploads each chosen role through the chunk API and creates a single song', async () => {
  const state = (id: string, complete: boolean) => ({
    id,
    title: id,
    format: id.endsWith('.mp3') ? 'mp3' : 'wav',
    size: 3,
    offset: complete ? 3 : 0,
    complete,
    import: { state: 'receiving' },
  });
  const asset = {
    schema: 1,
    id: 'song',
    kind: 'backing',
    title: 'Mac session',
    created_at: '2026-11-15T03:20:06.000Z',
    renders: [],
  };
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/import-stems')) return Response.json(asset);
    if (init?.method === 'PUT') {
      const id = decodeURIComponent(url.split('/').at(-1)?.split('?')[0] ?? '');
      return Response.json(state(id, true));
    }
    const { name } = JSON.parse(String(init?.body)) as { name: string };
    return Response.json(state(name, false));
  });
  const imported = vi.fn();
  vi.stubGlobal('fetch', fetch);
  render(
    <StemImportForm locked={false} onClose={() => {}} onImported={imported} />,
  );
  expect(screen.getByRole('button', { name: /^Import/ })).toBeDisabled();
  // Several files at once are matched to parts by name, and the song name
  // comes from what they share.
  fireEvent.change(screen.getByLabelText('Choose stem files'), {
    target: {
      files: [
        new File(['mp3'], 'Mac session - bass.mp3'),
        new File(['wav'], 'Mac session - Guitar.wav'),
      ],
    },
  });
  expect(screen.getByLabelText('Song name')).toHaveValue('Mac session');
  expect(screen.getByText(/Mac session - bass\.mp3/)).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Import 2 stems' }));
  await waitFor(() => expect(imported).toHaveBeenCalledWith(asset));
  expect(fetch.mock.calls.map(([url, init]) => [url, init?.method])).toEqual([
    ['/api/v1/media/uploads', 'POST'],
    ['/api/v1/media/uploads/Mac%20session%20-%20bass.mp3?offset=0', 'PUT'],
    ['/api/v1/media/uploads', 'POST'],
    ['/api/v1/media/uploads/Mac%20session%20-%20Guitar.wav?offset=0', 'PUT'],
    ['/api/v1/media/songs/import-stems', 'POST'],
  ]);
  expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toEqual({
    name: 'Mac session - bass.mp3',
    size: 3,
    stem: true,
  });
  expect(JSON.parse(String(fetch.mock.calls[4]?.[1]?.body))).toEqual({
    title: 'Mac session',
    stems: [
      { role: 'bass', upload: 'Mac session - bass.mp3' },
      { role: 'guitar', upload: 'Mac session - Guitar.wav' },
    ],
  });
});
