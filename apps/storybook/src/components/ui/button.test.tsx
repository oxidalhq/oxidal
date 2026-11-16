import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { Button } from './button';

afterEach(cleanup);

it('renders the variant as a data attribute for styling and tests', () => {
  render(<Button variant="outline">Open</Button>);
  const button = screen.getByRole('button', { name: 'Open' });
  expect(button).toHaveAttribute('data-variant', 'outline');
  expect(button).toBeEnabled();
});

it('keeps the touch-target height class on the icon size', () => {
  render(
    <Button size="icon" aria-label="Delete">
      ×
    </Button>,
  );
  expect(screen.getByRole('button', { name: 'Delete' }).className).toContain(
    'size-[var(--touch-target)]',
  );
});
