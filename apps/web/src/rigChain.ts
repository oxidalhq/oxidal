import type { ReactNode } from 'react';
import { glyphFor, glyphs } from './blockGlyphs';

/**
 * Engine-neutral chain view model shared by native, hybrid and LV2 rigs.
 * @see docs/interface.md
 */
/** LED category shared with footswitch LEDs; never used as a fill. */
export type BlockKind =
  'amp' | 'pedal' | 'cab' | 'time' | 'mod' | 'lv2' | 'other';

export interface RigBlockVM {
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
  /** Shown but not sounding, such as another scene's branch. */
  dim?: boolean;
}

/** LED family follows the block's glyph, so an LV2 delay lights like a delay. */
export function blockKind(gear: string, name = '', format?: string): BlockKind {
  if (format === 'ir') return 'cab';
  return glyphs[glyphFor(gear, name)].kind;
}
