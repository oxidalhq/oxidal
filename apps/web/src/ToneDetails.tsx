import { Caption } from '@oxidal/design-system/components/text';
import {
  SourceCard,
  SourceLine,
  SourcePicture,
} from '@oxidal/design-system/widgets/block-source';

import type { TonePage } from './api';
import { useToneSource } from './useToneSource';

type Tone = TonePage['data'][number];

/**
 * What the selected block is, from TONE3000: its picture, name, author, gear
 * type, model count and licence, with a link to its page. Needs the unit to
 * reach TONE3000; the block keeps working without it.
 * @see docs/tone3000-account.md
 */
export function ToneDetails({
  toneId,
  initialTone,
  compact,
}: {
  toneId: number;
  initialTone?: Tone;
  compact?: boolean;
}) {
  // Another block starts afresh instead of showing the last one's details.
  return (
    <ToneCard
      key={toneId}
      toneId={toneId}
      initialTone={initialTone}
      compact={compact}
    />
  );
}

function ToneCard({
  toneId,
  initialTone,
  compact,
}: {
  toneId: number;
  initialTone?: Tone;
  compact?: boolean;
}) {
  const { source, error } = useToneSource(toneId, initialTone);
  if (!source)
    return (
      <Caption role={error ? 'alert' : 'status'}>
        {error
          ? 'Tone details need a TONE3000 connection.'
          : 'Reading tone details…'}
      </Caption>
    );
  if (!compact) return <SourceCard source={source} />;
  return (
    <div className="grid gap-2">
      <div className="flex min-w-0 items-center gap-2">
        <SourcePicture source={source} className="size-12 shrink-0" />
        <SourceLine source={source} />
      </div>
      <details>
        <summary>Source details</summary>
        <SourceCard source={source} />
      </details>
    </div>
  );
}
