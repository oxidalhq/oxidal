import { useState } from 'react';
import { Faders, MusicNotes } from '@phosphor-icons/react';
import { Button } from '../components/ui/button';
import { NumberField } from '../components/ui/number-field';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetFooter,
  SheetHeader,
} from '../components/ui/sheet';
import { Caption, Label } from '../components/ui/text';
import { Toggle } from '../components/ui/toggle';
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

/**
 * The backing player as a sheet over any screen: transport, position with
 * the A–B section, practice controls (speed, click), and the stems of the
 * cued song with mute, solo and level. On phones it rises from the bottom;
 * on laptops it slides in from the right.
 */
export function PlayerSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [state, setState] = useState<TransportState>('playing');
  const [position, setPosition] = useState(61);
  const [range, setRange] = useState<{ a: number; b: number } | null>({
    a: 60,
    b: 92,
  });
  const [loop, setLoop] = useState(true);
  const [click, setClick] = useState(true);
  const [speed, setSpeed] = useState(0.85);
  const [stems, setStems] = useState<Partial<Record<StemRole, StemControls>>>({
    vocals: { level: -60, muted: true, solo: false },
    drums: { level: 0, muted: false, solo: false },
    bass: { level: -2, muted: false, solo: false },
    guitar: { level: -12, muted: false, solo: false },
    piano: { level: -4, muted: false, solo: false },
    other: { level: -3, muted: false, solo: false },
  });
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        onOpenChange={onOpenChange}
        className="md:w-[min(34rem,100vw)]"
      >
        <SheetHeader
          title="Iron Pulse"
          description="Rehearsal mix · 118 BPM · 6 stems"
        />
        <SheetBody>
          <Transport
            state={state}
            onPlay={() => setState('playing')}
            onPause={() => setState('paused')}
            onStop={() => {
              setState('cued');
              setPosition(0);
            }}
            onPrevious={() => {}}
            onNext={() => {}}
            loop={loop}
            onLoop={(on) => {
              setLoop(on);
              setRange(on ? { a: 60, b: 92 } : null);
            }}
            click={click}
            onClick={setClick}
          />
          <PositionBar
            position={position}
            duration={222}
            range={loop ? range : null}
            onSeek={setPosition}
            onRange={setRange}
            beats={Array.from({ length: 436 }, (_, i) => (i * 60) / 118).slice(
              0,
              399,
            )}
          />
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-lg border border-border p-3">
            <div className="grid gap-0.5">
              <Label as="span">Speed</Label>
              <Caption className="text-xs">
                Pitch stays the same. 0.5× to 1.5×.
              </Caption>
            </div>
            <NumberField
              label="Speed"
              value={speed}
              onChange={setSpeed}
              min={0.5}
              max={1.5}
              step={0.05}
              fine={0.01}
              unit="×"
              digits={2}
              size="sm"
            />
          </div>
          <div className="grid gap-2">
            <div className="flex items-center justify-between">
              <Label as="span">Stems</Label>
              <Toggle size="sm" pressed aria-label="Live stems">
                <Faders /> Live
              </Toggle>
            </div>
            <StemMixer
              stems={stems}
              onChange={(role, next) =>
                setStems((all) => ({ ...all, [role]: next }))
              }
              className="h-56"
            />
          </div>
        </SheetBody>
        <SheetFooter>
          <Button variant="outline">
            <MusicNotes /> Save as mix…
          </Button>
          <Button onClick={() => onOpenChange(false)}>Done</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
