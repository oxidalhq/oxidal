import type { RigControl } from '../../api';
import { controlDisplay, controlLabel } from '../../lv2Control';
import type { RigViewProps } from './useMixedRigSession';

/** One thing that differs from the saved preset, with how to put it back. */
export type RigChange = {
  key: string;
  /** "Bloom · Decay 1.5 s → 2 s", "Echo · bypassed" or "Path 2 level → 80%". */
  text: string;
  target: RigControl['target'];
  /** The saved value to put back. */
  saved: number;
  current: number;
};

const unitOf = (display: string) =>
  /^[-+]?[\d.,]+\s*(.*)$/.exec(display.trim())?.[1] ?? '';
const number = (value: number) =>
  Number.isInteger(value) ? String(value) : value.toFixed(2);

/**
 * What differs between the sound playing now and the saved preset. The device
 * reports, for every control, the value the saved preset (or the playing
 * scene) holds while the live value differs, so effect settings, bypass,
 * path levels and capture settings are all listed the same way.
 * @see docs/interface.md
 */
export function useRigChanges({ rig, vm }: RigViewProps): RigChange[] {
  const controls = vm.state.control?.controls ?? [];
  const nodes = rig.matching?.manifest.oxidal?.graph.nodes ?? [];
  const nameOf = (id: string) => {
    const node = nodes.find((n) => n.id === id);
    return node ? vm.describeNode(node).label : id;
  };
  const changes: RigChange[] = [];
  for (const c of controls) {
    if (c.saved == null) continue;
    const t = c.target;
    let text: string;
    if (t.kind === 'bypass') {
      text = `${nameOf(t.node)} · ${c.value === 1 ? 'bypassed' : 'turned on'}`;
    } else if (t.kind === 'lv2') {
      const unit = unitOf(c.display);
      text = `${nameOf(t.node)} · ${controlLabel(c.label)} ${number(c.saved)}${unit ? ` ${unit}` : ''} → ${controlDisplay(c)}`;
    } else if (t.kind === 'merge') {
      text = `Path ${t.port + 1} level ${Math.round(c.saved * 100)}% → ${Math.round(c.value * 100)}%`;
    } else if (t.kind === 'native') {
      const owner = nameOf(t.node);
      const label = controlLabel(c.label);
      text = `${label.startsWith(owner) ? '' : `${owner} · `}${label} → ${controlDisplay(c)}`;
    } else continue;
    changes.push({
      key: JSON.stringify(t),
      text,
      target: t,
      saved: c.saved,
      current: c.value,
    });
  }
  return changes;
}
