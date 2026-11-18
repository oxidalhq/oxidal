import { SkipForward } from '@phosphor-icons/react';
import { Button } from '../components/ui/button';
import { CollapsibleSection } from '../components/ui/collapsible';
import { Segment, SegmentedControl } from '../components/ui/segmented';
import { Caption } from '../components/ui/text';
import {
  StemMixer,
  type StemControls,
  type StemRole,
} from '../widgets/stem-strip';
import {
  PositionBar,
  Transport,
  type TransportState,
} from '../widgets/transport';

export type BackingStems = Partial<Record<StemRole, StemControls>>;

/**
 * The backing track, small enough to keep beside the rig or the stage:
 * play and seek, **mute my part** (the guitar or the bass stem, one tap, so
 * you play it yourself), the full stem mix one fold away, and the next song
 * of the set list. Made for the tool dock; it works in a sheet too.
 */
export function BackingPanel({
  track,
  state,
  position,
  onPlay,
  onPause,
  onStop,
  onSeek,
  stems,
  onStem,
  myPart,
  onMyPart,
  next,
  onNext,
}: {
  track: { title: string; caption: string; duration: number };
  state: TransportState;
  /** Seconds. */
  position: number;
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
  onSeek: (seconds: number) => void;
  /** The live stem mix, when the track has stems. */
  stems?: BackingStems;
  onStem?: (role: StemRole, next: StemControls) => void;
  /** The stem you play yourself, muted in the mix. */
  myPart?: 'guitar' | 'bass' | 'none';
  onMyPart?: (part: 'guitar' | 'bass' | 'none') => void;
  /** The next song of the set list. */
  next?: string;
  onNext?: () => void;
}) {
  return (
    <div data-slot="backing-panel" className="grid gap-3">
      <div className="grid gap-0.5">
        <span className="truncate text-md font-semibold">{track.title}</span>
        <Caption as="span" className="truncate text-xs">
          {track.caption}
        </Caption>
      </div>
      <Transport
        state={state}
        onPlay={onPlay}
        onPause={onPause}
        onStop={onStop}
        compact
      />
      <PositionBar
        position={position}
        duration={track.duration}
        onSeek={onSeek}
      />
      {stems && myPart && onMyPart && (
        <div className="grid gap-1">
          <span className="small-caps text-xs text-muted-foreground">
            Mute my part
          </span>
          <SegmentedControl
            size="sm"
            value={myPart}
            onValueChange={(v) =>
              v && onMyPart(v as 'guitar' | 'bass' | 'none')
            }
            aria-label="Mute my part"
            className="w-full"
          >
            <Segment value="guitar">Guitar</Segment>
            <Segment value="bass">Bass</Segment>
            <Segment value="none">Nothing</Segment>
          </SegmentedControl>
        </div>
      )}
      {stems && onStem && (
        <CollapsibleSection title="Stem mix">
          <StemMixer stems={stems} onChange={onStem} className="h-44" />
        </CollapsibleSection>
      )}
      {next && (
        <Button
          size="sm"
          variant="outline"
          className="justify-self-start"
          onClick={onNext}
        >
          <SkipForward /> Next: {next}
        </Button>
      )}
    </div>
  );
}
