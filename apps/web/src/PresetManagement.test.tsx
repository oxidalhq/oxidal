import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DeletePresetDialog, PresetManagement } from './PresetManagement';
import {
  libraryCatalog,
  removalPreview,
  removePreset,
  type RemovalPreview,
} from './api';
vi.mock('./api', () => ({
  libraryCatalog: vi.fn(),
  removalPreview: vi.fn(),
  removePreset: vi.fn(),
}));
HTMLDialogElement.prototype.showModal ??= function () {
  this.open = true;
};
HTMLDialogElement.prototype.close ??= function () {
  this.open = false;
};
const entry = {
  kind: 'original' as const,
  id: 'a'.repeat(64),
  name: 'Fixture amp',
};
const preview: RemovalPreview = {
  entry: { ...entry, source_name: entry.name, archived: false },
  token: 'preview-one',
  preset_bytes: 1024,
  embedded_bytes: 512,
  remembered_files: 0,
  remembered_bytes: 0,
  blocked: null,
  model_cleanup_unavailable: null,
  models: [
    {
      id: 'model-one',
      name: 'Capture one',
      format: 'nam',
      bytes: 512,
      protected_by: [],
    },
  ],
};
beforeEach(() => {
  vi.mocked(removalPreview).mockResolvedValue(structuredClone(preview));
  vi.mocked(removePreset).mockResolvedValue({
    deleted: { kind: entry.kind, id: entry.id },
    model_files_deleted: 0,
    cleanup_pending: false,
  });
  vi.mocked(libraryCatalog).mockResolvedValue({
    revision: 'labels-one',
    items: [preview.entry],
  });
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
it('opening only previews and keeps separate files unless explicitly selected', async () => {
  const changed = vi.fn();
  render(
    <DeletePresetDialog entry={entry} onChanged={changed} onCancel={vi.fn()} />,
  );
  const box = await screen.findByRole('checkbox');
  expect(box).not.toBeChecked();
  expect(removePreset).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Delete permanently' }));
  await screen.findByText('Preset deleted.');
  expect(removePreset).toHaveBeenCalledWith({
    entry_kind: 'original',
    id: entry.id,
    expected_preview: 'preview-one',
    delete_models: false,
  });
  expect(changed).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  expect(changed).toHaveBeenCalledOnce();
});
it('explicit file cleanup is sent only after choosing the unchecked option', async () => {
  render(
    <DeletePresetDialog entry={entry} onChanged={vi.fn()} onCancel={vi.fn()} />,
  );
  fireEvent.click(await screen.findByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'Delete permanently' }));
  await waitFor(() =>
    expect(removePreset).toHaveBeenCalledWith(
      expect.objectContaining({ delete_models: true }),
    ),
  );
});
it('shared files and playing presets cannot be confirmed for cleanup', async () => {
  vi.mocked(removalPreview).mockResolvedValue({
    ...preview,
    blocked: 'Stop this preset before deleting.',
    models: [{ ...preview.models[0]!, protected_by: ['Preset: Another amp'] }],
  });
  render(
    <DeletePresetDialog entry={entry} onChanged={vi.fn()} onCancel={vi.fn()} />,
  );
  expect(await screen.findByRole('checkbox')).toBeDisabled();
  expect(
    screen.getByRole('button', { name: 'Delete permanently' }),
  ).toBeDisabled();
  expect(removePreset).not.toHaveBeenCalled();
});
it('a stale or uncertain response requires a new preview and never retries deletion', async () => {
  vi.mocked(removePreset).mockRejectedValue(
    new Error('Preview changed; review again'),
  );
  render(
    <DeletePresetDialog entry={entry} onChanged={vi.fn()} onCancel={vi.fn()} />,
  );
  await screen.findByRole('checkbox');
  fireEvent.click(screen.getByRole('button', { name: 'Delete permanently' }));
  await screen.findByRole('alert');
  expect(
    screen.getByRole('button', { name: 'Delete permanently' }),
  ).toBeDisabled();
  expect(removePreset).toHaveBeenCalledOnce();
  vi.mocked(removalPreview).mockResolvedValue({
    ...preview,
    token: 'preview-two',
  });
  fireEvent.click(screen.getByRole('button', { name: 'Refresh preview' }));
  expect(await screen.findByRole('checkbox')).not.toBeChecked();
  expect(removePreset).toHaveBeenCalledOnce();
});
it('rename uses the confirmed catalog revision and leaves immutable identity intact', async () => {
  render(
    <PresetManagement entry={entry} disabled={false} onChanged={vi.fn()} />,
  );
  fireEvent.click(
    screen.getByRole('button', { name: `Preset options: ${entry.name}` }),
  );
  const input = await screen.findByRole('textbox', {
    name: 'Name on this device',
  });
  await waitFor(() => expect(input).toBeEnabled());
  fireEvent.change(input, { target: { value: 'My renamed amp' } });
  fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
  await waitFor(() =>
    expect(libraryCatalog).toHaveBeenCalledWith({
      entry_kind: entry.kind,
      id: entry.id,
      expected_revision: 'labels-one',
      action: { kind: 'rename', name: 'My renamed amp' },
    }),
  );
});
