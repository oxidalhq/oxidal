import { useEffect, useState } from 'react';

import type { LibraryItem } from '@oxidal/design-system/patterns/library-list';

import { installedLv2, type Lv2Plugin } from '../../api';
import type { RigBlock } from '../../generated/contract';
import { blockKind } from '../../rigChain';

/** Names do not depend on the sample rate; one catalog read serves every list. */
let catalog: Promise<Lv2Plugin[]> | null = null;
const readCatalog = () =>
  (catalog ??= Promise.resolve()
    .then(() => installedLv2(48000))
    .catch((cause) => {
      catalog = null;
      throw cause;
    }));

/**
 * Installed effects by plugin URI, read once, so a Library row can name and
 * colour each block of a saved preset. Without the catalog a block is named
 * from the end of its URI.
 * @see docs/interface.md
 */
export function useLv2Names(needed: boolean): Map<string, Lv2Plugin> {
  const [plugins, setPlugins] = useState<Map<string, Lv2Plugin>>(new Map());
  useEffect(() => {
    // Read only when a listed preset has an effect to name.
    if (!needed) return;
    let live = true;
    readCatalog().then(
      (list) => {
        if (live) setPlugins(new Map(list.map((p) => [p.uri, p])));
      },
      () => {},
    );
    return () => {
      live = false;
    };
  }, [needed]);
  return plugins;
}

const fromUri = (uri: string) =>
  decodeURIComponent(uri.split(/[/#:]/).filter(Boolean).at(-1) ?? uri);

/** A saved preset's blocks as the Library row's small chain strip draws them. */
export function presetChain(
  blocks: RigBlock[] | undefined,
  plugins: Map<string, Lv2Plugin>,
): LibraryItem['chain'] {
  if (!blocks?.length) return undefined;
  return blocks.map((b) => {
    if (b.kind === 'tone3000') return { kind: 'amp', label: 'Capture' };
    const plugin = b.plugin_uri ? plugins.get(b.plugin_uri) : undefined;
    const name =
      plugin?.name ?? (b.plugin_uri ? fromUri(b.plugin_uri) : 'Effect');
    const kind = blockKind('', name);
    // A block with no family of its own lights as an effect.
    return { kind: kind === 'other' ? 'lv2' : kind, label: name };
  });
}
