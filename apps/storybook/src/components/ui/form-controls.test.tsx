import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it } from 'vitest';
import { Checkbox } from './checkbox';
import { Switch } from './switch';

afterEach(cleanup);

it('a switch toggles with click and keyboard and reports its state', async () => {
  const user = userEvent.setup();
  render(<Switch aria-label="Protect" />);
  const control = screen.getByRole('switch', { name: 'Protect' });
  expect(control).toHaveAttribute('aria-checked', 'false');
  await user.click(control);
  expect(control).toHaveAttribute('aria-checked', 'true');
  control.focus();
  await user.keyboard('{Enter}');
  expect(control).toHaveAttribute('aria-checked', 'false');
});

it('a checkbox supports checked and indeterminate', async () => {
  const user = userEvent.setup();
  const { rerender } = render(<Checkbox aria-label="Vocals" />);
  const box = screen.getByRole('checkbox', { name: 'Vocals' });
  expect(box).toHaveAttribute('aria-checked', 'false');
  await user.click(box);
  expect(box).toHaveAttribute('aria-checked', 'true');
  rerender(<Checkbox aria-label="Vocals" checked="indeterminate" />);
  expect(box).toHaveAttribute('aria-checked', 'mixed');
});
