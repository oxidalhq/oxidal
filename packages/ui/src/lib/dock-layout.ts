import { useState } from 'react';

import { useRemembered } from './use-remembered';

/**
 * Where docked tools sit: three zones (left, right and bottom), each with
 * one or more tools shown as tabs or split, plus tools floating on their
 * own. Plain data, so a screen can keep its layout in the browser. Tools
 * are named by id; what they show is the screen's.
 * @see docs/interface.md
 */

export type ZoneId = 'left' | 'right' | 'bottom';
export type DockTarget = ZoneId | 'float' | 'closed';

export type Zone = {
  tools: string[];
  active: string | null;
  /** Show every tool at once: stacked in a side zone, side by side at the bottom. */
  split: boolean;
  /** Folded to a few faint icons. */
  collapsed: boolean;
  /** Width of a side zone or height of the bottom zone, in CSS pixels. */
  size: number;
  /** Floats over the chain as glass instead of pushing it aside. */
  glass: boolean;
};

export type FloatingTool = { id: string; x: number; y: number };

export type DockLayout = {
  zones: Record<ZoneId, Zone>;
  floating: FloatingTool[];
};

export const ZONES: readonly ZoneId[] = ['left', 'right', 'bottom'];

export const ZONE_SIZE: Record<
  ZoneId,
  { min: number; max: number; initial: number }
> = {
  left: { min: 280, max: 520, initial: 340 },
  right: { min: 280, max: 520, initial: 340 },
  bottom: { min: 150, max: 420, initial: 200 },
};

const zone = (id: ZoneId, tools: string[] = [], more?: Partial<Zone>) => ({
  tools,
  active: tools[0] ?? null,
  split: false,
  collapsed: false,
  size: ZONE_SIZE[id].initial,
  glass: false,
  ...more,
});

/** A layout from the tools in each zone, with any changes to a zone and floating tools. */
export function layoutOf(
  parts: Partial<Record<ZoneId, string[]>> = {},
  more: Partial<Record<ZoneId, Partial<Zone>>> = {},
  floating: FloatingTool[] = [],
): DockLayout {
  return {
    zones: {
      left: zone('left', parts.left, more.left),
      right: zone('right', parts.right, more.right),
      bottom: zone('bottom', parts.bottom, more.bottom),
    },
    floating,
  };
}

/** Where a tool is now. */
export function placeOf(layout: DockLayout, id: string): DockTarget {
  for (const z of ZONES) if (layout.zones[z].tools.includes(id)) return z;
  if (layout.floating.some((f) => f.id === id)) return 'float';
  return 'closed';
}

/** Move a tool to a zone, float it, or close it; it shows at once where it lands. */
export function moveTool(
  layout: DockLayout,
  id: string,
  to: DockTarget,
  at?: { x: number; y: number },
): DockLayout {
  const zones = { ...layout.zones };
  for (const z of ZONES) {
    const now = zones[z];
    if (!now.tools.includes(id)) continue;
    const tools = now.tools.filter((t) => t !== id);
    zones[z] = {
      ...now,
      tools,
      active: now.active === id ? (tools[0] ?? null) : now.active,
    };
  }
  let floating = layout.floating.filter((f) => f.id !== id);
  if (to === 'float')
    floating = [...floating, { id, x: at?.x ?? 120, y: at?.y ?? 120 }];
  else if (to !== 'closed') {
    const into = zones[to];
    zones[to] = {
      ...into,
      tools: [...into.tools, id],
      active: id,
      collapsed: false,
    };
  }
  return { zones, floating };
}

export function setZone(
  layout: DockLayout,
  id: ZoneId,
  change: Partial<Zone>,
): DockLayout {
  return {
    ...layout,
    zones: { ...layout.zones, [id]: { ...layout.zones[id], ...change } },
  };
}

/**
 * The layout a screen can show. With room for one side zone only (a tablet,
 * or a window under 1200 pixels), the left zone's tools join the right zone
 * as tabs, floating over the chain so the chain keeps its width; the saved
 * layout keeps them on the left for a wider screen.
 */
export function fitLayout(layout: DockLayout, bothSides: boolean): DockLayout {
  if (bothSides) return layout;
  const { left, right } = layout.zones;
  const merged = left.tools.length
    ? {
        ...layout,
        zones: {
          ...layout.zones,
          left: { ...left, tools: [], active: null },
          right: {
            ...right,
            tools: [...right.tools, ...left.tools],
            active: right.active ?? left.active,
            split: false,
            collapsed: right.tools.length ? right.collapsed : left.collapsed,
          },
        },
      }
    : layout;
  return setZone(merged, 'right', { glass: true });
}

/** Every docked or floating tool, in the order given, for a phone's one sheet. */
export function openTools(layout: DockLayout, order: string[]): string[] {
  return order.filter((t) => placeOf(layout, t) !== 'closed');
}

/** Open a tool, as the capsule's menu does: where it was, unfolded, or at the right. */
export function showTool(layout: DockLayout, id: string): DockLayout {
  const place = placeOf(layout, id);
  if (place === 'closed') return moveTool(layout, id, 'right');
  if (place === 'float') return layout;
  return setZone(layout, place, { collapsed: false, active: id });
}

/** How much width the pinned side zones take from the middle of the screen. */
export function sideRoom(layout: DockLayout, bothSides: boolean): number {
  const shown = fitLayout(layout, bothSides);
  let room = 0;
  for (const z of ['left', 'right'] as const) {
    const zone = shown.zones[z];
    // A folded zone's icons float at the edge and take no room.
    if (zone.tools.length && !zone.collapsed && !zone.glass) room += zone.size;
  }
  return room;
}

/**
 * A screen's dock layout. With a storage key ("oxidal.dock.rig"), this
 * browser keeps it; without one, it lasts while the screen is open.
 */
export function useDockLayout(storageKey: string | null, initial: DockLayout) {
  const [kept, setKept] = useRemembered(
    storageKey ?? 'oxidal.dock.unsaved',
    initial,
  );
  const [own, setOwn] = useState(initial);
  return storageKey
    ? ([kept, setKept] as const)
    : ([own, (next: DockLayout) => setOwn(next)] as const);
}
