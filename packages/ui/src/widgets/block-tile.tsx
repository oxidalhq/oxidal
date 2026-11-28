import { Led } from '../components/ui/badge';
import { type GlyphKey, type LedKind, ledKindFor } from '../lib/block-glyphs';
import { cn } from '../lib/cn';
import { BlockGlyph } from './block-glyph';

const TINTS: Record<LedKind, string> = {
  amp: 'bg-led-amp/10 text-led-amp',
  cab: 'bg-led-cab/10 text-led-cab',
  pedal: 'bg-led-pedal/10 text-led-pedal',
  time: 'bg-led-time/10 text-led-time',
  mod: 'bg-led-mod/10 text-led-mod',
  lv2: 'bg-led-lv2/10 text-led-lv2',
};

/**
 * A block as the Rig draws it: its glyph on a small tile with the family
 * light in the corner. `tinted` washes the tile and the glyph in the family
 * colour, for catalogues where the tile is the only picture (Settings ›
 * Effects, LV2 packs); on the chain the tile stays plain beside its name.
 */
export function BlockTile({
  glyph,
  on = true,
  tinted = false,
  size = 'md',
  className,
}: {
  glyph: GlyphKey;
  on?: boolean;
  tinted?: boolean;
  size?: 'md' | 'lg';
  className?: string;
}) {
  const kind = ledKindFor(glyph);
  return (
    <span
      aria-hidden="true"
      data-slot="block-tile"
      data-kind={kind}
      className={cn(
        'relative grid shrink-0 place-items-center rounded-lg border',
        size === 'lg' ? 'size-12 [&_svg]:size-6' : 'size-9 [&_svg]:size-5',
        tinted && on
          ? cn('border-current/25', TINTS[kind])
          : 'border-border bg-background',
        !on && 'border-dashed [&_svg]:opacity-60',
        className,
      )}
    >
      <BlockGlyph glyph={glyph} />
      <Led kind={kind} on={on} className="absolute -top-1 -right-1 size-2.5" />
    </span>
  );
}
