import type { Lv2Plugin, Preset, RigDocument } from './api';
import type { RigPublish } from './generated/contract';
import { chainLanes } from './rigChain';
import {
  parallelRig,
  serialRig,
  type DraftEffect,
  type MonoInput,
} from './rigDraft';

/**
 * Editing a preset with effects: read it back into lanes of blocks, change
 * them, and build the next version with the same builders that made it. Block
 * ids stay the same, so boosts, calibration and selections still apply.
 * @see docs/interface.md
 */
export type Lanes = DraftEffect[][];

/** The preset as lanes of blocks; effect knobs take their live values. */
export function readLanes(
  document: RigDocument,
  plugins: Lv2Plugin[],
  live: Record<string, Record<string, number>>,
): Lanes {
  const manifest = document.manifest;
  const host = manifest.oxidal;
  const lanes = host && chainLanes(host.graph);
  if (!host || !lanes)
    throw new Error('This preset’s routing cannot be edited here.');
  const labels = (manifest.extensions['urn:oxidal:authoring']?.labels ??
    {}) as Record<string, string>;
  const node = (id: string) => host.graph.nodes.find((n) => n.id === id)!;
  return lanes.map((ids) =>
    ids.map((id): DraftEffect => {
      const n = node(id);
      if (n.kind === 'tone3000') {
        const instance = manifest.tone3000.instances.find(
          (i) => i.id === n.instance,
        );
        const resource = manifest.resources.find(
          (r) => r.id === instance?.preset,
        );
        if (!instance || !resource)
          throw new Error('A TONE3000 block is missing.');
        const role = instance.processingRole;
        return {
          id,
          kind: 'native',
          name: labels[id] ?? 'TONE3000',
          preset: {
            sha256: resource.sha256,
            size_bytes: resource.bytes,
            name: labels[id] ?? 'TONE3000',
          } as Preset,
          // The next version copies the bytes from this one.
          source: {
            kind: 'bundle',
            revision: document.revision,
            resource: resource.id,
          },
          ...(instance.partition && (role === 'amp' || role === 'cab')
            ? { stage: { role, recipe: instance.partition } }
            : {}),
        };
      }
      const effect = host.lv2.find((l) => l.id === n.instance);
      const plugin = plugins.find((p) => p.uri === effect?.pluginUri);
      if (!effect || !plugin)
        throw new Error(`${labels[id] ?? 'An effect'} is not installed.`);
      const gains = node(`${id}-mono`)?.inputGains ?? [];
      const mono: MonoInput =
        gains[0] === 1 && gains[1] === 0
          ? 'left'
          : gains[0] === 0 && gains[1] === 1
            ? 'right'
            : 'sum';
      return {
        id,
        kind: 'lv2',
        name: labels[id] ?? plugin.name,
        plugin,
        mono,
        controls: { ...effect.controls, ...live[id] },
      };
    }),
  );
}

/** The next version: one lane is a straight chain, two are a split. */
export function buildLanes(
  id: string,
  name: string,
  lanes: Lanes,
  profile: string,
): RigPublish {
  const kept = lanes.filter((lane) => lane.length);
  if (!kept.length) throw new Error('A preset needs at least one block.');
  if (kept.length === 1) return serialRig(id, name, kept[0]!, profile, false);
  const { before, sides, after } = splitSections(kept[0]!, kept[1]!);
  return parallelRig(id, name, before, sides, profile, false, after);
}

/**
 * `readLanes` repeats the blocks shared before a split and after its merge in
 * both lanes. Rebuild them once, as shared sections, so no block is written
 * twice. A block on both sides elsewhere cannot be routed and is refused.
 */
function splitSections(left: DraftEffect[], right: DraftEffect[]) {
  let head = 0;
  while (
    head < left.length &&
    head < right.length &&
    left[head]!.id === right[head]!.id
  )
    head++;
  let tail = 0;
  while (
    tail < left.length - head &&
    tail < right.length - head &&
    left[left.length - 1 - tail]!.id === right[right.length - 1 - tail]!.id
  )
    tail++;
  const sides: [DraftEffect[], DraftEffect[]] = [
    left.slice(head, left.length - tail),
    right.slice(head, right.length - tail),
  ];
  const seen = new Set(sides[0].map((b) => b.id));
  if (sides[1].some((b) => seen.has(b.id)))
    throw new Error(
      'A block cannot be on both sides of a split. Remove one copy first.',
    );
  return {
    before: left.slice(0, head),
    sides,
    after: left.slice(left.length - tail),
  };
}

/** Inserts `effect` into `lane` at `index` (clamped to the lane). */
export function insertBlock(
  lanes: Lanes,
  lane: number,
  index: number,
  effect: DraftEffect,
): Lanes {
  return lanes.map((blocks, i) => {
    if (i !== lane) return blocks;
    const at = Math.max(0, Math.min(blocks.length, index));
    return [...blocks.slice(0, at), effect, ...blocks.slice(at)];
  });
}

/** Removes a block. A split whose side empties becomes a straight chain. */
export function removeBlock(lanes: Lanes, id: string): Lanes {
  const next = lanes.map((blocks) => blocks.filter((b) => b.id !== id));
  return next.some((blocks) => blocks.length)
    ? next.filter((blocks) => blocks.length)
    : next;
}

/**
 * Moves a block to `index` in `lane` (its own lane by default), counted
 * without the block. A split side left empty becomes a straight chain.
 */
export function moveBlock(
  lanes: Lanes,
  id: string,
  index: number,
  lane?: number,
): Lanes {
  const from = lanes.findIndex((blocks) => blocks.some((b) => b.id === id));
  if (from < 0) return lanes;
  const moving = lanes[from]!.find((b) => b.id === id)!;
  const to = lane ?? from;
  const taken = lanes.map((blocks) => blocks.filter((b) => b.id !== id));
  const placed = insertBlock(taken, to, index, moving);
  return placed.some((blocks) => !blocks.length) && placed.length > 1
    ? placed.filter((blocks) => blocks.length)
    : placed;
}
