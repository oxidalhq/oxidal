import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { presetDetails } from './api';
import { PresetDetailsDialog } from './PresetDetails';
import { detailsMatch } from './presetMetadata';
vi.mock('./api', () => ({ presetDetails: vi.fn() }));
HTMLDialogElement.prototype.showModal ??= function () {
  this.open = true;
};
HTMLDialogElement.prototype.close ??= function () {
  this.open = false;
};
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
const entry = {
  kind: 'original' as const,
  id: 'a'.repeat(64),
  name: 'Warm amp',
};
const details = {
  description: 'Neck pickup\nLow gain',
  categories: ['Ambient'],
  copied_from: null,
};
const catalog = {
  revision: 'one',
  entries: [{ entry: { kind: entry.kind, id: entry.id }, details }],
};
it('reads details without a playback action and saves explicitly with its metadata revision', async () => {
  vi.mocked(presetDetails).mockResolvedValue(catalog);
  const changed = vi.fn();
  render(
    <PresetDetailsDialog
      entry={entry}
      editable
      onCancel={vi.fn()}
      onChanged={changed}
    />,
  );
  await screen.findByText(/Neck pickup/);
  expect(presetDetails).toHaveBeenCalledExactlyOnceWith();
  fireEvent.click(screen.getByRole('button', { name: 'Edit details' }));
  fireEvent.change(screen.getByLabelText('Description'), {
    target: { value: 'Warm lead' },
  });
  fireEvent.change(screen.getByLabelText('Categories'), {
    target: { value: ' Lead , Clean ' },
  });
  expect(presetDetails).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Save details' }));
  await waitFor(() => expect(changed).toHaveBeenCalledOnce());
  expect(presetDetails).toHaveBeenLastCalledWith({
    expected_revision: 'one',
    entry_kind: 'original',
    id: entry.id,
    description: 'Warm lead',
    categories: ['Lead', 'Clean'],
  });
});
it('retains draft text after an uncertain failure and requires reload before retry', async () => {
  vi.mocked(presetDetails)
    .mockResolvedValueOnce(catalog)
    .mockRejectedValueOnce(new Error('Details changed; refresh'));
  render(<PresetDetailsDialog entry={entry} editable onCancel={vi.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Edit details' }));
  fireEvent.change(screen.getByLabelText('Description'), {
    target: { value: 'Keep my draft' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save details' }));
  await screen.findByRole('alert');
  expect(screen.getByLabelText('Description')).toHaveValue('Keep my draft');
  expect(screen.getByRole('button', { name: 'Save details' })).toBeDisabled();
  expect(presetDetails).toHaveBeenCalledTimes(2);
});
it('matches descriptions and categories and preserves unknown metadata as an empty description', () => {
  expect(detailsMatch('Amp', details, 'neck')).toBe(true);
  expect(detailsMatch('Amp', details, 'ambient', 'ambient')).toBe(true);
  expect(detailsMatch('Amp', details, '', 'lead')).toBe(false);
  expect(detailsMatch('Amp', undefined, 'amp')).toBe(true);
  expect(detailsMatch('Amp', undefined, '', 'lead')).toBe(false);
});
