import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { ModelPicker } from './ModelPicker';
import { tone3000Tones, tone3000Models, stageTone3000 } from './api';
vi.mock('./api', () => ({
  tone3000Tones: vi.fn(),
  tone3000Models: vi.fn(),
  stageTone3000: vi.fn(),
  localModels: vi.fn(),
  uploadLocalModel: vi.fn(),
  stageLocalCollection: vi.fn(),
  toneImage: (id: number) => `/tone-${id}.png`,
}));
vi.mock('./AdjustmentDialog', () => ({
  AdjustmentDialog: ({ children }: { children: ReactNode }) => (
    <div role="dialog">{children}</div>
  ),
}));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
it('keeps comparison open and marks a model sounding only after confirmed application', async () => {
  vi.mocked(tone3000Tones).mockResolvedValue({
    data: [
      {
        id: 1,
        title: 'Test amp',
        format: 'nam',
        gear: 'amp',
        user: { username: 'author' },
        license: 'test',
        url: '',
        models_count: 2,
      },
    ],
    total_pages: 1,
  } as Awaited<ReturnType<typeof tone3000Tones>>);
  vi.mocked(tone3000Models).mockResolvedValue({
    data: [
      { id: 1, name: 'Clean' },
      { id: 2, name: 'Drive' },
    ],
    total_pages: 1,
  } as Awaited<ReturnType<typeof tone3000Models>>);
  vi.mocked(stageTone3000).mockResolvedValue({ id: 'asset' } as Awaited<
    ReturnType<typeof stageTone3000>
  >);
  const onClose = vi.fn();
  const onAudition = vi.fn().mockResolvedValue(undefined);
  const props = { name: 'Current amp', onClose, onAudition };
  const view = render(
    <ModelPicker {...props} comparison={{ pending: false }} />,
  );
  fireEvent.click(await screen.findByRole('button', { name: /Test amp/ }));
  fireEvent.click(await screen.findByRole('button', { name: /Clean/ }));
  await waitFor(() => expect(onAudition).toHaveBeenCalledWith('asset'));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: /Drive/ })).toBeEnabled(),
  );
  expect(onClose).not.toHaveBeenCalled();
  expect(screen.queryByText(/Auditioning Clean/)).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Clean/ })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  view.rerender(<ModelPicker {...props} comparison={{ pending: true }} />);
  expect(screen.getByRole('button', { name: /Drive/ })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Close' })).toBeEnabled();
  view.rerender(
    <ModelPicker
      {...props}
      comparison={{ pending: false, appliedAsset: 'asset' }}
    />,
  );
  expect(screen.getByText('Auditioning Clean')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Clean/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect(screen.getByRole('button', { name: /Drive/ })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  fireEvent.click(screen.getByRole('button', { name: /Drive/ }));
  await waitFor(() => expect(onAudition).toHaveBeenCalledTimes(2));
  expect(onClose).not.toHaveBeenCalled();
  view.rerender(
    <ModelPicker
      {...props}
      comparison={{ pending: false, blocked: true, error: 'Rig changed' }}
    />,
  );
  expect(screen.getByRole('button', { name: /Clean/ })).toBeDisabled();
  expect(screen.getByRole('alert')).toHaveTextContent(
    'The playing preset changed',
  );
});

it('filters tones by gear, shows pictures by default and remembers a list view', async () => {
  vi.mocked(tone3000Tones).mockResolvedValue({
    data: [
      {
        id: 5,
        title: 'Tube Screamer',
        format: 'nam',
        gear: 'pedal',
        user: { username: 'author' },
        license: 't3k',
        url: '',
        models_count: 4,
      },
    ],
    total_pages: 1,
  } as Awaited<ReturnType<typeof tone3000Tones>>);
  render(<ModelPicker name="Slot" onClose={() => {}} onAudition={vi.fn()} />);
  const card = await screen.findByRole('button', { name: /Tube Screamer/ });
  expect(card.querySelector('img')).toHaveAttribute('src', '/tone-5.png');
  fireEvent.click(screen.getByRole('radio', { name: 'Pedal' }));
  await waitFor(() =>
    expect(vi.mocked(tone3000Tones).mock.lastCall?.[0]).toMatchObject({
      gear: 'pedal',
      page: 1,
    }),
  );
  fireEvent.click(screen.getByRole('radio', { name: 'List' }));
  expect(localStorage.getItem('oxidal.picker.view')).toBe('list');
  const listed = await screen.findByRole('button', { name: /Tube Screamer/ });
  expect(listed.querySelector('img')).toBeNull();
  localStorage.removeItem('oxidal.picker.view');
});

it('downloads to the independent library without presenting a live audition', async () => {
  vi.mocked(tone3000Tones).mockResolvedValue({
    data: [
      {
        id: 42,
        title: 'Library amp',
        format: 'nam',
        gear: 'amp',
        user: { username: 'author' },
        license: 't3k',
        url: '',
        models_count: 1,
      },
    ],
    total_pages: 1,
  } as Awaited<ReturnType<typeof tone3000Tones>>);
  vi.mocked(tone3000Models).mockResolvedValue({
    data: [{ id: 7, name: 'Library model' }],
    total_pages: 1,
  } as Awaited<ReturnType<typeof tone3000Models>>);
  vi.mocked(stageTone3000).mockResolvedValue({
    id: 'downloaded-asset',
  } as Awaited<ReturnType<typeof stageTone3000>>);
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
  expect(screen.queryByRole('button', { name: /On this unit/ })).toBeNull();
  expect(
    screen.getByText(/Downloading does not change the playing sound/),
  ).toBeVisible();
  fireEvent.click(await screen.findByRole('button', { name: /Library amp/ }));
  const button = await screen.findByRole('button', {
    name: /Library model.*Download/,
  });
  expect(button).not.toHaveTextContent('Audition');
  fireEvent.click(button);
  await waitFor(() => expect(stored).toHaveBeenCalledWith('downloaded-asset'));
  expect(stageTone3000).toHaveBeenCalledWith(42, 7, expect.any(AbortSignal));
  expect(close).toHaveBeenCalledTimes(1);
});
