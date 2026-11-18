import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { Button } from './button';
import { useConfirm } from './confirm';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './dropdown-menu';
import { NoticeTray } from './notice-tray';
import { notify, resetNotices, useNotice } from './notices';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetHeader,
  SheetTrigger,
} from './sheet';

afterEach(cleanup);
beforeEach(resetNotices);

function Asker({ onAnswer }: { onAnswer: (ok: boolean) => void }) {
  const { ask, dialog } = useConfirm();
  return (
    <>
      <Button
        onClick={async () =>
          onAnswer(
            await ask({
              title: 'Delete?',
              confirm: 'Delete',
              destructive: true,
            }),
          )
        }
      >
        Delete…
      </Button>
      {dialog}
    </>
  );
}

it('confirm resolves true on the action and false on Escape', async () => {
  const user = userEvent.setup();
  const answer = vi.fn();
  render(<Asker onAnswer={answer} />);
  await user.click(screen.getByRole('button', { name: 'Delete…' }));
  expect(screen.getByRole('dialog', { name: 'Delete?' })).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Delete' }));
  expect(answer).toHaveBeenLastCalledWith(true);
  await user.click(screen.getByRole('button', { name: 'Delete…' }));
  await user.keyboard('{Escape}');
  expect(answer).toHaveBeenLastCalledWith(false);
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('a sheet opens from its trigger and closes with its Close button', async () => {
  const user = userEvent.setup();
  render(
    <Sheet>
      <SheetTrigger asChild>
        <Button>Edit</Button>
      </SheetTrigger>
      <SheetContent>
        <SheetHeader title="Plexi 50" />
        <SheetBody>Controls</SheetBody>
      </SheetContent>
    </Sheet>,
  );
  await user.click(screen.getByRole('button', { name: 'Edit' }));
  expect(screen.getByRole('dialog', { name: 'Plexi 50' })).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Close' }));
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('a dropdown menu runs the chosen item', async () => {
  const user = userEvent.setup();
  const rename = vi.fn();
  render(
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button>More</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem onSelect={rename}>Rename</DropdownMenuItem>
        <DropdownMenuItem destructive>Delete…</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>,
  );
  await user.click(screen.getByRole('button', { name: 'More' }));
  await user.click(await screen.findByRole('menuitem', { name: 'Rename' }));
  expect(rename).toHaveBeenCalledTimes(1);
});

function Poster({ lost }: { lost: boolean }) {
  useNotice(
    'connection',
    lost ? { tone: 'warning', text: 'Connection lost' } : null,
  );
  return <NoticeTray placement="inline" />;
}

it('a state notice is held two seconds after it clears and a toast leaves on its own', () => {
  vi.useFakeTimers();
  const { rerender } = render(<Poster lost />);
  expect(screen.getByRole('status')).toHaveTextContent('Connection lost');
  rerender(<Poster lost={false} />);
  expect(screen.getByRole('status')).toHaveTextContent('Connection lost');
  act(() => {
    vi.advanceTimersByTime(2100);
  });
  expect(screen.queryByRole('status')).toBeNull();
  act(() => {
    notify({ tone: 'success', text: 'Saved' }, 1000);
  });
  expect(screen.getByRole('status')).toHaveTextContent('Saved');
  act(() => {
    vi.advanceTimersByTime(1100);
  });
  expect(screen.queryByRole('status')).toBeNull();
  vi.useRealTimers();
});
