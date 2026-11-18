import {
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Stop,
} from '@phosphor-icons/react';
import type { ReactNode } from 'react';

import { Button } from '@oxidal/design-system/components/button';

import { type ShownState, useSessionMedia } from './sessionMedia';

function playLabel(state: ShownState) {
  return state === 'ended'
    ? 'Play again'
    : state === 'interrupted'
      ? 'Resume'
      : 'Play';
}

/**
 * The one to three transport buttons a compact surface shows for a state:
 * the masthead chip, the phone bar and the Perform row. Every Stop is
 * "Stop track", so it is never confused with Mute or stopping the audio.
 * @see docs/media.md
 */
export function CompactTransport({
  next = false,
  className = '',
}: {
  /** Perform adds Next to every state that has a track. */
  next?: boolean;
  className?: string;
}) {
  const { shown, pending, send } = useSessionMedia();
  const busy = pending || undefined;
  const play = (
    <Button
      key="play"
      variant={shown === 'interrupted' ? 'default' : 'outline'}
      aria-busy={busy}
      onClick={() => void send({ kind: 'play' })}
    >
      <Play aria-hidden="true" weight="fill" />
      {playLabel(shown)}
    </Button>
  );
  const pause = (
    <Button
      key="pause"
      variant="outline"
      aria-busy={busy}
      onClick={() => void send({ kind: 'pause' })}
    >
      <Pause aria-hidden="true" weight="fill" />
      Pause
    </Button>
  );
  const stop = (
    <Button
      key="stop"
      variant="outline"
      aria-busy={busy}
      onClick={() => void send({ kind: 'stop' })}
    >
      <Stop aria-hidden="true" weight="fill" />
      Stop track
    </Button>
  );
  const nextButton = (
    <Button
      key="next"
      variant="outline"
      aria-busy={busy}
      onClick={() => void send({ kind: 'next' })}
    >
      <SkipForward aria-hidden="true" weight="fill" />
      Next
    </Button>
  );
  const buttons = {
    empty: [],
    ready: [play],
    playing: [pause, stop],
    stalled: [pause, stop],
    paused: [play, stop],
    ended: [play],
    interrupted: [play, stop],
    unavailable: [],
  }[shown];
  const withNext =
    (next || shown === 'ended') && shown !== 'empty'
      ? [...buttons, nextButton]
      : buttons;
  if (!withNext.length) return null;
  return (
    <div
      className={`media-transport ${className}`}
      role="group"
      aria-label="Backing track transport"
    >
      {withNext}
    </div>
  );
}

/**
 * The full player's transport: Previous, −10 s, Play/Pause, +10 s, Next.
 * E-paper uses words on every button instead of icons.
 */
export function FullTransport() {
  const { shown, pending, send, slow } = useSessionMedia();
  const busy = pending || undefined;
  const playing = shown === 'playing' || shown === 'stalled';
  const main = playing ? 'Pause' : playLabel(shown);
  const button = (
    label: string,
    run: () => void,
    icon?: ReactNode,
    extra: { main?: boolean; disabled?: boolean; aria?: string } = {},
  ) => (
    <Button
      variant={extra.main ? 'default' : 'outline'}
      className={extra.main ? 'media-main' : undefined}
      aria-busy={busy}
      aria-label={!slow && icon ? (extra.aria ?? label) : undefined}
      disabled={extra.disabled}
      onClick={run}
    >
      {slow || !icon ? label : icon}
    </Button>
  );
  return (
    <div
      className="media-full-transport"
      role="group"
      aria-label="Transport"
      data-slow={slow || undefined}
    >
      {button(
        'Previous',
        () => void send({ kind: 'previous' }),
        <SkipBack aria-hidden="true" weight="fill" />,
        { aria: 'Previous track' },
      )}
      {button(
        slow ? 'Back 10 s' : '−10 s',
        () => void send({ kind: 'skip_by', seconds: -10 }),
      )}
      {button(
        main,
        () => void send({ kind: playing ? 'pause' : 'play' }),
        playing ? (
          <Pause aria-hidden="true" weight="fill" />
        ) : (
          <Play aria-hidden="true" weight="fill" />
        ),
        { main: true, disabled: shown === 'unavailable' },
      )}
      {button(
        slow ? 'Fwd 10 s' : '+10 s',
        () => void send({ kind: 'skip_by', seconds: 10 }),
      )}
      {button(
        'Next',
        () => void send({ kind: 'next' }),
        <SkipForward aria-hidden="true" weight="fill" />,
        { aria: 'Next track' },
      )}
    </div>
  );
}
