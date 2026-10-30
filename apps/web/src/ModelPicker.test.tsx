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
