import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { DebugConsole } from './DebugConsole';
vi.mock('./api', () => ({
  debugCommand: vi.fn(async () => ({ available: false, message: 'Disabled' })),
}));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it('follows bounded log snapshots only while open, visible and enabled', async () => {
  vi.useFakeTimers();
  const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  const fetcher = vi.fn(async () => new Response('native log tail'));
  vi.stubGlobal('fetch', fetcher);
  const view = render(<DebugConsole />);
  const details = view.container.querySelector('details')!;
  await act(async () => {
    details.open = true;
    fireEvent(details, new Event('toggle'));
  });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Follow logs' }));
  });
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(
    screen.getByRole('textbox', { name: 'Collected native logs' }),
  ).toHaveValue('native log tail');
  hidden.mockReturnValue(true);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000);
  });
  expect(fetcher).toHaveBeenCalledTimes(1);
  hidden.mockReturnValue(false);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000);
  });
  expect(fetcher).toHaveBeenCalledTimes(2);
  fireEvent.click(screen.getByRole('button', { name: 'Freeze logs' }));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000);
  });
  expect(fetcher).toHaveBeenCalledTimes(2);
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Follow logs' }));
  });
  await act(async () => {
    details.open = false;
    fireEvent(details, new Event('toggle'));
  });
  const count = fetcher.mock.calls.length;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10000);
  });
  expect(fetcher).toHaveBeenCalledTimes(count);
});
