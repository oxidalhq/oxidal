import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { InlineFader } from './slider';

beforeEach(() => {
  vi.stubGlobal(
    'PointerEvent',
    class extends MouseEvent {
      pointerId: number;
      constructor(
        type: string,
        event: MouseEventInit & { pointerId?: number },
      ) {
        super(type, event);
        this.pointerId = event.pointerId ?? 1;
      }
    },
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('keeps preview ownership on one pointer and ends each gesture exactly once', () => {
  const onBegin = vi.fn();
  const onMove = vi.fn();
  const onEnd = vi.fn();
  const { container, unmount } = render(
    <InlineFader
      value={0.2}
      dragging={false}
      disabled={false}
      onBegin={onBegin}
      onMove={onMove}
      onEnd={onEnd}
    />,
  );
  const fader = container.querySelector<HTMLElement>(
    '[data-slot=inline-fader]',
  )!;
  fader.getBoundingClientRect = () => ({ left: 0, width: 100 }) as DOMRect;
  expect(onBegin).not.toHaveBeenCalled();
  expect(onEnd).not.toHaveBeenCalled();
  fireEvent.pointerDown(fader, { pointerId: 1, button: 0, clientX: 30 });
  expect(onBegin).toHaveBeenLastCalledWith(0.3);
  fireEvent.pointerMove(window, { pointerId: 2, clientX: 90 });
  fireEvent.pointerUp(window, { pointerId: 2 });
  expect(onMove).not.toHaveBeenCalled();
  expect(onEnd).not.toHaveBeenCalled();
  fireEvent.pointerMove(window, { pointerId: 1, clientX: 40 });
  expect(onMove).toHaveBeenLastCalledWith(0.4);
  fireEvent.lostPointerCapture(fader, { pointerId: 1 });
  expect(onEnd).toHaveBeenLastCalledWith(true);
  fireEvent.pointerUp(window, { pointerId: 1 });
  expect(onEnd).toHaveBeenCalledTimes(1);
  fireEvent.pointerDown(fader, { pointerId: 3, button: 0, clientX: 10 });
  fireEvent.pointerCancel(window, { pointerId: 3 });
  expect(onEnd).toHaveBeenLastCalledWith(true);
  fireEvent.pointerDown(fader, { pointerId: 4, button: 0, clientX: 10 });
  fireEvent.pointerUp(window, { pointerId: 4 });
  expect(onEnd).toHaveBeenLastCalledWith(false);
  fireEvent.pointerDown(fader, { pointerId: 5, button: 0, clientX: 10 });
  unmount();
  expect(onEnd).toHaveBeenCalledTimes(4);
  expect(onEnd).toHaveBeenLastCalledWith(true);
  fireEvent.pointerMove(window, { pointerId: 5, clientX: 80 });
  expect(onMove).toHaveBeenCalledTimes(1);
});

it('cancels a preview when its owner becomes unavailable', () => {
  const props = {
    value: 0.2,
    dragging: false,
    disabled: false,
    onBegin: vi.fn(),
    onMove: vi.fn(),
    onEnd: vi.fn(),
  };
  const { container, rerender } = render(<InlineFader {...props} />);
  const fader = container.querySelector<HTMLElement>(
    '[data-slot=inline-fader]',
  )!;
  fader.getBoundingClientRect = () => ({ left: 0, width: 100 }) as DOMRect;
  fireEvent.pointerDown(fader, { pointerId: 1, button: 0, clientX: 30 });
  rerender(<InlineFader {...props} disabled />);
  expect(props.onEnd).toHaveBeenCalledExactlyOnceWith(true);
  fireEvent.pointerUp(window, { pointerId: 1 });
  expect(props.onEnd).toHaveBeenCalledTimes(1);
});
