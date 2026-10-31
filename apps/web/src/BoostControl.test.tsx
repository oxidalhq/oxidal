import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { boosts, type BoostState } from './api';
import { BoostControl } from './BoostControl';
vi.mock('./api', () => ({ boosts: vi.fn() }));

// jsdom has no modal dialog.
HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
  this.open = true;
};
HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
  this.open = false;
};
let stored: Record<string, number>;
beforeEach(() => {
  stored = { 'scenes:p': 1 };
  vi.mocked(boosts).mockImplementation(async (update) => {
    if (update) {
      if (update.boost_db === 0) delete stored[update.key];
      else stored[update.key] = update.boost_db;
    }
    return { boosts: { ...stored }, playing: [], applied_db: 0 } as BoostState;
  });
});
afterEach(cleanup);

it('adds the preset and scene boosts and sets each in 0.5 dB steps', async () => {
  render(
    <BoostControl
      targets={[
        { key: 'scenes:p', label: 'Clean to heavy' },
        { key: 'scenes:p#solo', label: 'Scene · Solo' },
      ]}
    />,
  );
  await act(async () => {});
  fireEvent.click(screen.getByRole('button', { name: 'Boost +1.0 dB' }));
  const dialog = within(screen.getByRole('dialog'));
  for (let i = 0; i < 6; i++) {
    fireEvent.click(
      dialog.getByRole('button', { name: 'Scene · Solo: boost up 0.5 dB' }),
    );
    await act(async () => {});
  }
  expect(stored['scenes:p#solo']).toBe(3);
  expect(dialog.getByText('Playing now: +4.0 dB in all.')).toBeInTheDocument();
  fireEvent.click(dialog.getAllByRole('button', { name: 'Reset' })[0]!);
  await act(async () => {});
  expect(stored).toEqual({ 'scenes:p#solo': 3 });
  fireEvent.click(dialog.getByRole('button', { name: 'Close dialog' }));
  expect(
    screen.getByRole('button', { name: 'Boost +3.0 dB' }),
  ).toBeInTheDocument();
});

it('hides itself on a daemon without boosts', async () => {
  vi.mocked(boosts).mockResolvedValue(null);
  const view = render(
    <BoostControl targets={[{ key: 'scenes:p', label: 'Preset' }]} />,
  );
  await act(async () => {});
  expect(view.container).toBeEmptyDOMElement();
});
