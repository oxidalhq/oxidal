import type { SheetLinks } from '../../api';
import type { LibraryReference } from '../../generated/contract';

export const SHEETS_CHANGED = 'oxidal:sheets-changed';

/** Saved preset links take precedence; missing targets remain explicit. */
export function resolveSheet(
  links: SheetLinks['links'],
  preset: LibraryReference | null | undefined,
  track: string | null | undefined,
) {
  return (
    (preset &&
      links.find(
        (link) =>
          link.target.kind === 'preset' &&
          link.target.preset.kind === preset.kind &&
          link.target.preset.id === preset.id,
      )) ||
    (track &&
      links.find(
        (link) => link.target.kind === 'track' && link.target.asset === track,
      )) ||
    undefined
  );
}
