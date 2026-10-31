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
vi.mock('./api', () => ({
  libraryCatalog: vi.fn(),
  removalPreview: vi.fn(),
  removePreset: vi.fn(),
}));
const first = {
  kind: 'original' as const,
  id: 'a'.repeat(64),
  name: 'First amp',
  source_name: 'First amp',
  archived: false,
};
const second = {
  kind: 'rig' as const,
  id: 'b'.repeat(64),
  name: 'Second rig',
  source_name: 'Second rig',
  archived: false,
};
const catalog: LibraryCatalog = {
  revision: 'confirmed',
  items: [first, second],
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
