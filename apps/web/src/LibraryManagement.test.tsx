import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LibraryManagement } from './LibraryManagement';
import { libraryCatalog, type LibraryCatalog } from './api';
vi.mock('./presetChoices', () => ({
  playScenes: vi.fn(),
  playTone3000: vi.fn(),
}));
vi.mock('./features/library/oxidal/finish', () => ({
  finishEffectsOnly: vi.fn(async () => 0),
}));
vi.mock('./api', () => ({
  libraryCatalog: vi.fn(),
  removalPreview: vi.fn(),
  removePreset: vi.fn(),
}));
const first = {
  kind: 'owned' as const,
  id: 'a'.repeat(64),
  name: 'First amp',
  source_name: 'First amp',
  archived: false,
  origin: 'mine' as const,
  in_set_list: true,
};
const second = {
  kind: 'rig' as const,
  id: 'b'.repeat(64),
  name: 'Second rig',
  source_name: 'Second rig',
  archived: false,
  origin: 'mine' as const,
  in_set_list: true,
};
const outside = {
  kind: 'rig' as const,
  id: 'c'.repeat(64),
  name: 'Spare rig',
  source_name: 'Spare rig',
  archived: false,
  origin: 'mine' as const,
  in_set_list: false,
};
const example = {
  kind: 'rig' as const,
  id: 'd'.repeat(64),
  name: 'Two Rooms',
  source_name: 'Two Rooms',
  archived: false,
  origin: 'oxidal_example' as const,
  in_set_list: false,
};
const catalog: LibraryCatalog = {
  revision: 'confirmed',
  items: [first, second, outside, example],
};
beforeEach(() => {
  vi.mocked(libraryCatalog).mockResolvedValue(catalog);
  vi.spyOn(window, 'scrollBy').mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.resetAllMocks();
});
async function view() {
  const { container } = render(
    <LibraryManagement connected={true} onChanged={vi.fn()} />,
  );
  const handle = await screen.findByRole('button', { name: 'Drag Second rig' });
  handle.setPointerCapture = vi.fn();
  container
    .querySelectorAll<HTMLElement>('[data-library-entry]')
    .forEach((row, index) => {
      row.getBoundingClientRect = () => ({
        top: index * 100,
        bottom: index * 100 + 100,
        height: 100,
        left: 0,
        right: 400,
        width: 400,
        x: 0,
        y: index * 100,
        toJSON: () => ({}),
      });
    });
  container.querySelector<HTMLElement>('.set-list')!.getBoundingClientRect =
    () => ({
      top: 0,
      bottom: 400,
      height: 400,
      left: 0,
      right: 400,
      width: 400,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
  return handle;
}
it('keyboard movement uses the confirmed set-list revision across preset kinds', async () => {
  const handle = await view();
  fireEvent.keyDown(handle, { key: 'ArrowUp' });
  expect(libraryCatalog).toHaveBeenCalledWith({
    expected_revision: 'confirmed',
    entry_kind: 'rig',
    id: second.id,
    action: { kind: 'move', up: true },
  });
  await act(async () => {
    await Promise.resolve();
  });
});
it('offers a streamed library backup without account sessions', async () => {
  await view();
  expect(screen.getByRole('link', { name: 'Download backup' })).toHaveAttribute(
    'href',
    '/api/v1/backup/library',
  );
  expect(
    screen.getByText(
      /Account sign-in and diagnostic history stay on this unit/,
    ),
  ).toBeInTheDocument();
});
it('touch needs a hold and does not reorder when the gesture moves before it', async () => {
  const handle = await view();
  vi.useFakeTimers();
  fireEvent.pointerDown(handle, {
    button: 0,
    pointerId: 1,
    isPrimary: true,
    pointerType: 'touch',
    clientX: 20,
    clientY: 150,
  });
  fireEvent.pointerMove(handle, {
    pointerId: 1,
    isPrimary: true,
    pointerType: 'touch',
    clientX: 20,
    clientY: 20,
  });
  act(() => vi.advanceTimersByTime(400));
  fireEvent.pointerUp(handle, { pointerId: 1, pointerType: 'touch' });
  expect(vi.mocked(libraryCatalog).mock.calls.filter((c) => c[0])).toHaveLength(
    0,
  );
});
it('a held touch sends one identity-based drop when released', async () => {
  const handle = await view();
  vi.useFakeTimers();
  fireEvent.pointerDown(handle, {
    button: 0,
    pointerId: 1,
    isPrimary: true,
    pointerType: 'touch',
    clientX: 20,
    clientY: 150,
  });
  act(() => vi.advanceTimersByTime(400));
  fireEvent.pointerMove(handle, {
    pointerId: 1,
    isPrimary: true,
    pointerType: 'touch',
    clientX: 20,
    clientY: 20,
  });
  expect(vi.mocked(libraryCatalog).mock.calls.filter((c) => c[0])).toHaveLength(
    0,
  );
  fireEvent.pointerUp(handle, { pointerId: 1, pointerType: 'touch' });
  expect(libraryCatalog).toHaveBeenCalledWith({
    expected_revision: 'confirmed',
    entry_kind: 'rig',
    id: second.id,
    action: { kind: 'place', before: { kind: first.kind, id: first.id } },
  });
  await act(async () => {
    await Promise.resolve();
  });
});

it('lists only set-list members, numbered, and keeps the rest of Mine in its own group', async () => {
  await view();
  expect(screen.getByLabelText('Set-list position 1')).toHaveTextContent(
    '1 · PC 1',
  );
  expect(screen.queryByRole('heading', { name: 'Spare rig' })).toBeNull();
  // A read-only Oxidal sound that is not in the set list is not shown here.
  expect(screen.queryByText('Two Rooms')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Show' }));
  vi.mocked(libraryCatalog).mockResolvedValueOnce(catalog);
  vi.mocked(libraryCatalog).mockResolvedValueOnce({
    ...catalog,
    revision: 'next',
    items: [first, second, { ...outside, in_set_list: true }, example],
  });
  fireEvent.click(
    screen.getByRole('button', { name: 'Add Spare rig to the set list' }),
  );
  expect(
    await screen.findByText('Added to the set list as #3.'),
  ).toBeInTheDocument();
  expect(libraryCatalog).toHaveBeenCalledWith({
    expected_revision: 'confirmed',
    entry_kind: 'rig',
    id: outside.id,
    action: { kind: 'set_list', member: true },
  });
});
it('the ⋯ menu removes a preset from the set list and keeps it in Mine', async () => {
  await view();
  fireEvent.click(screen.getByRole('button', { name: 'More for Second rig' }));
  expect(
    screen.getAllByRole('menuitem').map((item) => item.textContent),
  ).toEqual(['Open', 'Duplicate', 'Remove from set list', 'MIDI']);
  vi.mocked(libraryCatalog).mockResolvedValueOnce(catalog);
  vi.mocked(libraryCatalog).mockResolvedValueOnce({
    ...catalog,
    items: [first, { ...second, in_set_list: false }, outside, example],
  });
  fireEvent.click(
    screen.getByRole('menuitem', { name: 'Remove from set list' }),
  );
  expect(
    await screen.findByText(
      'Removed Second rig from the set list. It stays in Mine.',
    ),
  ).toBeInTheDocument();
  expect(screen.getByText('Not in the set list (2)')).toBeInTheDocument();
});
it('S-20: Add starter set list appends after the existing entries', async () => {
  await view();
  vi.mocked(libraryCatalog).mockResolvedValueOnce(catalog);
  vi.mocked(libraryCatalog).mockResolvedValueOnce(catalog);
  vi.mocked(libraryCatalog).mockResolvedValueOnce({
    ...catalog,
    starter_offered: true,
    items: [first, second, outside, { ...example, in_set_list: true }],
  });
  fireEvent.click(screen.getByRole('button', { name: 'Add starter set list' }));
  expect(
    await screen.findByText(
      /Added 1 after your 2 existing entries\. Nothing was replaced\./,
    ),
  ).toBeInTheDocument();
  expect(libraryCatalog).toHaveBeenCalledWith({
    expected_revision: 'confirmed',
    action: {
      kind: 'starter',
      entries: [{ kind: 'rig', id: example.id }],
    },
  });
});
