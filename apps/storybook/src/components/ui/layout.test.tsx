import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { Badge } from './badge';
import { Button } from './button';
import { ListRow } from './list-row';
import { Tooltip, TooltipProvider } from './tooltip';

afterEach(cleanup);

it('a clickable row has a title button that activates with Enter beside its own controls', async () => {
  const user = userEvent.setup();
  const open = vi.fn();
  const more = vi.fn();
  render(
    <ListRow
      title="Iron Pulse"
      caption="3:42"
      onClick={open}
      trailing={
        <Button
          size="icon-sm"
          aria-label="More"
          onClick={(event) => {
            event.stopPropagation();
            more();
          }}
        />
      }
    />,
  );
  const row = screen.getByRole('button', { name: /Iron Pulse/ });
  row.focus();
  await user.keyboard('{Enter}');
  expect(open).toHaveBeenCalledTimes(1);
  await user.click(screen.getByRole('button', { name: 'More' }));
  expect(more).toHaveBeenCalledTimes(1);
  expect(open).toHaveBeenCalledTimes(1);
});

it('a badge carries its tone', () => {
  render(<Badge tone="live">Playing</Badge>);
  expect(screen.getByText('Playing')).toHaveAttribute('data-tone', 'live');
});

it('a tooltip names its control on focus', async () => {
  const user = userEvent.setup();
  render(
    <TooltipProvider>
      <Tooltip content="More actions">
        <Button aria-label="More">…</Button>
      </Tooltip>
    </TooltipProvider>,
  );
  await user.tab();
  expect(await screen.findAllByText('More actions')).not.toHaveLength(0);
});
