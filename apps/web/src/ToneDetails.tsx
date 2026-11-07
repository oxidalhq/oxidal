import { friendlyError } from './lib/friendlyError';
import './ToneDetails.css';
import { ArrowSquareOut } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { tone3000Tone, toneImage, type TonePage } from './api';
import { GearIcon, GearLabel } from './GearIcon';

type Tone = TonePage['data'][number];

// Details change rarely and the same block is selected again and again.
const known = new Map<number, Tone>();

const licenses: Record<string, string> = { t3k: 'TONE3000 license' };

/** The tone's page, only ever on TONE3000 over HTTPS: the address comes from a web API. */
function toneLink(tone: Pick<Tone, 'id' | 'url'>) {
  try {
    const url = new URL(tone.url);
    if (
      url.protocol === 'https:' &&
      (url.hostname === 'tone3000.com' ||
        url.hostname.endsWith('.tone3000.com'))
    )
      return url.href;
  } catch {
    /* Fall through to the tone's own page. */
  }
  return `https://www.tone3000.com/tones/${tone.id}`;
}

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
  const [pictureFailed, setPictureFailed] = useState(false);
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
  const author = tone.user.display_name || tone.user.username;
  const models =
    (tone.a1_models_count ?? 0) +
    (tone.a2_models_count ?? 0) +
    (tone.custom_models_count ?? 0);
  const count = models || tone.models_count;
  return (
    <section className="tone-details" aria-label="TONE3000 details">
      <div className="tone-details-picture">
        {pictureFailed ? (
          <GearIcon gear={tone.gear} name={tone.title} />
        ) : (
          <img
            src={toneImage(tone.id)}
            alt=""
            loading="lazy"
            onError={() => setPictureFailed(true)}
          />
        )}
      </div>
      <div className="tone-details-text">
        <strong>{tone.title}</strong>
        <span>
          by {author}
          {tone.user.display_name && (
            <span className="caption"> @{tone.user.username}</span>
          )}
        </span>
        <span className="caption">
          <GearLabel gear={tone.gear} /> · {tone.format.toUpperCase()}
          {count > 0 && ` · ${count} model${count === 1 ? '' : 's'}`}
          {' · '}
          {licenses[tone.license] ?? tone.license}
        </span>
        <a
          className="tone-details-link"
          href={toneLink(tone)}
          target="_blank"
          rel="noopener noreferrer"
        >
          View on TONE3000 <ArrowSquareOut aria-hidden="true" />
        </a>
      </div>
    </section>
  );
}
