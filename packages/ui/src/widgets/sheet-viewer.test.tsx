import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';

import { parseSong } from '../lib/song';
import { SheetViewer } from './sheet-viewer';

afterEach(() => {
  cleanup();
  delete document.documentElement.dataset.display;
});

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

it('steps the measured viewport with overlap and clamps both ends in E-paper', async () => {
  document.documentElement.dataset.display = 'epaper';
  const user = userEvent.setup();
  render(<SheetViewer song={SONG} />);
  const words = screen.getByRole('document');
  Object.defineProperties(words, {
    clientHeight: { value: 200 },
    scrollHeight: { value: 550 },
  });
  expect(
    screen.queryByRole('button', { name: 'Start scrolling' }),
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Next page' }));
  expect(words.scrollTop).toBe(180);
  await user.click(screen.getByRole('button', { name: 'Next page' }));
  expect(words.scrollTop).toBe(350);
  await user.click(screen.getByRole('button', { name: 'Previous page' }));
  expect(words.scrollTop).toBe(170);
  await user.click(screen.getByRole('button', { name: 'Previous page' }));
  expect(words.scrollTop).toBe(0);
  await user.click(words);
  expect(screen.getByRole('group', { name: 'Page stepping' })).toBeVisible();
});

it('stops continuous scrolling on a display-mode change and does not resume on return', async () => {
  const user = userEvent.setup();
  render(<SheetViewer song={SONG} />);
  await user.click(screen.getByRole('button', { name: 'Start scrolling' }));
  document.documentElement.dataset.display = 'epaper';
  await waitFor(() =>
    expect(screen.getByRole('group', { name: 'Page stepping' })).toBeVisible(),
  );
  document.documentElement.dataset.display = 'default';
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Start scrolling' }),
    ).toHaveAttribute('aria-pressed', 'false'),
  );
});
