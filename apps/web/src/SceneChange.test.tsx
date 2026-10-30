import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { sceneBlends } from './api';
import { SceneChange } from './SceneChange';
vi.mock('./api', () => ({ sceneBlends: vi.fn() }));
HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
  this.open = true;
};
HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
  this.open = false;
};
let stored: Record<string, number>;
beforeEach(() => {
  stored = {};
  vi.mocked(sceneBlends).mockImplementation(async (update) => {
    if (update) {
      if (update.blend_ms) stored[update.preset] = update.blend_ms;
      else delete stored[update.preset];
    }
    return { blends: { ...stored } };
  });
});
afterEach(cleanup);

it('switches between trails and a blend and saves the time when let go', async () => {
  render(<SceneChange preset="p" />);
  await act(async () => {});
  fireEvent.click(screen.getByRole('button', { name: 'Scene change: trails' }));
  const dialog = within(screen.getByRole('dialog'));
  fireEvent.click(dialog.getByRole('button', { name: 'Blend' }));
  await act(async () => {});
  expect(stored).toEqual({ p: 2000 });
  const slider = dialog.getByRole('slider', { name: 'Blend time' });
  fireEvent.change(slider, { target: { value: '4.5' } });
  expect(stored).toEqual({ p: 2000 });
  fireEvent.pointerUp(slider);
  await act(async () => {});
  expect(stored).toEqual({ p: 4500 });
  expect(
    screen.getByRole('button', { name: 'Scene change: blend 4.5 s' }),
  ).toBeInTheDocument();
  fireEvent.click(dialog.getByRole('button', { name: 'Trails' }));
  await act(async () => {});
  expect(stored).toEqual({});
});
