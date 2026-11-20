import { useEffect, useState } from 'react';

import { SourceCard } from '@oxidal/design-system/widgets/block-source';

import { type EffectPacks, effectPacks, type Lv2Plugin } from './api';
import { lv2Source } from './lv2Source';

/** Reading source details never changes the selected plugin or its sound. */
export function PluginSourceDetails({ plugin }: { plugin: Lv2Plugin }) {
  const [packs, setPacks] = useState<EffectPacks['packs']>([]);
  useEffect(() => {
    if (!plugin.pack_id) return;
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
  }, [plugin.pack_id]);
  const source = lv2Source(plugin, packs);
  return source ? <SourceCard source={source} /> : null;
}
