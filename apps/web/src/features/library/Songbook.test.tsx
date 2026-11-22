import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import {
  chordSheet,
  chordSheetLinks,
  chordSheetReferences,
  chordSheets,
  deleteChordSheet,
  linkChordSheet,
  saveChordSheet,
  type SheetDocument,
  type SheetLinks,
  type SheetMutation,
  type SheetPage,
} from '../../api';
import { DeviceError } from '../../lib/friendlyError';
import { Songbook } from './Songbook';

vi.mock('../../api', async (original) => ({
  ...(await original<typeof import('../../api')>()),
  chordSheets: vi.fn(),
  chordSheet: vi.fn(),
  chordSheetLinks: vi.fn(),
  chordSheetReferences: vi.fn(),
  saveChordSheet: vi.fn(),
  deleteChordSheet: vi.fn(),
  linkChordSheet: vi.fn(),
}));

let revision: string;
let saved: SheetDocument;
let rows: SheetPage['sheets'];
let links: SheetLinks['links'];
beforeEach(() => {
  vi.resetAllMocks();
  sessionStorage.clear();
  revision = 'list-1';
  rows = [];
  links = [];
  saved = {
    id: 'sheet-1',
    revision: 'saved-1',
    title: 'Stored',
    source: '[G]Original words',
    format: 'chordpro',
  };
  vi.mocked(chordSheets).mockImplementation(async () => ({
    registry_revision: revision,
    sheets: rows,
  }));
  vi.mocked(chordSheetLinks).mockImplementation(async () => ({
    registry_revision: revision,
    links,
  }));
  vi.mocked(chordSheet).mockImplementation(async () => ({ ...saved }));
  vi.mocked(chordSheetReferences).mockImplementation(async () => ({
    registry_revision: revision,
    sheet_revision: saved.revision,
    links,
  }));
  vi.mocked(saveChordSheet).mockImplementation(async (_id, write) => {
    saved = {
      ...saved,
      title: write.title,
      source: write.source,
      format: write.format,
      revision: 'saved-2',
    };
    rows = [saved];
    revision = 'list-2';
    return { registry_revision: revision, sheet: saved };
  });
  vi.mocked(linkChordSheet).mockImplementation(async (write) => {
    links = links.filter(
      (link) => JSON.stringify(link.target) !== JSON.stringify(write.target),
    );
    revision = 'unlinked';
    return { registry_revision: revision, links };
  });
  vi.mocked(deleteChordSheet).mockImplementation(async () => {
    rows = [];
    revision = 'deleted';
    return { registry_revision: revision, sheet: saved };
  });
});
afterEach(cleanup);

async function openSaved() {
  rows = [saved];
  const view = render(<Songbook connected />);
  await userEvent.click(await screen.findByRole('button', { name: /^Stored/ }));
  await screen.findByRole('heading', { name: 'Stored' });
  return view;
}

it('keeps the new-song editor open until the device confirms its exact saved text', async () => {
  const user = userEvent.setup();
  let finish!: (receipt: SheetMutation) => void;
  vi.mocked(saveChordSheet).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  render(<Songbook connected />);
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'New song' })).toBeEnabled(),
  );
  await user.click(screen.getByRole('button', { name: 'New song' }));
  await user.type(screen.getByRole('textbox', { name: 'Title' }), 'My song');
  await user.click(screen.getByRole('textbox', { name: 'Words and chords' }));
  await user.paste('[G]Keep these words');
  await user.click(screen.getByRole('button', { name: 'Save' }));
  expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
  expect(screen.getByRole('textbox', { name: 'Words and chords' })).toHaveValue(
    '[G]Keep these words',
  );
  expect(saveChordSheet).toHaveBeenCalledWith(null, {
    expected: 'list-1',
    title: 'My song',
    source: '[G]Keep these words',
    format: 'chordpro',
  });
  saved = { ...saved, title: 'My song', source: '[G]Keep these words' };
  rows = [saved];
  revision = 'confirmed';
  await act(async () => finish({ registry_revision: revision, sheet: saved }));
  await waitFor(() =>
    expect(
      screen.queryByRole('textbox', { name: 'Words and chords' }),
    ).not.toBeInTheDocument(),
  );
  expect(screen.getByRole('heading', { name: 'My song' })).toBeVisible();
});

it('keeps an open draft editable when disconnected and saves the edits after reconnect', async () => {
  const user = userEvent.setup();
  const view = await openSaved();
  await user.click(screen.getByRole('button', { name: 'Edit' }));
  view.rerender(<Songbook connected={false} />);
  const source = screen.getByRole('textbox', { name: 'Words and chords' });
  expect(source).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  await user.clear(source);
  await user.type(source, 'Drafted offline');
  expect(saveChordSheet).not.toHaveBeenCalled();
  view.rerender(<Songbook connected />);
  await user.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() =>
    expect(saveChordSheet).toHaveBeenCalledWith(
      'sheet-1',
      expect.objectContaining({
        source: 'Drafted offline',
        expected: 'saved-1',
      }),
    ),
  );
});

it('retains a stale draft, shows the latest text, and replaces only its reviewed revision', async () => {
  const user = userEvent.setup();
  await openSaved();
  await user.click(screen.getByRole('button', { name: 'Edit' }));
  const source = screen.getByRole('textbox', { name: 'Words and chords' });
  await user.clear(source);
  await user.type(source, 'My retained draft');
  vi.mocked(saveChordSheet).mockRejectedValueOnce(
    new DeviceError('Chord sheets changed', 'conflict', 409),
  );
  await user.click(screen.getByRole('button', { name: 'Save' }));
  await screen.findByText(
    'The saved version changed. Your text has been kept.',
  );
  expect(source).toHaveValue('My retained draft');
  saved = { ...saved, revision: 'other-viewer', source: 'Other viewer text' };
  await user.click(
    screen.getByRole('button', { name: 'Read latest saved text' }),
  );
  await screen.findByText('Other viewer text');
  expect(source).toHaveValue('My retained draft');
  await user.click(
    screen.getByRole('button', { name: 'Replace latest with my draft' }),
  );
  await waitFor(() => expect(saveChordSheet).toHaveBeenCalledTimes(2));
  expect(vi.mocked(saveChordSheet).mock.calls[0]![1].expected).toBe('saved-1');
  expect(vi.mocked(saveChordSheet).mock.calls[1]).toEqual([
    'sheet-1',
    {
      expected: 'other-viewer',
      title: 'Stored',
      source: 'My retained draft',
      format: 'chordpro',
    },
  ]);
});

it('shows a missing reference, unlinks it explicitly and deletes against the new preview revision', async () => {
  const user = userEvent.setup();
  links = [
    {
      target: { kind: 'track', asset: 'missing-track' },
      sheet: 'sheet-1',
      available: false,
    },
  ];
  await openSaved();
  await user.click(screen.getByRole('button', { name: 'Delete…' }));
  await screen.findByText(/Unlink these references before deleting/);
  expect(screen.getByRole('button', { name: 'Delete sheet' })).toBeDisabled();
  await user.click(
    screen.getByRole('button', { name: 'Unlink Backing track missing-track' }),
  );
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Delete sheet' })).toBeEnabled(),
  );
  expect(linkChordSheet).toHaveBeenCalledWith({
    expected: 'list-1',
    target: { kind: 'track', asset: 'missing-track' },
    sheet: null,
  });
  await user.click(screen.getByRole('button', { name: 'Delete sheet' }));
  await waitFor(() =>
    expect(deleteChordSheet).toHaveBeenCalledWith('sheet-1', {
      expected: 'saved-1',
      registry_revision: 'unlinked',
    }),
  );
});

it('names a repeated set entry and refreshes its dependency before deleting', async () => {
  const user = userEvent.setup();
  vi.mocked(chordSheetReferences).mockResolvedValueOnce({
    registry_revision: revision,
    sheet_revision: saved.revision,
    links: [],
    set_entries: [{ id: 'encore', name: 'Harbour', position: 2 }],
  });
  await openSaved();
  await user.click(screen.getByRole('button', { name: 'Delete…' }));
  expect(await screen.findByText('Song 2 · Harbour')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Delete sheet' })).toBeDisabled();
  expect(screen.queryByText(/No references use this sheet/)).toBeNull();
  await user.click(
    screen.getByRole('button', { name: 'Check references again' }),
  );
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Delete sheet' })).toBeEnabled(),
  );
  expect(deleteChordSheet).not.toHaveBeenCalled();
});

it('reports a confirmed save when only its following list refresh fails, without replaying the write', async () => {
  const user = userEvent.setup();
  await openSaved();
  await user.click(screen.getByRole('button', { name: 'Edit' }));
  await user.type(
    screen.getByRole('textbox', { name: 'Words and chords' }),
    ' changed',
  );
  vi.mocked(chordSheets).mockRejectedValueOnce(
    new TypeError('Failed to fetch'),
  );
  await user.click(screen.getByRole('button', { name: 'Save' }));
  await screen.findByText('Song saved on the device.');
  expect(
    screen.queryByRole('textbox', { name: 'Words and chords' }),
  ).not.toBeInTheDocument();
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeEnabled(),
  );
  await user.click(screen.getByRole('button', { name: 'Refresh' }));
  await screen.findByRole('heading', { name: 'Stored' });
  expect(saveChordSheet).toHaveBeenCalledTimes(1);
  expect(saved.source).toBe('[G]Original words changed');
});
