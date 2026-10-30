import { glyphFor, glyphs } from './blockGlyphs';

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
  className,
}: {
  gear: string;
  name?: string;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={`block-glyph ${className ?? ''}`}
      dangerouslySetInnerHTML={{ __html: glyphs[glyphFor(gear, name)].svg }}
    />
  );
}
