import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { tone3000Account } from './api';
import { readReturnTarget, setReturnTarget } from './lib/sessionState';
import { Tone3000Account } from './Tone3000Account';

vi.mock('./api', () => ({ tone3000Account: vi.fn() }));
afterEach(() => {
  cleanup();
  window.location.hash = '';
});

it('returns to the page that asked for the sign-in once connected', async () => {
  vi.mocked(tone3000Account).mockResolvedValue({
    phase: 'connected',
    revision: 1,
    session: 's',
  } as Awaited<ReturnType<typeof tone3000Account>>);
  setReturnTarget({ hash: '#library/discover', label: 'Discover' });
  render(<Tone3000Account connected />);
  fireEvent.click(
    await screen.findByRole('button', { name: 'Back to Discover' }),
  );
  expect(window.location.hash).toBe('#library/discover');
  expect(readReturnTarget()).toBeNull();
  expect(screen.queryByRole('button', { name: 'Back to Discover' })).toBeNull();
});

it('shows an expired grant and resets the actual account session without claiming a sign-in', async () => {
  const expired = {
    session: 'expired-session',
    revision: 4,
    phase: 'error' as const,
    client_id: 'publishable-test',
    user_code: null,
    verification_uri: null,
    expires_at: null,
    error: 'Sign-in code expired',
  };
  vi.mocked(tone3000Account)
    .mockResolvedValueOnce(expired)
    .mockResolvedValue({
      ...expired,
      phase: 'disconnected',
      revision: 5,
      error: null,
    });
  render(<Tone3000Account connected />);
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Sign-in code expired',
  );
  expect(screen.queryByLabelText('Sign-in code')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Reset connection' }));
  expect(tone3000Account).toHaveBeenLastCalledWith({
    state: expired,
    action: { kind: 'disconnect' },
  });
  await waitFor(() =>
    expect(screen.getByRole('status')).toHaveTextContent('Not connected'),
  );
});

it('reports reconnecting without inventing a user identity', async () => {
  vi.mocked(tone3000Account).mockResolvedValue({
    session: 'reconnecting-session',
    revision: 5,
    phase: 'reconnecting',
    client_id: 'publishable-test',
    user_code: null,
    verification_uri: null,
    expires_at: null,
    error: null,
  });
  render(<Tone3000Account connected />);
  expect(
    await screen.findByText("Restoring the device's sign-in…"),
  ).toBeInTheDocument();
  expect(screen.queryByText(/Signed in as/)).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Sign out' })).toBeEnabled();
});
