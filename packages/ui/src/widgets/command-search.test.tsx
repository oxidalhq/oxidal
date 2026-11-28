import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';

import { CommandSearch, type SearchGroup } from './command-search';

afterEach(cleanup);

function setup(extra: { open?: boolean } = {}) {
  const onOpenChange = vi.fn();
  const slow = vi.fn();
  const rig = vi.fn();
  const groups: SearchGroup[] = [
    {
      title: 'Set list',
      items: [
        { id: 'slow', label: 'Slow Burn', hint: 'Song 1', onChoose: slow },
      ],
    },
    {
      title: 'Screens',
      items: [
        { id: 'rig', label: 'Rig', keywords: 'chain scenes', onChoose: rig },
      ],
    },
  ];
  render(
    <CommandSearch
      open={extra.open ?? true}
      onOpenChange={onOpenChange}
      groups={groups}
    />,
  );
  return { onOpenChange, slow, rig };
}

it('renders nothing while closed', () => {
  setup({ open: false });
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('lists every group and focuses the search field', () => {
  setup();
  expect(screen.getByRole('dialog', { name: 'Search' })).toBeVisible();
  expect(screen.getByRole('combobox', { name: 'Search' })).toHaveFocus();
  expect(screen.getByRole('group', { name: 'Set list' })).toBeVisible();
  expect(screen.getByRole('option', { name: /Slow Burn/ })).toBeVisible();
});

it('filters by label, hint and keywords', async () => {
  const user = userEvent.setup();
  setup();
  await user.keyboard('chain');
  expect(screen.getByRole('option', { name: 'Rig' })).toBeVisible();
  expect(screen.queryByRole('option', { name: /Slow Burn/ })).toBeNull();
  await user.clear(screen.getByRole('combobox'));
  await user.keyboard('zzz');
  expect(screen.getByText('Nothing matches.')).toBeVisible();
});

it('moves with the arrow keys and acts with Enter, then closes', async () => {
  const user = userEvent.setup();
  const { rig, slow, onOpenChange } = setup();
  expect(screen.getByRole('option', { name: /Slow Burn/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await user.keyboard('{ArrowDown}');
  expect(screen.getByRole('option', { name: 'Rig' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await user.keyboard('{Enter}');
  expect(rig).toHaveBeenCalledOnce();
  expect(slow).not.toHaveBeenCalled();
  expect(onOpenChange).toHaveBeenCalledWith(false);
});

it('acts on a click', async () => {
  const user = userEvent.setup();
  const { slow } = setup();
  await user.click(screen.getByRole('option', { name: /Slow Burn/ }));
  expect(slow).toHaveBeenCalledOnce();
});

it('closes with Escape', async () => {
  const user = userEvent.setup();
  const { onOpenChange } = setup();
  await user.keyboard('{Escape}');
  expect(onOpenChange).toHaveBeenCalledWith(false);
});
