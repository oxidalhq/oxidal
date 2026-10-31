import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { localModels, uploadLocalModel, type LocalModel } from './api';
import { ModelLibrary } from './ModelLibrary';
vi.mock('./api', () => ({ localModels: vi.fn(), uploadLocalModel: vi.fn() }));
const model = (title: string, tone_id = 0): LocalModel => ({
  id: title,
  title,
  name: `${title}.wav`,
  format: 'ir',
  sha256: 'a'.repeat(64),
  tone_id,
  gear: '',
});
beforeEach(() => {
  vi.mocked(localModels).mockResolvedValue({ data: [], next: null });
  vi.mocked(uploadLocalModel).mockImplementation(async (file) =>
    model(file.name),
  );
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
it('uses filtered server pages, includes both sources and replaces rows on next/previous', async () => {
  vi.mocked(localModels).mockImplementation(async (after) =>
    after
      ? { data: [model('Later')], next: null }
      : {
          data: [model('Uploaded'), model('Downloaded', 42)],
          next: 'next-cursor',
        },
  );
  render(<ModelLibrary format="ir" connected />);
  await screen.findByRole('heading', { name: 'Uploaded' });
  fireEvent.click(
    screen
      .getByRole('heading', { name: 'Downloaded', level: 4 })
      .closest('summary')!,
  );
  expect(screen.getByText('TONE3000', { selector: 'dd' })).toBeVisible();
  expect(localModels).toHaveBeenLastCalledWith(
    null,
    expect.any(AbortSignal),
    true,
    { format: 'ir', query: '' },
  );
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  expect(screen.queryByRole('heading', { name: 'Uploaded' })).toBeNull();
  await screen.findByRole('heading', { name: 'Later' });
  expect(localModels).toHaveBeenLastCalledWith(
    'next-cursor',
    expect.any(AbortSignal),
    true,
    { format: 'ir', query: '' },
  );
  fireEvent.click(screen.getByRole('button', { name: 'Previous' }));
  await screen.findByRole('heading', { name: 'Uploaded' });
  fireEvent.change(screen.getByRole('searchbox'), {
    target: { value: 'needle' },
  });
  await waitFor(() =>
    expect(localModels).toHaveBeenLastCalledWith(
      null,
      expect.any(AbortSignal),
      true,
      { format: 'ir', query: 'needle' },
    ),
  );
});
it('imports a collection over one GB sequentially without the picker collection-size cap', async () => {
  let concurrent = 0;
  let maximum = 0;
  vi.mocked(uploadLocalModel).mockImplementation(async (file) => {
    concurrent++;
    maximum = Math.max(maximum, concurrent);
    await Promise.resolve();
    concurrent--;
    return model(file.name);
  });
  render(<ModelLibrary format="ir" connected />);
  const files = Array.from({ length: 40 }, (_, i) => {
    const file = new File(['fixture'], `Cab ${i}.wav`);
    Object.defineProperty(file, 'size', { value: 31 * 1024 ** 2 });
    return file;
  });
  fireEvent.change(screen.getByLabelText('Add IRs files'), {
    target: { files },
  });
  await screen.findByText(/Import complete: 40 of 40 files/);
  expect(uploadLocalModel).toHaveBeenCalledTimes(40);
  expect(maximum).toBe(1);
  expect(screen.getByRole('progressbar')).toHaveValue(40);
});
it('reports individual failures and keeps successfully imported files', async () => {
  render(<ModelLibrary format="nam" connected />);
  const tooBig = new File(['fixture'], 'Huge.nam');
  Object.defineProperty(tooBig, 'size', { value: 33 * 1024 ** 2 });
  fireEvent.change(screen.getByLabelText('Add NAM models files'), {
    target: {
      files: [
        new File(['{}'], 'Good.nam'),
        tooBig,
        new File(['text'], 'Notes.txt'),
      ],
    },
  });
  await screen.findByText(
    /Import complete: 3 of 3 files · 1 stored · 2 failed/,
  );
  expect(uploadLocalModel).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByText('Import failures'));
  expect(screen.getByText(/Huge.nam: Error: Each file/)).toBeVisible();
});
it('cancels the in-flight upload and does not start remaining files', async () => {
  vi.mocked(uploadLocalModel).mockImplementation(
    (_file, signal) =>
      new Promise((_resolve, reject) =>
        signal!.addEventListener(
          'abort',
          () => reject(new DOMException('Aborted', 'AbortError')),
          { once: true },
        ),
      ),
  );
  render(<ModelLibrary format="ir" connected />);
  fireEvent.change(screen.getByLabelText('Add IRs files'), {
    target: {
      files: [new File(['wav'], 'First.wav'), new File(['wav'], 'Second.wav')],
    },
  });
  await screen.findByRole('button', { name: 'Cancel import' });
  await act(async () =>
    fireEvent.click(screen.getByRole('button', { name: 'Cancel import' })),
  );
  await screen.findByText(/Import cancelled: 0 of 2 files/);
  expect(uploadLocalModel).toHaveBeenCalledTimes(1);
});
