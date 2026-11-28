import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import {
  localModels,
  stageTone3000,
  tone3000Models,
  tone3000Tones,
} from './api';
import { ModelPicker } from './ModelPicker';

vi.mock('./api', () => ({
  tone3000Tones: vi.fn(),
  tone3000Models: vi.fn(),
  stageTone3000: vi.fn(),
  localModels: vi.fn(),
  uploadLocalModel: vi.fn(),
  stageLocalCollection: vi.fn(),
  toneImage: (id: number) => `/tone-${id}.png`,
}));

const tone = (id: number, title: string) => ({
  id,
  title,
  format: 'nam',
  gear: 'amp',
  user: { username: 'author', display_name: 'Author', profile_url: null },
  license: 'test',
  url: '',
  images: null,
  models_count: 2,
  a1_models_count: 0,
  a2_models_count: 2,
  custom_models_count: 0,
});
const page = <T,>(data: T[], total_pages = 1) => ({ data, total_pages });

beforeEach(() => {
  vi.mocked(localModels).mockResolvedValue({ data: [], next: null } as never);
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

it('keeps comparison open and marks a model sounding only after confirmed application', async () => {
  vi.mocked(tone3000Tones).mockResolvedValue(
    page([tone(1, 'Test amp')]) as never,
  );
  vi.mocked(tone3000Models).mockResolvedValue(
    page([
      { id: 1, name: 'Clean' },
      { id: 2, name: 'Drive' },
    ]) as never,
  );
  vi.mocked(stageTone3000).mockResolvedValue({ id: 'asset' } as never);
  const onClose = vi.fn();
  const onAudition = vi.fn().mockResolvedValue(undefined);
  const props = { name: 'Current amp', onClose, onAudition };
  const view = render(
    <ModelPicker {...props} comparison={{ pending: false }} />,
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Try Test amp' }));
  await waitFor(() => expect(onAudition).toHaveBeenCalledWith('asset'));
  // Its first model is the one tried.
  expect(stageTone3000).toHaveBeenCalledWith(1, 1, expect.any(AbortSignal));
  expect(onClose).not.toHaveBeenCalled();
  expect(screen.queryByText(/Auditioning Clean/)).not.toBeInTheDocument();
  view.rerender(<ModelPicker {...props} comparison={{ pending: true }} />);
  expect(screen.getByRole('button', { name: 'Try Test amp' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Close' })).toBeEnabled();
  view.rerender(
    <ModelPicker
      {...props}
      comparison={{ pending: false, appliedAsset: 'asset' }}
    />,
  );
  expect(screen.getByText('Auditioning Clean')).toBeInTheDocument();
  expect(screen.getAllByText('Playing').length).toBeGreaterThan(0);
  view.rerender(
    <ModelPicker
      {...props}
      comparison={{ pending: false, blocked: true, error: 'Rig changed' }}
    />,
  );
  expect(screen.getByRole('alert')).toHaveTextContent(
    'The playing preset changed',
  );
});

it('searches TONE3000 from the chooser', async () => {
  vi.mocked(tone3000Tones).mockResolvedValue(
    page([tone(1, 'Test amp')]) as never,
  );
  render(<ModelPicker name="Amp" onClose={vi.fn()} onAudition={vi.fn()} />);
  await screen.findByRole('button', { name: 'Try Test amp' });
  const search = screen.getByRole('searchbox');
  fireEvent.change(search, { target: { value: 'plexi' } });
  fireEvent.submit(search.closest('form') ?? search);
  await waitFor(() =>
    expect(tone3000Tones).toHaveBeenCalledWith(
      expect.objectContaining({ query: 'plexi' }),
      expect.anything(),
    ),
  );
});

it('downloads to the independent library without presenting a live audition', async () => {
  vi.mocked(tone3000Tones).mockResolvedValue(
    page([tone(42, 'Library amp')]) as never,
  );
  vi.mocked(tone3000Models).mockResolvedValue(
    page([{ id: 7, name: 'Library model' }]) as never,
  );
  vi.mocked(stageTone3000).mockResolvedValue({
    id: 'downloaded-asset',
  } as never);
  const stored = vi.fn().mockResolvedValue(undefined);
  const close = vi.fn();
  render(
    <ModelPicker
      name="NAM models"
      intent="download"
      allowedFormat="nam"
      onClose={close}
      onAudition={stored}
    />,
  );
  expect(
    screen.getByText(/Downloading does not change the playing sound/),
  ).toBeVisible();
  // Only TONE3000: the unit's own models are not offered for a download.
  expect(screen.queryByText('On device')).toBeNull();
  fireEvent.click(
    await screen.findByRole('button', { name: 'Get Library amp' }),
  );
  await waitFor(() => expect(stored).toHaveBeenCalledWith('downloaded-asset'));
  expect(stageTone3000).toHaveBeenCalledWith(42, 7, expect.any(AbortSignal));
  expect(close).toHaveBeenCalledTimes(1);
});

it('offers sign-in when the account expired', async () => {
  vi.mocked(tone3000Tones).mockRejectedValue(
    Object.assign(new Error('Sign in to TONE3000 again'), {
      code: 'account',
      status: 401,
    }),
  );
  const signIn = vi.fn();
  render(
    <ModelPicker
      inline
      name="Sounds"
      intent="download"
      onClose={() => {}}
      onAudition={async () => {}}
      onSignIn={signIn}
    />,
  );
  await waitFor(() =>
    expect(
      screen.queryByText(/Sign in to search TONE3000|TONE3000 needs/),
    ).toBeInTheDocument(),
  );
});

it('says only the internet is missing when TONE3000 cannot be reached', async () => {
  vi.mocked(tone3000Tones).mockRejectedValue(
    new Error('Cannot reach TONE3000; local presets remain available'),
  );
  render(
    <ModelPicker
      inline
      name="Sounds"
      intent="download"
      onClose={() => {}}
      onAudition={async () => {}}
      onSignIn={() => {}}
    />,
  );
  expect(await screen.findByText(/TONE3000 needs the internet/)).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Sign in' })).toBeNull();
});

it('keeps earlier tones when Show more returns overlapping rows', async () => {
  vi.mocked(tone3000Tones).mockImplementation(
    async ({ page: n }) =>
      page(
        (n === 2 ? [2, 3] : [1, 2]).map((id) => tone(id, `Amp ${id}`)),
        2,
      ) as never,
  );
  render(<ModelPicker name="Slot" onClose={vi.fn()} onAudition={vi.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: /Show more/ }));
  await screen.findByRole('button', { name: 'Try Amp 3' });
  for (const id of [1, 2, 3])
    expect(
      screen.getAllByRole('button', { name: `Try Amp ${id}` }),
    ).toHaveLength(1);
});
