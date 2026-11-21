import {
  glyphFor,
  type GlyphKey,
} from '@oxidal/design-system/lib/block-glyphs';
import { BlockGlyph } from '@oxidal/design-system/widgets/block-glyph';

import { gearLabel } from './lib/gearLabel';

export function GearLabel({ gear }: { gear: string }) {
  return gearLabel(gear);
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
