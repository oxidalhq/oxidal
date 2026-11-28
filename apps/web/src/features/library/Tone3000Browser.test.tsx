import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import {
  downloadVoice,
  localModels,
  stageTone3000,
  tone3000Models,
  tone3000Tones,
} from '../../api';
import { Tone3000Browser } from './Tone3000Browser';

vi.mock('../../api', () => ({
  downloadVoice: vi.fn(),
  localModels: vi.fn(),
  stageTone3000: vi.fn(),
  tone3000Models: vi.fn(),
  tone3000Tones: vi.fn(),
  toneImage: (id: number) => `/api/v1/tone3000/tones/${id}/image`,
}));
vi.mock('../../LibraryModelAudition', () => ({
  LibraryModelAudition: () => <p>Audition</p>,
}));

const tone = (id: number, title: string) => ({
  id,
  title,
  user: { username: 'jane', display_name: 'Jane Capture', profile_url: null },
  gear: 'amp',
  format: 'nam',
  license: 'CC BY 4.0',
  images: null,
  url: `https://www.tone3000.com/tones/${id}`,
  models_count: 1,
  a1_models_count: 0,
  a2_models_count: 1,
  custom_models_count: 0,
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it('plays a tone on its own, as a capture with no rig around it', async () => {
  vi.mocked(localModels).mockResolvedValue({ data: [] } as never);
  vi.mocked(tone3000Tones).mockResolvedValue({
    data: [tone(2, 'Deluxe reverb')],
    page: 1,
    total_pages: 1,
  } as never);
  vi.mocked(tone3000Models).mockResolvedValue({
    data: [{ id: 22, name: 'Standard', tone_id: 2 }],
  } as never);
  vi.mocked(downloadVoice).mockResolvedValue({
    downloaded: true,
    capture: {
      tone_id: 2,
      model_id: 22,
      source: {
        preset: {},
        source: { kind: 'original', preset: 'voice-sha' },
      },
    },
  } as never);
  const onPlay = vi.fn();
  render(
    <Tone3000Browser
      connected
      onOpenRig={() => {}}
      onPlay={onPlay}
      onSignIn={() => {}}
    />,
  );
  fireEvent.click(
    await screen.findByRole('button', { name: 'Play Deluxe reverb' }),
  );
  await waitFor(() => expect(onPlay).toHaveBeenCalledWith('voice-sha', false));
  expect(downloadVoice).toHaveBeenCalledWith(2, 22, 'Deluxe reverb');
  expect(stageTone3000).not.toHaveBeenCalled();
});

it('lists TONE3000 tones, marks the kept ones and keeps another on Get', async () => {
  vi.mocked(localModels).mockResolvedValue({
    data: [{ tone_id: 1 }],
  } as never);
  vi.mocked(tone3000Tones).mockResolvedValue({
    data: [tone(1, 'Plexi lead'), tone(2, 'Deluxe reverb')],
    page: 1,
    total_pages: 1,
  } as never);
  vi.mocked(tone3000Models).mockResolvedValue({
    data: [{ id: 22, name: 'Standard', tone_id: 2 }],
  } as never);
  vi.mocked(stageTone3000).mockResolvedValue({ id: 'asset-2' } as never);
  render(
    <Tone3000Browser
      connected
      onOpenRig={() => {}}
      onPlay={() => {}}
      onSignIn={() => {}}
    />,
  );
  expect(await screen.findByText('Deluxe reverb')).toBeVisible();
  expect(tone3000Tones).toHaveBeenCalledWith(
    expect.objectContaining({ collection: 'trending', page: 1 }),
    expect.anything(),
  );
  await waitFor(() =>
    expect(screen.getByText(/Downloaded · Amp · 1 model/)).toBeVisible(),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Get Deluxe reverb' }));
  await waitFor(() =>
    expect(stageTone3000).toHaveBeenCalledWith(2, 22, expect.anything()),
  );
});
