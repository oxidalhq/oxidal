import { Button } from '@oxidal/design-system/components/button';
import {
  BackingPanel,
  type BackingStems,
} from '@oxidal/design-system/patterns/backing-panel';

import {
  nextUp,
  stateWord,
  usePlayerPosition,
  useSessionMedia,
} from './sessionMedia';
import { controls } from './stemMix';

export function BackingTool() {
  const { player, shown, send, tracks, ready, refusal, setSheet } =
    useSessionMedia();
  const { at, length } = usePlayerPosition();
  const track = player?.track;
  if (!ready) return <p>Waiting for the backing player.</p>;
  if (!track)
    return (
      <Button onClick={() => setSheet({ kind: 'list' })}>Choose track</Button>
    );
  const live = player.stems;
  const stems: BackingStems = {};
  if (live)
    for (const role of live.roles) {
      const row = controls(live.recipe, role);
      stems[role] = {
        muted: row.muted,
        solo: row.solo,
        level: row.gain_tenths_db / 10,
      };
    }
  const next = nextUp(player, tracks);
  if (shown === 'unavailable')
    return <p>{player.reason ?? 'Track unavailable'}</p>;
  return (
    <>
      <BackingPanel
        track={{
          title: track.title,
          duration: length,
          caption: stateWord[shown],
        }}
        position={at}
        state={
          shown === 'stalled' || shown === 'playing'
            ? 'playing'
            : shown === 'paused'
              ? 'paused'
              : 'cued'
        }
        onPlay={() => void send({ kind: 'play' })}
        onPause={() => void send({ kind: 'pause' })}
        onStop={() => void send({ kind: 'stop' })}
        onSeek={(seconds) =>
          void send({
            kind: 'seek_to',
            frame: Math.round(seconds * track.rate),
          })
        }
        next={next?.title}
        onNext={() => void send({ kind: 'next' })}
        stems={live ? stems : undefined}
        myPart={live?.mutedPart ?? 'none'}
        minimumStemLevel={-24}
        onMyPart={(part) =>
          live &&
          void send({
            kind: 'set_muted_part',
            split: live.split,
            part: part === 'none' ? null : part,
          })
        }
        onStem={(role, value) => {
          const row = stems[role];
          if (!live || !row) return;
          const edit =
            value.muted !== row.muted
              ? { field: 'mute' as const, value: value.muted }
              : value.solo !== row.solo
                ? { field: 'solo' as const, value: value.solo }
                : {
                    field: 'gain' as const,
                    value: Math.round(value.level * 10),
                  };
          void send({ kind: 'edit_stem', split: live.split, role, edit });
        }}
      />
      {refusal && <p role="alert">{refusal}</p>}
    </>
  );
}
