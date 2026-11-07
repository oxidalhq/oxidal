import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { RigSheet } from './RigSheet';

afterEach(cleanup);

it('docks block controls and hides them to a named bar, by button or Esc', () => {
  render(
    <RigSheet title="JHS Morning Glory" detail="Path · Crunch verb">
      <button type="button">Bass 5</button>
    </RigSheet>,
  );
  const sheet = screen.getByRole('region', { name: 'Block controls' });
  expect(sheet).toHaveTextContent('JHS Morning Glory');
  const control = screen.getByRole('button', { name: 'Bass 5' });
  control.focus();
  fireEvent.keyDown(control, { key: 'Escape' });
  expect(screen.queryByRole('button', { name: 'Bass 5' })).toBeNull();
  const show = screen.getByRole('button', {
    name: 'Show controls: JHS Morning Glory',
  });
  expect(show).toHaveAttribute('aria-expanded', 'false');
  expect(document.activeElement).toBe(show);
  fireEvent.click(show);
  expect(screen.getByRole('button', { name: 'Bass 5' })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Hide controls' }));
  expect(screen.queryByRole('button', { name: 'Bass 5' })).toBeNull();
});
