import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it } from 'vitest';

import { SideRail } from './side-rail';

beforeEach(() => localStorage.clear());
afterEach(cleanup);

function rail(extra: Partial<React.ComponentProps<typeof SideRail>> = {}) {
  render(
    <div className="flex">
      <SideRail
        id="test"
        title="Presets"
        icon={<span>i</span>}
        status="3/5"
        side="left"
        {...extra}
      >
        <p>Slow Burn</p>
      </SideRail>
      <main>Chain</main>
    </div>,
  );
}

it('starts minimised, with its status on the strip and the panel closed', () => {
  rail();
  expect(screen.getByRole('button', { name: /^Open Presets/ })).toBeVisible();
  expect(screen.getByText('3/5')).toBeVisible();
  expect(screen.queryByText('Slow Burn')).toBeNull();
});

it('peeks over the work when opened, and closes when the player works elsewhere', async () => {
  const user = userEvent.setup();
  rail();
  await user.click(screen.getByRole('button', { name: /^Open Presets/ }));
  expect(screen.getByRole('complementary', { name: 'Presets' })).toBeVisible();
  expect(screen.getByText('Slow Burn')).toBeVisible();
  await user.click(screen.getByText('Chain'));
  expect(screen.queryByText('Slow Burn')).toBeNull();
});

it('closes a peek with Escape', async () => {
  const user = userEvent.setup();
  rail();
  await user.click(screen.getByRole('button', { name: /^Open Presets/ }));
  await user.keyboard('{Escape}');
  expect(screen.queryByText('Slow Burn')).toBeNull();
});

it('pins open, remembers it, and minimises again', async () => {
  const user = userEvent.setup();
  rail();
  await user.click(screen.getByRole('button', { name: /^Open Presets/ }));
  await user.click(screen.getByRole('button', { name: 'Pin Presets open' }));
  expect(screen.getByText('Slow Burn')).toBeVisible();
  expect(localStorage.getItem('oxidal.rail.test')).toBe('"pinned"');
  cleanup();
  rail();
  expect(screen.getByText('Slow Burn')).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Minimise Presets' }));
  expect(screen.queryByText('Slow Burn')).toBeNull();
});

it('moves to the other side and remembers that', async () => {
  const user = userEvent.setup();
  rail({ defaultMode: 'pinned' });
  await user.click(
    screen.getByRole('button', { name: 'Move Presets to the right' }),
  );
  expect(document.querySelector('[data-slot="side-rail"]')).toHaveAttribute(
    'data-side',
    'right',
  );
  expect(localStorage.getItem('oxidal.rail.test.side')).toBe('"right"');
});
