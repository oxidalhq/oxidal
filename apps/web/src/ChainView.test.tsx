import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { ChainView } from './ChainView';
import type { RigBlockVM } from './rigChain';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const tile = (id: string, empty = false): RigBlockVM => ({
  id,
  label: id,
  kind: 'lv2',
  on: true,
  face: null,
  empty,
});
const lanes = [
  {
    id: 'Chain',
    input: 'IN',
    blocks: [tile('amp'), tile('flanger'), tile('end', true)],
  },
];

/** Lays tiles out left to right, 80px apart, as the browser would. */
function layout(container: HTMLElement) {
  container.querySelectorAll<HTMLElement>('[data-tile]').forEach((el, i) => {
    el.getBoundingClientRect = () =>
      ({ left: i * 80, right: i * 80 + 72, top: 0, bottom: 72 }) as DOMRect;
  });
  container.querySelectorAll<HTMLElement>('[data-lane]').forEach((el) => {
    el.getBoundingClientRect = () =>
      ({ left: 0, right: 400, top: 0, bottom: 72 }) as DOMRect;
  });
}

function view(onMove = vi.fn(), onSelect = vi.fn()) {
  const { container } = render(
    <ChainView
      label="Chain"
      lanes={lanes}
      onSelect={onSelect}
      onAdd={() => {}}
      movable={(id) => id === 'flanger'}
      onMove={onMove}
    />,
  );
  layout(container);
  return {
    onMove,
    onSelect,
    flanger: screen.getByRole('button', { name: 'flanger lv2' }),
  };
}

it('drags an effect with a mouse and drops it before another block', () => {
  const { onMove, onSelect, flanger } = view();
  fireEvent.pointerDown(flanger, {
    button: 0,
    clientX: 116,
    clientY: 30,
    pointerType: 'mouse',
  });
  fireEvent.pointerMove(window, {
    clientX: 20,
    clientY: 30,
    pointerType: 'mouse',
  });
  expect(screen.getByRole('button', { name: 'amp lv2' })).toHaveAttribute(
    'data-drop-before',
  );
  fireEvent.pointerUp(window, { clientX: 20, clientY: 30 });
  fireEvent.click(flanger);
  expect(onMove).toHaveBeenCalledWith('flanger', 0, 'amp');
  // The pointerup that ends a drag is not also a tap.
  expect(onSelect).not.toHaveBeenCalled();
  fireEvent.click(flanger);
  expect(onSelect).toHaveBeenCalledWith('flanger');
});

it('needs a hold on touch, so a swipe still scrolls', () => {
  vi.useFakeTimers();
  const { onMove, flanger } = view();
  fireEvent.pointerDown(flanger, {
    button: 0,
    clientX: 116,
    clientY: 30,
    pointerType: 'touch',
  });
  fireEvent.pointerMove(window, {
    clientX: 40,
    clientY: 30,
    pointerType: 'touch',
  });
  fireEvent.pointerUp(window);
  expect(onMove).not.toHaveBeenCalled();
  fireEvent.pointerDown(flanger, {
    button: 0,
    clientX: 116,
    clientY: 30,
    pointerType: 'touch',
  });
  act(() => vi.advanceTimersByTime(400));
  fireEvent.pointerMove(window, {
    clientX: 20,
    clientY: 30,
    pointerType: 'touch',
  });
  fireEvent.pointerUp(window);
  expect(onMove).toHaveBeenCalledWith('flanger', 0, 'amp');
});

it('identifies the sounding lane while inactive lanes recede', () => {
  render(
    <ChainView
      label="Scene branches"
      parallel
      lanes={[
        { id: 'Clean', input: '1', active: true, blocks: [tile('clean')] },
        { id: 'Lead', input: '2', dim: true, blocks: [tile('lead')] },
      ]}
      onSelect={() => {}}
    />,
  );
  expect(
    screen.getByRole('group', { name: 'Clean signal chain, sounding' }),
  ).toHaveAttribute('aria-current', 'true');
  expect(screen.getByText('Sounding')).toBeVisible();
  expect(
    screen.getByRole('group', { name: 'Lead signal chain' }),
  ).toHaveAttribute('data-dim');
});

it('ignores a second pointer and cancels a lifted effect on Escape', () => {
  const { flanger, onMove } = view();
  fireEvent.pointerDown(flanger, {
    button: 0,
    pointerId: 3,
    clientX: 116,
    clientY: 30,
    pointerType: 'mouse',
  });
  fireEvent.pointerMove(window, {
    pointerId: 3,
    clientX: 20,
    clientY: 30,
    pointerType: 'mouse',
  });
  fireEvent.pointerUp(window, { pointerId: 7 });
  expect(onMove).not.toHaveBeenCalled();
  expect(flanger).toHaveAttribute('data-lifted');
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(flanger).not.toHaveAttribute('data-lifted');
  fireEvent.pointerUp(window, { pointerId: 3 });
  expect(onMove).not.toHaveBeenCalled();
});
