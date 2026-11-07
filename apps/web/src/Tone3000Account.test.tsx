import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { Tone3000Account } from './Tone3000Account';
import { tone3000Account } from './api';
import { readReturnTarget, setReturnTarget } from './lib/sessionState';

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
