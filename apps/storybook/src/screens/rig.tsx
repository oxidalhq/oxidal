import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { RigSurface, type RigLane } from '@/patterns/rig-surface';
import { SCENES, SERIAL } from '@/patterns/rig.fixtures';

/** The Rig screen: the rig surface, or the card that says why audio is not playing. */
export function Rig({ audio = true }: { audio?: boolean }) {
  const [lanes, setLanes] = useState<RigLane[]>(SERIAL);
  const [scene, setScene] = useState<string | null>('b');
  if (!audio)
    return (
      <div className="grid gap-4 px-page pt-4">
        <Card className="max-w-2xl">
          <CardHeader>
            <CardTitle>Audio playback unavailable</CardTitle>
          </CardHeader>
          <p className="m-0 text-sm text-muted-foreground">
            This device cannot play audio right now. You can still browse and
            edit presets; check Audio setup if an interface should be connected.
          </p>
          <CardFooter>
            <Button>Browse presets</Button>
            <Button variant="outline">Audio setup</Button>
            <Button variant="outline">Tuner</Button>
          </CardFooter>
        </Card>
      </div>
    );
  return (
    <RigSurface
      presetName="Rhythm section"
      playing
      unsaved
      lanes={lanes}
      scenes={SCENES}
      activeScene={scene}
      onScene={setScene}
      onControl={(block, control, value) =>
        setLanes((all) =>
          all.map((l) => ({
            ...l,
            blocks: l.blocks.map((b) =>
              b.id === block
                ? {
                    ...b,
                    unsaved: true,
                    controls: b.controls.map((c) =>
                      c.id === control ? { ...c, value } : c,
                    ),
                  }
                : b,
            ),
          })),
        )
      }
      onToggleBlock={(block, on) =>
        setLanes((all) =>
          all.map((l) => ({
            ...l,
            blocks: l.blocks.map((b) => (b.id === block ? { ...b, on } : b)),
          })),
        )
      }
      onSource={() => {}}
      onAdd={() => {}}
      onMove={() => {}}
      onSave={() => {}}
      onRevert={() => {}}
    />
  );
}
