import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { presetArtwork, saveArtwork } from '../../api';
import { presetFileSummary, usePresetArtwork } from './presetFile';
import { PresetFileSources } from './PresetFileSources';

vi.mock('../../api', () => ({
  artworkPath: (id: string, _owned: boolean, key: string) =>
    `/api/v1/presets/${id}/artwork/${key}`,
  presetArtwork: vi.fn(),
  saveArtwork: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const block = (id: string, title: string, gear: string, cached: boolean) => ({
  block_id: id,
  title,
  gear,
  key: `key-${id}`,
  cached,
});

function Details() {
  const artwork = usePresetArtwork('sha', false);
  return (
    <PresetFileSources
      id="sha"
      owned={false}
      facts={{ blocks: 10, modelBytes: 668210 }}
      artwork={artwork}
    />
  );
}

it('lists the captures in the file and downloads the pictures a fresh install lacks', async () => {
  vi.mocked(presetArtwork)
    .mockResolvedValueOnce([
      block('a', 'Bogner Uberschall', 'amp', false),
      block('b', 'Greenback 4x12', 'cab', true),
      {
        block_id: 'c',
        title: 'Local asset',
        gear: 'Tone',
        key: null,
        cached: false,
      },
    ])
    .mockResolvedValueOnce([
      block('a', 'Bogner Uberschall', 'amp', true),
      block('b', 'Greenback 4x12', 'cab', true),
    ]);
  vi.mocked(saveArtwork).mockResolvedValue(undefined as never);
  render(<Details />);
  expect(await screen.findByText('Bogner Uberschall')).toBeVisible();
  // Positions without a capture of their own are not listed.
  expect(screen.queryByText('Local asset')).toBeNull();
  expect(
    screen.getByText('The models are inside this preset file (653 KB).'),
  ).toBeVisible();
  expect(screen.getByText('1 picture is not on this unit yet.')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Download the picture' }));
  await waitFor(() =>
    expect(saveArtwork).toHaveBeenCalledWith(
      'sha',
      false,
      'key-a',
      expect.anything(),
    ),
  );
  expect(saveArtwork).toHaveBeenCalledTimes(1);
  await waitFor(() =>
    expect(
      screen.queryByRole('group', { name: 'Needed on this unit' }),
    ).toBeNull(),
  );
});

it('names what the file is in the details header', () => {
  expect(presetFileSummary(false, { blocks: 10, modelBytes: 1 }, 3)).toBe(
    'TONE3000 original · 10 blocks · 3 captures',
  );
  expect(presetFileSummary(true, undefined, 1)).toBe(
    'Your copy of a TONE3000 preset · 1 capture',
  );
});
