import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ArtworkDeck } from './AssetArtwork';
import { presetArtwork, saveArtwork } from './api';
vi.mock('./api', () => ({
  presetArtwork: vi.fn(),
  saveArtwork: vi.fn(),
  artworkPath: (id: string, _owned: boolean, key: string, model: boolean) =>
    `/api/v1/${model ? 'models' : 'presets'}/${id}/artwork/${key}`,
}));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
const item = {
  block_id: 'block',
  title: 'Original cab',
  gear: 'cab',
  key: 'image',
  cached: true,
};
it('never carries old artwork across a source change or a failed metadata request', async () => {
  vi.mocked(presetArtwork).mockResolvedValueOnce([item]);
  const view = render(<ArtworkDeck id="original" />);
  expect(await screen.findByRole('img')).toHaveAttribute(
    'src',
    '/api/v1/presets/original/artwork/image',
  );
  vi.mocked(presetArtwork).mockRejectedValueOnce(new Error('offline'));
  view.rerender(<ArtworkDeck id="replacement" model />);
  expect(screen.queryByText('Original cab')).not.toBeInTheDocument();
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
  await waitFor(() =>
    expect(presetArtwork).toHaveBeenLastCalledWith(
      'replacement',
      false,
      expect.any(AbortSignal),
      true,
    ),
  );
});
it('saves replacement artwork through its own asset identity and keeps failed images usable', async () => {
  vi.mocked(presetArtwork)
    .mockResolvedValueOnce([{ ...item, cached: false }])
    .mockResolvedValueOnce([item]);
  vi.mocked(saveArtwork).mockResolvedValue();
  render(<ArtworkDeck id="replacement" model />);
  fireEvent.click(
    await screen.findByRole('button', { name: 'Save artwork offline' }),
  );
  await waitFor(() =>
    expect(saveArtwork).toHaveBeenCalledWith(
      'replacement',
      false,
      'image',
      expect.any(AbortSignal),
      true,
    ),
  );
  const img = await screen.findByRole('img');
  expect(img).toHaveAttribute(
    'src',
    '/api/v1/models/replacement/artwork/image',
  );
  fireEvent.error(img);
  expect(
    screen.getByLabelText('Original cab: image unavailable'),
  ).toBeInTheDocument();
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
});

it('renders only the selected block image in a tile and falls back without downloading', async () => {
  vi.mocked(presetArtwork).mockResolvedValue([
    item,
    { ...item, block_id: 'other', title: 'Other model' },
  ]);
  const view = render(<ArtworkDeck id="original" blockId="block" tile />);
  await waitFor(() =>
    expect(view.container.querySelector('img')).toHaveAttribute(
      'src',
      '/api/v1/presets/original/artwork/image',
    ),
  );
  expect(view.container.querySelectorAll('img')).toHaveLength(1);
  expect(view.container.querySelector('figcaption')).toBeNull();
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
  fireEvent.error(view.container.querySelector('img')!);
  expect(
    view.container.querySelector('.artwork-placeholder'),
  ).toBeInTheDocument();
  expect(saveArtwork).not.toHaveBeenCalled();
});
