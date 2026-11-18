import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';

import { Button } from './button';

afterEach(cleanup);

it('exposes variant and size for styling and tests', () => {
  render(
    <Button variant="outline" size="sm">
      Open
    </Button>,
  );
  const button = screen.getByRole('button', { name: 'Open' });
  expect(button).toHaveAttribute('data-variant', 'outline');
  expect(button).toHaveAttribute('data-size', 'sm');
  expect(button).toBeEnabled();
});

it('disables itself and announces busy while loading', () => {
  render(<Button loading>Saving</Button>);
  const button = screen.getByRole('button', { name: 'Saving' });
  expect(button).toBeDisabled();
  expect(button).toHaveAttribute('aria-busy', 'true');
});

it('renders a link when asked to', () => {
  render(
    <Button asChild>
      <a href="#rig">Rig</a>
    </Button>,
  );
  expect(screen.getByRole('link', { name: 'Rig' })).toHaveAttribute(
    'href',
    '#rig',
  );
});
