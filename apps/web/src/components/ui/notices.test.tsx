import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { NoticeTray } from '@oxidal/design-system/components/notice-tray';
import { type Notice, useNotice } from '@oxidal/design-system/notices';

function Poster({ notice }: { notice: Notice | null }) {
  useNotice('test', notice);
  return null;
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it('keeps a notice up for two seconds so a flapping state does not blink', () => {
  const view = render(
    <>
      <NoticeTray />
      <Poster notice={{ tone: 'error', text: 'Audio stopped unexpectedly' }} />
    </>,
  );
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Audio stopped unexpectedly',
  );
  view.rerender(
    <>
      <NoticeTray />
      <Poster notice={null} />
    </>,
  );
  act(() => vi.advanceTimersByTime(1500));
  expect(screen.getByRole('alert')).toBeInTheDocument();
  // Back before the hold ends: the same notice stays, without a gap.
  view.rerender(
    <>
      <NoticeTray />
      <Poster notice={{ tone: 'error', text: 'Audio stopped unexpectedly' }} />
    </>,
  );
  view.rerender(
    <>
      <NoticeTray />
      <Poster notice={null} />
    </>,
  );
  act(() => vi.advanceTimersByTime(600));
  expect(screen.queryByRole('alert')).toBeNull();
});

it('runs the action and stays closed until the notice changes', () => {
  const run = vi.fn();
  const view = render(
    <>
      <NoticeTray />
      <Poster
        notice={{
          tone: 'warning',
          text: 'Meters are stale',
          action: { label: 'Audio setup', run },
        }}
      />
    </>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Audio setup' }));
  expect(run).toHaveBeenCalledOnce();
  fireEvent.click(
    screen.getByRole('button', { name: 'Close: Meters are stale' }),
  );
  expect(screen.queryByRole('status')).toBeNull();
  view.rerender(
    <>
      <NoticeTray />
      <Poster notice={{ tone: 'warning', text: 'Connection lost' }} />
    </>,
  );
  expect(screen.getByRole('status')).toHaveTextContent('Connection lost');
});
