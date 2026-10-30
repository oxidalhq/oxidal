import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { DragFader } from './DragFader';

afterEach(cleanup);

function setup(disabled = false) {
  const calls = { begin: vi.fn(), move: vi.fn(), end: vi.fn() };
  const view = render(
    <DragFader
      value={0.5}
      dragging={false}
      disabled={disabled}
      onBegin={calls.begin}
      onMove={calls.move}
      onEnd={calls.end}
    />,
  );
  const fader = view.container.querySelector('.value-row-fader')!;
  vi.spyOn(fader, 'getBoundingClientRect').mockReturnValue({
    left: 100,
    width: 200,
  } as DOMRect);
  return { fader, ...calls };
}

it('maps the drag position to a 0–1 value, clamped and snapped to hundredths', () => {
  const { fader, begin, move, end } = setup();
  fireEvent.pointerDown(fader, { button: 0, clientX: 150, pointerId: 1 });
  expect(begin).toHaveBeenCalledWith(0.25);
  fireEvent.pointerMove(window, { clientX: 150.2 });
  expect(move).not.toHaveBeenCalled();
  fireEvent.pointerMove(window, { clientX: 333 });
  expect(move).toHaveBeenLastCalledWith(1);
  fireEvent.pointerMove(window, { clientX: 40 });
  expect(move).toHaveBeenLastCalledWith(0);
  fireEvent.pointerUp(window);
  expect(end).toHaveBeenCalledWith(false);
  fireEvent.pointerMove(window, { clientX: 200 });
  expect(move).toHaveBeenCalledTimes(2);
});

it('cancels on pointercancel and ignores input while disabled', () => {
  const live = setup();
  fireEvent.pointerDown(live.fader, { button: 0, clientX: 200, pointerId: 1 });
  fireEvent.pointerCancel(window);
  expect(live.end).toHaveBeenCalledWith(true);
  cleanup();
  const off = setup(true);
  fireEvent.pointerDown(off.fader, { button: 0, clientX: 200, pointerId: 1 });
  expect(off.begin).not.toHaveBeenCalled();
});
