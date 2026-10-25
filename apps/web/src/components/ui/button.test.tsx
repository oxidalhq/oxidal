import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { Button } from './button';

it('supports keyboard activation and native disabled behavior', async () => {
  const click = vi.fn();
  const user = userEvent.setup();
  const { rerender } = render(<Button onClick={click}>Save mapping</Button>);
  await user.tab();
  expect(screen.getByRole('button')).toHaveFocus();
  await user.keyboard('{Enter}');
  expect(click).toHaveBeenCalledTimes(1);
  rerender(
    <Button disabled onClick={click}>
      Save mapping
    </Button>,
  );
  await user.click(screen.getByRole('button'));
  expect(click).toHaveBeenCalledTimes(1);
});
