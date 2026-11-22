import { useEffect, useState } from 'react';

import { safeLink } from '@oxidal/design-system/lib/links';
import type { BlockSource } from '@oxidal/design-system/widgets/block-source';

import { tone3000Tone, toneImage, type TonePage } from './api';
import { gearLabel } from './lib/gearLabel';
import { toneLink } from './toneLink';

type Tone = TonePage['data'][number];

// Details change rarely and the same block is selected again and again.
const known = new Map<number, Tone>();

const licenses: Record<string, string> = { t3k: 'TONE3000 license' };

export function useToneSource(toneId: number | null, initialTone?: Tone) {
  const [result, setResult] = useState<{
    id: number;
    tone?: Tone;
    error?: boolean;
  } | null>(null);
  useEffect(() => {
    if (toneId == null || initialTone || known.has(toneId)) return;
    const controller = new AbortController();
    void tone3000Tone(toneId, controller.signal)
      .then((tone) => {
        known.set(toneId, tone);
        if (!controller.signal.aborted) setResult({ id: toneId, tone });
      })
      .catch(() => {
        if (!controller.signal.aborted) setResult({ id: toneId, error: true });
      });
    return () => controller.abort();
  }, [toneId, initialTone]);
  const matching = result?.id === toneId ? result : null;
  const tone =
    toneId == null
      ? undefined
      : (initialTone ?? known.get(toneId) ?? matching?.tone);
  if (!tone) return { source: undefined, error: !!matching?.error };
  const models =
    (tone.a1_models_count ?? 0) +
    (tone.a2_models_count ?? 0) +
    (tone.custom_models_count ?? 0);
  const count = models || tone.models_count;
  const source: BlockSource = {
    kind: 'tone3000',
    title: tone.title,
    creator: {
      name: tone.user.display_name || tone.user.username,
      username: tone.user.display_name ? tone.user.username : undefined,
      profile: tone.user.profile_url ?? undefined,
    },
    page: !tone.url || safeLink(tone.url) ? toneLink(tone) : '',
    image: toneImage(tone.id),
    gear: gearLabel(tone.gear),
    format: tone.format.toUpperCase(),
    models: count,
    counts: models
      ? {
          standard: tone.a1_models_count,
          a2: tone.a2_models_count,
          custom: tone.custom_models_count,
        }
      : undefined,
    licence: licenses[tone.license] ?? tone.license,
  };
  return { source, error: false };
}
