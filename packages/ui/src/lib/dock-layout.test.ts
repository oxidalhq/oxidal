import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import {
  fitLayout,
  layoutOf,
  moveTool,
  openTools,
  placeOf,
  showTool,
  sideRoom,
  useDockLayout,
} from './dock-layout';

const MULTI = layoutOf(
  { left: ['sheet', 'notes'], right: ['stems'], bottom: ['player'] },
  { left: { split: true } },
);

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('dock layout', () => {
  it('moves a tool between zones and shows it where it lands', () => {
    const next = moveTool(MULTI, 'notes', 'bottom');
    expect(next.zones.left.tools).toEqual(['sheet']);
    expect(next.zones.bottom.tools).toEqual(['player', 'notes']);
    expect(next.zones.bottom.active).toBe('notes');
    expect(placeOf(next, 'notes')).toBe('bottom');
  });

  it('keeps the zone it left showing another tool', () => {
    const next = moveTool(MULTI, 'sheet', 'right');
    expect(next.zones.left.active).toBe('notes');
    expect(moveTool(next, 'notes', 'right').zones.left.active).toBeNull();
  });

  it('unfolds a folded zone a tool is moved into', () => {
    const folded = layoutOf(
      { right: ['stems'] },
      { right: { collapsed: true } },
    );
    expect(moveTool(folded, 'player', 'right').zones.right.collapsed).toBe(
      false,
    );
  });

  it('floats a tool where it was let go, and closes it', () => {
    const floated = moveTool(MULTI, 'notes', 'float', { x: 400, y: 160 });
    expect(floated.floating).toEqual([{ id: 'notes', x: 400, y: 160 }]);
    expect(placeOf(floated, 'notes')).toBe('float');
    const closed = moveTool(floated, 'notes', 'closed');
    expect(placeOf(closed, 'notes')).toBe('closed');
    expect(closed.floating).toEqual([]);
  });

  it('opens a tool from the menu where it was, unfolded, or at the right', () => {
    const folded = layoutOf(
      { left: ['sheet', 'notes'] },
      { left: { collapsed: true } },
    );
    const shown = showTool(folded, 'notes');
    expect(shown.zones.left).toMatchObject({
      collapsed: false,
      active: 'notes',
    });
    expect(showTool(folded, 'player').zones.right.tools).toEqual(['player']);
  });

  it('with room for one side, joins the left tools to the right, floating', () => {
    const fitted = fitLayout(MULTI, false);
    expect(fitted.zones.left.tools).toEqual([]);
    expect(fitted.zones.right.tools).toEqual(['stems', 'sheet', 'notes']);
    expect(fitted.zones.right.glass).toBe(true);
    expect(fitLayout(MULTI, true)).toBe(MULTI);
    // The saved layout keeps the tools on the left for a wider screen.
    expect(MULTI.zones.left.tools).toEqual(['sheet', 'notes']);
  });

  it('counts the width pinned side zones take, not folded or glass ones', () => {
    expect(sideRoom(MULTI, true)).toBe(680);
    expect(
      sideRoom(
        layoutOf(
          { left: ['sheet'], right: ['stems'] },
          { left: { collapsed: true }, right: { glass: true } },
        ),
        true,
      ),
    ).toBe(0);
    expect(sideRoom(MULTI, false)).toBe(0);
  });

  it('lists open tools in the order given, for the phone sheet', () => {
    expect(
      openTools(MULTI, ['player', 'stems', 'sheet', 'notes', 'setlist']),
    ).toEqual(['player', 'stems', 'sheet', 'notes']);
  });

  it('remembers a layout under its storage key', () => {
    const first = renderHook(() => useDockLayout('oxidal.dock.rig', MULTI));
    act(() => first.result.current[1](moveTool(MULTI, 'notes', 'bottom')));
    first.unmount();
    const again = renderHook(() => useDockLayout('oxidal.dock.rig', MULTI));
    expect(again.result.current[0].zones.bottom.tools).toEqual([
      'player',
      'notes',
    ]);
  });

  it('keeps nothing without a storage key', () => {
    const first = renderHook(() => useDockLayout(null, MULTI));
    act(() => first.result.current[1](moveTool(MULTI, 'notes', 'bottom')));
    first.unmount();
    const again = renderHook(() => useDockLayout(null, MULTI));
    expect(again.result.current[0]).toBe(MULTI);
  });
});
