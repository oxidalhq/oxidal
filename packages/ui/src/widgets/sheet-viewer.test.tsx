import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';

import { parseSong } from '../lib/song';
import { SheetViewer } from './sheet-viewer';

afterEach(cleanup);

const SONG = parseSong('{title: Test}\n{key: G}\n[G]Words [D]here', 'chordpro');

it('shows chords above the words and hides them on request', async () => {
  const user = userEvent.setup();
  const { container } = render(<SheetViewer song={SONG} />);
  expect(screen.getByRole('heading', { name: 'Test' })).toBeVisible();
  expect(screen.getByText('Key G')).toBeVisible();
  expect(container.querySelectorAll('[data-chord]')).toHaveLength(2);
  await user.click(screen.getByRole('button', { name: 'Chords' }));
  expect(container.querySelectorAll('[data-chord]')).toHaveLength(0);
});

it('steps text size and scroll speed within their ranges', async () => {
  const user = userEvent.setup();
  const size = vi.fn();
  const speed = vi.fn();
  render(
    <SheetViewer
      song={SONG}
      size={0}
      onSize={size}
      speed={10}
      onSpeed={speed}
    />,
  );
  expect(screen.getByRole('button', { name: 'Smaller text' })).toBeDisabled();
  await user.click(screen.getByRole('button', { name: 'Bigger text' }));
  expect(size).toHaveBeenCalledWith(1);
  expect(screen.getByRole('button', { name: 'Scroll faster' })).toBeDisabled();
  await user.click(screen.getByRole('button', { name: 'Scroll slower' }));
  expect(speed).toHaveBeenCalledWith(9);
});

it('starts and pauses scrolling from the button and from a tap on the words', async () => {
  const user = userEvent.setup();
  render(<SheetViewer song={SONG} />);
  await user.click(screen.getByRole('button', { name: 'Start scrolling' }));
  expect(
    screen.getByRole('button', { name: 'Pause scrolling' }),
  ).toHaveAttribute('aria-pressed', 'true');
  await user.click(screen.getByRole('document'));
  expect(screen.getByRole('button', { name: 'Start scrolling' })).toBeVisible();
});
