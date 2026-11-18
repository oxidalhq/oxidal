import {
  glyphFor,
  type GlyphKey,
} from '@oxidal/design-system/lib/block-glyphs';
import { BlockGlyph } from '@oxidal/design-system/widgets/block-glyph';

const gearLabels: Record<string, string> = {
  amp: 'Amp head',
  combo: 'Combo amp',
  'amp-cab': 'Amp + cab',
  'full-rig': 'Amp + cab',
  cab: 'Cabinet',
  pedal: 'Pedal',
  outboard: 'Outboard',
  space: 'Space',
  experimental: 'Experimental',
  ir: 'Impulse response',
};
export function GearLabel({ gear }: { gear: string }) {
  return gearLabels[gear] ?? (gear || 'Model');
}
/**
 * Oxidal block glyph. Captures use their provider gear type; LV2 effects fall back
 * to name hints. Unknown types show the generic plugin glyph; never guess an amp.
 * @see docs/interface.md
 */
export function GearIcon({
  gear,
  name,
  glyph,
  className,
}: {
  gear: string;
  name?: string;
  /** A glyph already chosen, e.g. from an LV2 class. */
  glyph?: GlyphKey;
  className?: string;
}) {
  return (
    <BlockGlyph
      glyph={glyph ?? glyphFor(gear, name)}
      className={`block-glyph ${className ?? ''}`}
    />
  );
}
