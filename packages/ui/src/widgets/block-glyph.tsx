import { type GlyphKey, glyphs } from '../lib/block-glyphs';
import { cn } from '../lib/cn';

/**
 * One of Oxidal's block glyphs: objects for captured gear, signal shapes
 * for processing. Drawn on a 24 px grid with a 1.5 px square-capped stroke
 * in the current ink, no fills; colour lives on the LED beside it.
 */
export function BlockGlyph({
  glyph,
  label,
  className,
}: {
  glyph: GlyphKey;
  /** Give it a name only when it stands alone; beside a label it is decoration. */
  label?: string;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="square"
      strokeLinejoin="miter"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      data-glyph={glyph}
      className={cn('size-5 shrink-0', className)}
      // The markup is this package's own fixed glyph set, never user data.
      dangerouslySetInnerHTML={{ __html: glyphs[glyph].svg }}
    />
  );
}
