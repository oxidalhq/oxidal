import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { tone3000Tone } from './api';
import { ToneDetails } from './ToneDetails';
vi.mock('./api', () => ({
  tone3000Tone: vi.fn(),
  toneImage: (id: number) => `/tone-${id}.png`,
}));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
const tone = (id: number, url: string) =>
  ({
    id,
    title: '1997 Match Brave 2x12',
    user: { username: 'tonejunkie', display_name: 'Tone Junkie' },
    gear: 'amp-cab',
    format: 'nam',
    license: 't3k',
    url,
    a1_models_count: 0,
    a2_models_count: 2,
    custom_models_count: 0,
    models_count: 0,
  }) as Awaited<ReturnType<typeof tone3000Tone>>;

it('shows who made the tone, what is in it and a link to its TONE3000 page', async () => {
  vi.mocked(tone3000Tone).mockResolvedValue(
    tone(1001, 'https://www.tone3000.com/tones/match-1001'),
  );
  render(<ToneDetails toneId={1001} />);
  expect(await screen.findByText('1997 Match Brave 2x12')).toBeInTheDocument();
  expect(screen.getByText(/by Tone Junkie/)).toBeInTheDocument();
  expect(screen.getByText('@tonejunkie')).toBeInTheDocument();
  expect(screen.getByText(/2 models/)).toBeInTheDocument();
  expect(screen.getByText(/TONE3000 license/)).toBeInTheDocument();
  const link = screen.getByRole('link', { name: /View on TONE3000/ });
  expect(link).toHaveAttribute(
    'href',
    'https://www.tone3000.com/tones/match-1001',
  );
  expect(link).toHaveAttribute('target', '_blank');
  expect(link).toHaveAttribute('rel', 'noopener noreferrer');
});

it('never links off TONE3000, whatever address the web API returns', async () => {
  vi.mocked(tone3000Tone).mockResolvedValue(
    tone(1002, 'https://evil.example/x'),
  );
  render(<ToneDetails toneId={1002} />);
  const link = await screen.findByRole('link', { name: /View on TONE3000/ });
  expect(link).toHaveAttribute('href', 'https://www.tone3000.com/tones/1002');
});

it('says details need a connection when TONE3000 cannot be reached', async () => {
  vi.mocked(tone3000Tone).mockRejectedValue(new Error('offline'));
  render(<ToneDetails toneId={1003} />);
  expect(
    await screen.findByText('Tone details need a TONE3000 connection.'),
  ).toBeInTheDocument();
});
