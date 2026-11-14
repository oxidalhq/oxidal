import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { RigHeaderDuplicate } from './RigHeaderDuplicate';
import { duplicatePreset } from '../library/setList';

vi.mock('../library/setList', () => ({ duplicatePreset: vi.fn() }));
vi.mock('../library/OfflineEditor', () => ({
  OfflineEditor: ({ revision }: { revision: string }) => (
    <div role="dialog" aria-label={`Editing ${revision}`} />
  ),
}));

afterEach(() => {
  cleanup();
  vi.mocked(duplicatePreset).mockReset();
});

const copy = (kind: 'rig' | 'owned') =>
  ({
    catalog: {},
    copy: { kind, id: `${kind}-copy`, name: 'Crunch copy' },
  }) as unknown as Awaited<ReturnType<typeof duplicatePreset>>;

it('duplicates a TONE3000 chain saved in Mine and says where the copy is', async () => {
  vi.mocked(duplicatePreset).mockResolvedValue(copy('owned'));
  render(
    <RigHeaderDuplicate
      entry={{ kind: 'owned', id: 'chain' }}
      connected
      disabled={false}
      changed={false}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Duplicate preset' }));
  expect(
    await screen.findByText('"Crunch copy" is in Mine, not in the set list.'),
  ).toBeVisible();
  expect(duplicatePreset).toHaveBeenCalledWith({ kind: 'owned', id: 'chain' });
  // The offline editor opens presets with scenes or effects only.
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('opens a duplicated preset with scenes stopped in the editor', async () => {
  vi.mocked(duplicatePreset).mockResolvedValue(copy('rig'));
  render(
    <RigHeaderDuplicate
      entry={{ kind: 'rig', id: 'r1' }}
      connected
      disabled={false}
      changed
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Duplicate preset' }));
  expect(
    await screen.findByRole('dialog', { name: 'Editing rig-copy' }),
  ).toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent(
    'Edits you have not saved are not in the copy.',
  );
});

it('has nothing to duplicate without a saved preset', () => {
  render(
    <RigHeaderDuplicate
      entry={null}
      connected
      disabled={false}
      changed={false}
    />,
  );
  expect(
    screen.getByRole('button', { name: 'Duplicate preset' }),
  ).toBeDisabled();
});
