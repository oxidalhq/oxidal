import { blocksOf, isSplit, type Step } from './route';

type Control = {
  id: string;
  label: string;
  value: number;
  unit?: string;
  step?: number;
};
type Diffable = {
  id: string;
  label: string;
  on: boolean;
  controls: Control[];
  kind?: string;
  role?: string;
  source?: { value: string };
};

export type Change =
  | {
      kind: 'value';
      block: string;
      blockLabel: string;
      control: string;
      label: string;
      from: number;
      to: number;
      unit?: string;
      step?: number;
    }
  | {
      kind: 'bypass';
      block: string;
      blockLabel: string;
      from: boolean;
      to: boolean;
    }
  | { kind: 'added'; block: string; blockLabel: string }
  | { kind: 'removed'; block: string; blockLabel: string }
  | {
      kind: 'model';
      block: string;
      blockLabel: string;
      from: string;
      to: string;
    }
  | { kind: 'branches'; split: string; from: number[]; to: number[] }
  | { kind: 'settings'; text: string }
  | { kind: 'route'; text: string };

function shape<B extends { id: string }>(route: Step<B>[]): string {
  return route
    .map((s) =>
      isSplit(s) ? `(${s.branches.map((b) => shape(b)).join('|')})` : s.id,
    )
    .join(',');
}

/** What changed from `saved` to `edited`, in signal order: values, bypass, blocks added or removed, and the route's shape. */
export function diffRoutes<B extends Diffable>(
  saved: Step<B>[],
  edited: Step<B>[],
): Change[] {
  const before = new Map(blocksOf(saved).map((b) => [b.id, b]));
  const after = blocksOf(edited);
  const changes: Change[] = [];
  for (const block of after) {
    const old = before.get(block.id);
    if (!old) {
      changes.push({ kind: 'added', block: block.id, blockLabel: block.label });
      continue;
    }
    if (
      old.kind !== block.kind ||
      old.role !== block.role ||
      old.source?.value !== block.source?.value
    )
      changes.push({
        kind: 'model',
        block: block.id,
        blockLabel: block.label,
        from: old.source?.value ?? old.kind ?? old.label,
        to: block.source?.value ?? block.kind ?? block.label,
      });
    if (
      old.controls.length !== block.controls.length ||
      old.controls.some((c) => !block.controls.some((next) => next.id === c.id))
    )
      changes.push({
        kind: 'settings',
        text: `${block.label} · control set changed`,
      });
    if (old.on !== block.on)
      changes.push({
        kind: 'bypass',
        block: block.id,
        blockLabel: block.label,
        from: old.on,
        to: block.on,
      });
    for (const control of block.controls) {
      const was = old.controls.find((c) => c.id === control.id);
      if (was && Math.abs(was.value - control.value) > 1e-9)
        changes.push({
          kind: 'value',
          block: block.id,
          blockLabel: block.label,
          control: control.id,
          label: control.label,
          from: was.value,
          to: control.value,
          unit: control.unit,
          step: control.step,
        });
    }
  }
  const kept = new Set(after.map((b) => b.id));
  for (const [id, block] of before)
    if (!kept.has(id))
      changes.push({ kind: 'removed', block: id, blockLabel: block.label });
  const sameSet =
    after.every((b) => before.has(b.id)) && before.size === after.length;
  if (sameSet && shape(saved) !== shape(edited))
    changes.push({
      kind: 'route',
      text: 'Blocks moved or the signal split differently',
    });
  const joins = (steps: Step<B>[], into = new Map<string, number[]>()) => {
    for (const step of steps)
      if (isSplit(step)) {
        into.set(
          step.id,
          step.branches.map((_, i) => step.levels?.[i] ?? 0),
        );
        for (const branch of step.branches) joins(branch, into);
      }
    return into;
  };
  const oldJoins = joins(saved);
  for (const [id, levels] of joins(edited)) {
    const old = oldJoins.get(id);
    if (old && JSON.stringify(old) !== JSON.stringify(levels))
      changes.push({ kind: 'branches', split: id, from: old, to: levels });
  }
  return changes;
}

export function describeChange(change: Change) {
  const n = (v: number, step?: number, unit?: string) =>
    `${v.toFixed(step && step >= 1 ? 0 : 1)}${unit ? ` ${unit}` : ''}`;
  switch (change.kind) {
    case 'value':
      return `${change.blockLabel} · ${change.label} ${n(change.from, change.step, change.unit)} → ${n(change.to, change.step, change.unit)}`;
    case 'bypass':
      return `${change.blockLabel} · ${change.to ? 'turned on' : 'bypassed'}`;
    case 'added':
      return `${change.blockLabel} · added`;
    case 'removed':
      return `${change.blockLabel} · removed`;
    case 'model':
      return `${change.blockLabel} · model ${change.from} → ${change.to}`;
    case 'branches':
      return `${change.split} · branch mix changed`;
    case 'settings':
    case 'route':
      return change.text;
  }
}
