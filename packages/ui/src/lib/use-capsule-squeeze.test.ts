import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type CapsuleSqueezeInput,
  SQUEEZE_RULES,
  useCapsuleSqueeze,
} from './use-capsule-squeeze';

const PLAYING = -20;
const SILENT = -72;

function setup(input: Partial<CapsuleSqueezeInput> = {}) {
  return renderHook((props: CapsuleSqueezeInput) => useCapsuleSqueeze(props), {
    initialProps: { running: true, inputLevel: PLAYING, ...input },
  });
}

const wait = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });

const fire = (type: string, init: MouseEventInit | KeyboardEventInit = {}) =>
  act(() => {
    window.dispatchEvent(
      type === 'keydown'
        ? new KeyboardEvent(type, init)
        : new MouseEvent(type, init as MouseEventInit),
    );
  });

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('useCapsuleSqueeze', () => {
  it('squeezes once a guitar has played for the quiet time', () => {
    const { result } = setup();
    expect(result.current.squeezed).toBe(false);
    wait(3200);
    expect(result.current.squeezed).toBe(true);
  });

  it('stays open while audio runs but no guitar is coming in', () => {
    const { result } = setup({ inputLevel: SILENT });
    wait(20000);
    expect(result.current.squeezed).toBe(false);
  });

  it('needs the guitar for two seconds, not a single loud moment', () => {
    const { result, rerender } = setup({ inputLevel: SILENT });
    wait(2900);
    rerender({ running: true, inputLevel: PLAYING });
    wait(SQUEEZE_RULES.signalFor - 300);
    expect(result.current.squeezed).toBe(false);
    wait(600);
    expect(result.current.squeezed).toBe(true);
  });

  it('never squeezes with audio stopped, kept open, or on E-paper', () => {
    for (const input of [
      { running: false },
      { keepOpen: true },
      { epaper: true },
    ]) {
      const { result, unmount } = setup(input);
      wait(10000);
      expect(result.current.squeezed).toBe(false);
      expect(result.current.active).toBe(false);
      unmount();
    }
  });

  it('waits while its own menu is open, then squeezes after it closes', () => {
    const { result, rerender } = setup({ busy: true });
    wait(10000);
    expect(result.current.squeezed).toBe(false);
    rerender({ running: true, inputLevel: PLAYING, busy: false });
    wait(300);
    expect(result.current.squeezed).toBe(true);
  });

  it('waits while a dialog or menu is open on the page', () => {
    const layer = document.createElement('div');
    layer.setAttribute('role', 'dialog');
    document.body.append(layer);
    const { result } = setup();
    wait(10000);
    expect(result.current.squeezed).toBe(false);
    layer.remove();
    wait(300);
    expect(result.current.squeezed).toBe(true);
  });

  it('waits while a text field has focus', () => {
    const field = document.createElement('input');
    document.body.append(field);
    field.focus();
    const { result } = setup();
    wait(10000);
    expect(result.current.squeezed).toBe(false);
  });

  it('waits five seconds after a click on the page', () => {
    const { result } = setup();
    wait(2500);
    fire('pointerdown');
    wait(4000);
    expect(result.current.squeezed).toBe(false);
    wait(SQUEEZE_RULES.afterClick);
    expect(result.current.squeezed).toBe(true);
  });

  it('wakes when the pointer rests near the top, not when it passes', () => {
    const { result } = setup();
    wait(3200);
    expect(result.current.squeezed).toBe(true);
    // Through the band and out again before the dwell: still a bubble.
    fire('pointermove', { clientX: 900, clientY: 40 });
    wait(50);
    fire('pointermove', { clientX: 900, clientY: 400 });
    wait(400);
    expect(result.current.squeezed).toBe(true);
    // Resting in the band wakes it.
    fire('pointermove', { clientX: 900, clientY: 40 });
    wait(SQUEEZE_RULES.dwell + 10);
    expect(result.current.squeezed).toBe(false);
  });

  it('ignores a drag across the top', () => {
    const { result } = setup();
    wait(3200);
    fire('pointermove', { clientX: 900, clientY: 20, buttons: 1 });
    wait(400);
    expect(result.current.squeezed).toBe(true);
  });

  it('wakes early when the pointer heads quickly up towards it', () => {
    const { result } = setup();
    wait(3200);
    const centre = window.innerWidth / 2;
    fire('pointermove', { clientX: centre, clientY: 190 });
    wait(10);
    fire('pointermove', { clientX: centre, clientY: 150 });
    expect(result.current.squeezed).toBe(false);
  });

  it('wakes on a key', () => {
    const { result } = setup();
    wait(3200);
    fire('keydown', { key: 'a' });
    expect(result.current.squeezed).toBe(false);
  });

  it('doubles the quiet time when reached for again soon after, up to 30 s', () => {
    const { result } = setup();
    wait(3200);
    act(() => result.current.wake());
    expect(result.current.idleMs).toBe(6000);
    // The next squeeze needs the longer quiet time.
    wait(5000);
    expect(result.current.squeezed).toBe(false);
    wait(1200);
    expect(result.current.squeezed).toBe(true);
    // Each time it squeezes, reach for it straight away.
    for (let i = 0; i < 4; i += 1) {
      act(() => result.current.wake());
      for (let t = 0; t < 40 && !result.current.squeezed; t += 1) wait(1000);
    }
    expect(result.current.idleMs).toBe(SQUEEZE_RULES.maxIdle);
  });

  it('does not double after a long time in the bubble', () => {
    const { result } = setup();
    wait(3200);
    wait(SQUEEZE_RULES.reachAgain + 100);
    act(() => result.current.wake());
    expect(result.current.idleMs).toBe(3000);
  });

  it('springs back out, but not with reduced motion', () => {
    const { result, unmount } = setup();
    wait(3200);
    act(() => result.current.wake());
    expect(result.current.popping).toBe(true);
    unmount();

    vi.spyOn(window, 'matchMedia').mockImplementation(
      (query: string) =>
        ({
          matches: query.includes('reduce'),
          media: query,
          addEventListener: () => {},
          removeEventListener: () => {},
        }) as unknown as MediaQueryList,
    );
    const reduced = setup();
    wait(3200);
    expect(reduced.result.current.squeezed).toBe(true);
    act(() => reduced.result.current.wake());
    expect(reduced.result.current.squeezed).toBe(false);
    expect(reduced.result.current.popping).toBe(false);
  });
});
