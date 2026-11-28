/**
 * The captures a TONE3000 preset file holds, read from the file itself: each
 * block's model name, gear and picture, as Storybook's preset details draws
 * them ("Captures and IRs"). Oxidal ships no third-party pictures, so after a
 * fresh install a picture may not be on this unit yet: Download fetches the
 * missing ones, one at a time, keeping any already saved. The models travel
 * inside the preset file.
 * @see docs/interface.md
 */
import { PresetSources } from '@oxidal/design-system/patterns/preset-dialogs';

import { artworkPath } from '../../api';
import { GearIcon } from '../../GearIcon';
import { gearLabel } from '../../lib/gearLabel';
import { type PresetFileFacts, type usePresetArtwork } from './presetFile';

const kb = (bytes: number) =>
  bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;

export function PresetFileSources({
  id,
  owned,
  facts,
  artwork,
}: {
  id: string;
  owned: boolean;
  facts?: PresetFileFacts;
  artwork: ReturnType<typeof usePresetArtwork>;
}) {
  const { items, busy, error, download } = artwork;
  if (!items) return null;
  // Positions with no capture of their own carry no name or picture.
  const captures = items.filter((item) => item.key);
  const missing = captures.filter((item) => !item.cached).length;
  return (
    <PresetSources
      sources={captures.map((item) => ({
        name: item.title,
        caption: `${gearLabel(item.gear)} · ${item.cached ? 'picture saved' : 'picture not on this unit'}`,
        tone3000: true,
        // Who made it, from the file's own TONE3000 record: the creator and
        // the tone link to their pages, and the picture opens full size.
        source: {
          kind: 'tone3000' as const,
          title: item.title,
          creator: {
            name: item.creator ?? 'Unknown creator',
            profile: item.creator_url ?? undefined,
          },
          page:
            item.page ??
            (item.tone_id != null
              ? `https://www.tone3000.com/tones/${item.tone_id}`
              : ''),
          image: item.cached ? artworkPath(id, owned, item.key!) : undefined,
          gear: gearLabel(item.gear),
          licence:
            item.licence === 't3k'
              ? 'TONE3000 license'
              : (item.licence ?? 'Licence not given'),
        },
        picture: item.cached ? (
          <img
            src={artworkPath(id, owned, item.key!)}
            alt=""
            loading="lazy"
            decoding="async"
          />
        ) : (
          <GearIcon gear={item.gear} name={item.title} />
        ),
      }))}
      note={
        facts?.modelBytes
          ? `The models are inside this preset file (${kb(facts.modelBytes)}).`
          : undefined
      }
      download={
        missing || error
          ? {
              missing: missing
                ? `${missing} ${missing === 1 ? 'picture is' : 'pictures are'} not on this unit yet.`
                : 'Every picture is on this unit.',
              label:
                missing === 1 ? 'Download the picture' : 'Download pictures',
              busy,
              error,
              onDownload: () => void download(),
            }
          : undefined
      }
    />
  );
}
