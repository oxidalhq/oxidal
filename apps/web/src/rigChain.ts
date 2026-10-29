import type { ReactNode } from 'react';

/**
 * Engine-neutral chain view model shared by native, hybrid and LV2 rigs.
 * @see docs/interface.md
 */
/** LED category shared with footswitch LEDs; never used as a fill. */
export type BlockKind = 'amp' | 'pedal' | 'cab' | 'time' | 'lv2' | 'other';

interface RigBlockVM {
  id: string;
  label: string;
  kind: BlockKind;
  on: boolean;
  /** Model artwork or gear glyph drawn inside the tile face. */
  face: ReactNode;
}

export interface RigLaneVM {
  id: string;
  input: string;
  blocks: RigBlockVM[];
}

const gearKinds: Record<string, BlockKind> = {
  amp: 'amp',
  'amp-cab': 'amp',
  'full-rig': 'amp',
  cab: 'cab',
  ir: 'cab',
  pedal: 'pedal',
  outboard: 'time',
  space: 'time',
};

export function blockKind(gear: string, format?: string): BlockKind {
  if (format === 'ir') return 'cab';
  if (format === 'lv2') return 'lv2';
  return gearKinds[gear] ?? 'other';
}
