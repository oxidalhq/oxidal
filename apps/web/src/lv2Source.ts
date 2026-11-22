import type { BlockSource } from '@oxidal/design-system/widgets/block-source';

import type { EffectPacks, Lv2Plugin } from './api';

// These are the ten exact URIs in the five Oxidal bundle manifests.
const own = new Map<string, string>(
  ['bloom', 'echo', 'motion', 'sustain', 'moment'].flatMap((effect) =>
    ['mono', 'stereo'].map(
      (layout) =>
        [`urn:oxidal:plugin:${effect}#${layout}`, `oxidal-${effect}`] as const,
    ),
  ),
);

/** Source details use the bundle owner found by discovery, never a URI prefix. */
export function lv2Source(
  plugin: Lv2Plugin,
  packs: EffectPacks['packs'] = [],
): BlockSource | undefined {
  const crate = own.get(plugin.uri);
  if (crate) {
    return {
      kind: 'oxidal',
      title: plugin.name,
      crate,
      licence: 'Apache-2.0',
      repo: `https://github.com/oxidalhq/oxidal/tree/main/crates/${crate}`,
      references: ['REFERENCES.md in the crate'],
      referencesUrl: `https://github.com/oxidalhq/oxidal/blob/main/crates/${crate}/REFERENCES.md`,
    };
  }
  const pack = packs.find((p) => p.id === plugin.pack_id && p.installed);
  if (!pack) return;
  return {
    kind: 'lv2',
    title: plugin.name,
    author: plugin.author ?? undefined,
    category: plugin.category ?? undefined,
    uri: plugin.uri,
    pack: {
      name: pack.name,
      package: pack.package,
      version: pack.version ?? undefined,
      website: pack.website,
      qualification: pack.qualification,
      ...(pack.copyright_available
        ? {
            copyright: `/api/v1/packs/${encodeURIComponent(pack.id)}/copyright`,
          }
        : {}),
    },
  };
}
