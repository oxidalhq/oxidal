import { useEffect, useState } from 'react';

import {
  type BlockSource,
  SourceCard,
} from '@oxidal/design-system/widgets/block-source';

import { type EffectPacks, effectPacks, type Lv2Plugin } from './api';
import { lv2Source } from './lv2Source';

/**
 * Where an LV2 plugin comes from: its maker and website, the pack it ships
 * in (such as Guitarix) with that project's site, and the installed package
 * and version. Oxidal's own effects name their crate. Reading it never
 * changes the plugin or its sound.
 */
export function usePluginSource(
  plugin: Lv2Plugin | null | undefined,
): BlockSource | undefined {
  const [packs, setPacks] = useState<EffectPacks['packs']>([]);
  const packId = plugin?.pack_id;
  useEffect(() => {
    if (!packId) return;
    let active = true;
    void effectPacks().then(
      (found) => {
        if (active) setPacks(found.packs);
      },
      () => {
        if (active) setPacks([]);
      },
    );
    return () => {
      active = false;
    };
  }, [packId]);
  return plugin ? lv2Source(plugin, packs) : undefined;
}

export function PluginSourceDetails({ plugin }: { plugin: Lv2Plugin }) {
  const source = usePluginSource(plugin);
  return source ? <SourceCard source={source} /> : null;
}
