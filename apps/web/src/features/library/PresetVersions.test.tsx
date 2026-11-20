import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { presetVersions, type VersionView } from '../../api';
import { PresetVersions } from './PresetVersions';

vi.mock('../../api', () => ({ presetVersions: vi.fn() }));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

it('reads on demand, retries a lost copy response once with the same identity, and edits that version offline', async () => {
  const first = 'a'.repeat(64);
  const main = { id: 'main', name: 'Main', content: first };
  const view: VersionView = {
    catalog_revision: 'old',
    preset: {
      logical_id: 'rig:' + first,
      kind: 'rig',
      generation: 0,
      default_version: 'main',
      versions: [main],
    },
  };
  const copied = {
    ...view,
    catalog_revision: 'new',
    preset: {
      ...view.preset,
      generation: 1,
      versions: [main, { id: 'b'.repeat(64), name: 'Quiet', content: first }],
    },
  };
  const onEdit = vi.fn();
  vi.mocked(presetVersions)
    .mockResolvedValueOnce(view)
    .mockRejectedValueOnce(new Error('Disconnected'))
    .mockResolvedValueOnce(copied);
  render(<PresetVersions kind="rig" id={first} editable onEdit={onEdit} />);
  expect(presetVersions).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'View versions' }));
  const input = await screen.findByRole('textbox', { name: 'Version name' });
  fireEvent.change(input, { target: { value: 'Quiet' } });
  const copy = screen.getByRole('button', { name: 'Copy as new version' });
  fireEvent.click(copy);
  await screen.findByRole('alert');
  fireEvent.click(copy);
  await screen.findByRole('option', { name: 'Quiet' });
  expect(vi.mocked(presetVersions).mock.calls[1]).toEqual(
    vi.mocked(presetVersions).mock.calls[2],
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Edit this version offline' }),
  );
  expect(onEdit).toHaveBeenCalledWith({
    first,
    version: 'b'.repeat(64),
    expected_content: first,
    expected_revision: 'new',
  });
  expect(presetVersions).toHaveBeenCalledTimes(3);
});
