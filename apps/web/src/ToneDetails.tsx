import { useEffect, useState } from 'react';

import { SourceCard } from '@oxidal/design-system/widgets/block-source';

import { tone3000Tone, toneImage, type TonePage } from './api';
import { GearLabel } from './GearIcon';
import { friendlyError } from './lib/friendlyError';
import { toneLink } from './toneLink';

type Tone = TonePage['data'][number];

// Details change rarely and the same block is selected again and again.
const known = new Map<number, Tone>();

const licenses: Record<string, string> = { t3k: 'TONE3000 license' };

/**
 * What the selected block is, from TONE3000: its picture, name, author, gear
 * type, model count and licence, with a link to its page. Needs the unit to
 * reach TONE3000; the block keeps working without it.
 * @see docs/tone3000-account.md
 */
export function ToneDetails({
  toneId,
  initialTone,
}: {
  toneId: number;
  initialTone?: Tone;
}) {
  // Another block starts afresh instead of showing the last one's details.
  return <ToneCard key={toneId} toneId={toneId} initialTone={initialTone} />;
}

function ToneCard({
  toneId,
  initialTone,
}: {
  toneId: number;
  initialTone?: Tone;
}) {
  const [tone, setTone] = useState<Tone | null>(
    initialTone ?? known.get(toneId) ?? null,
  );
  const [error, setError] = useState('');
  useEffect(() => {
    if (initialTone || known.has(toneId)) return;
    const abort = new AbortController();
    tone3000Tone(toneId, abort.signal)
      .then((found) => {
        known.set(toneId, found);
        if (!abort.signal.aborted) setTone(found);
      })
      .catch((cause) => {
        if (!abort.signal.aborted)
          setError(friendlyError(cause, 'read the tone details'));
      });
    return () => abort.abort();
  }, [toneId, initialTone]);
  if (!tone)
    return (
      <p className="caption" role={error ? 'alert' : 'status'}>
        {error
          ? 'Tone details need a TONE3000 connection.'
          : 'Reading tone details…'}
      </p>
    );
  const models =
    (tone.a1_models_count ?? 0) +
    (tone.a2_models_count ?? 0) +
    (tone.custom_models_count ?? 0);
  const count = models || tone.models_count;
  return (
    <SourceCard
      source={{
        kind: 'tone3000',
        title: tone.title,
        creator: {
          name: tone.user.display_name || tone.user.username,
          username: tone.user.display_name ? tone.user.username : undefined,
          profile: tone.user.profile_url ?? undefined,
        },
        page: toneLink(tone),
        image: toneImage(tone.id),
        gear: GearLabel({ gear: tone.gear }),
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
      }}
    />
  );
}
