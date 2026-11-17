import { useState } from 'react';
import { Faders, MusicNotes } from '@phosphor-icons/react';
import { Button } from '../components/ui/button';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetFooter,
  SheetHeader,
} from '../components/ui/sheet';
import { PracticePanel } from '../widgets/practice';
import { Label } from '../components/ui/text';
import { Toggle } from '../components/ui/toggle';
import {
  StemMixer,
  type StemControls,
  type StemRole,
} from '../widgets/stem-strip';
import { Transport, type TransportState } from '../widgets/transport';
import { exampleWaveform } from '../widgets/practice.data';

const WAVEFORM = exampleWaveform();

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
            }}
            onPrevious={() => {}}
            onNext={() => {}}
          />
          <PracticePanel
            waveform={WAVEFORM}
            duration={222}
            position={64}
            bpm={118}
          />
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
