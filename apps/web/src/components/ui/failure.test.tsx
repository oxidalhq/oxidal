import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
} from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { DeviceError } from '../../lib/friendlyError';
import { useFailure } from '../../lib/useFailure';
import { FailureNotice, RecoveryAction } from './failure';

afterEach(cleanup);

it('offers exactly the recovery the error code allows', () => {
  const { result } = renderHook(() => useFailure());
  const retry = vi.fn();
  const refresh = vi.fn();
  act(() =>
    result.current.fail(new DeviceError('Busy', 'busy', 409), 'save', retry),
  );
  const { rerender } = render(
    <FailureNotice failure={result.current.failure} onRefresh={refresh} />,
  );
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Could not save. Another change is still running on the device.',
  );
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(retry).toHaveBeenCalledOnce();

  act(() =>
    result.current.fail(
      new DeviceError('Session changed', 'conflict', 409),
      'save',
    ),
  );
  rerender(
    <FailureNotice failure={result.current.failure} onRefresh={refresh} />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  expect(refresh).toHaveBeenCalledOnce();

  // Invalid requests and Protect get the explanation without a button.
  for (const error of [
    new DeviceError('Bad name', 'invalid', 422),
    new DeviceError(
      'Protect is on. Turn Protect off to change this.',
      'locked',
      423,
    ),
  ]) {
    act(() => result.current.fail(error, 'save', retry));
    rerender(
      <FailureNotice failure={result.current.failure} onRefresh={refresh} />,
    );
    expect(screen.queryByRole('button')).toBeNull();
  }
  act(() => result.current.clear());
  rerender(
    <FailureNotice failure={result.current.failure} onRefresh={refresh} />,
  );
  expect(screen.queryByRole('alert')).toBeNull();
});

it('keeps the device text in Details when the message rewords it', () => {
  const { result } = renderHook(() => useFailure());
  act(() =>
    result.current.fail(
      new DeviceError(
        'Preset library operation already in progress',
        'busy',
        409,
      ),
      'save',
    ),
  );
  render(<FailureNotice failure={result.current.failure} />);
  fireEvent.click(screen.getByText('Details'));
  expect(
    screen.getByText('Preset library operation already in progress'),
  ).toBeVisible();
});

it('shows the device’s words beside a screen’s own message', () => {
  const { result } = renderHook(() => useFailure());
  act(() =>
    result.current.fail(
      new DeviceError('worker queue full', 'busy', 409),
      'start the tuner',
      () => {},
    ),
  );
  render(<RecoveryAction failure={result.current.failure} />);
  fireEvent.click(screen.getByText('Details'));
  expect(screen.getByText('worker queue full')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Try again' })).toBeVisible();
});
