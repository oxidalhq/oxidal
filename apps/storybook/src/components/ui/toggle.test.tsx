import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it } from 'vitest';
import { Toggle } from './toggle';
import { SegmentedControl, Segment } from './segmented';

afterEach(cleanup);

it('a toggle flips its pressed state on click and space', async () => {
  const user = userEvent.setup();
  render(<Toggle>Loop</Toggle>);
  const toggle = screen.getByRole('button', { name: 'Loop' });
  expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await user.click(toggle);
  expect(toggle).toHaveAttribute('aria-pressed', 'true');
  toggle.focus();
  await user.keyboard(' ');
  expect(toggle).toHaveAttribute('aria-pressed', 'false');
});

it('a segmented control keeps exactly one segment on', async () => {
  const user = userEvent.setup();
  render(
    <SegmentedControl defaultValue="list" aria-label="View">
      <Segment value="list">List</Segment>
      <Segment value="artwork">Artwork</Segment>
    </SegmentedControl>,
  );
  const list = screen.getByRole('radio', { name: 'List' });
  const artwork = screen.getByRole('radio', { name: 'Artwork' });
  expect(list).toHaveAttribute('data-state', 'on');
  await user.click(artwork);
  expect(artwork).toHaveAttribute('data-state', 'on');
  expect(list).toHaveAttribute('data-state', 'off');
  // Clicking the active segment keeps it on; a choice cannot be cleared.
  await user.click(artwork);
  expect(artwork).toHaveAttribute('data-state', 'on');
});
