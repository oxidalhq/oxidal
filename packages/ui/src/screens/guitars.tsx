import { useEffect, useState } from 'react';

import { Button } from '../components/ui/button';
import { Card, CardFooter, CardHeader, CardTitle } from '../components/ui/card';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
} from '../components/ui/dialog';
import { NumberField } from '../components/ui/number-field';
import { StepProgress } from '../components/ui/states';
import { Caption, Readout } from '../components/ui/text';
import {
  EvenOutDemo,
  LevelMatchDemo,
  SoundCheckDemo,
} from '../patterns/guitar-tools.demo';
import { GuitarWorkspace } from '../patterns/guitar-workspace';
import { CaptureReferencesDemo } from '../widgets/capture-listening.demo';
import { Meter } from '../widgets/meter';
import { GUITARS } from './fixtures';

/**
 * Guitars: the instrument profiles (which one is plugged in, its trim),
 * the sound check that sets the input level by ear and meter, and the
 * loudness tools (Level match, Even out) as cards with one action each.
 */
export function Guitars() {
  const [guitars, setGuitars] = useState(GUITARS);
  const [newName, setNewName] = useState<string | null>(null);
  const [active, setActive] = useState('g1');
  const [trim, setTrim] = useState(-6);
  const [level, setLevel] = useState(-20);
  const [checking, setChecking] = useState(false);
  useEffect(() => {
    const timer = setInterval(() => setLevel(-26 + Math.random() * 20), 200);
    return () => clearInterval(timer);
  }, []);
  return (
    <GuitarWorkspace
      guitars={guitars}
      onAdd={() => setNewName('')}
      active={active}
      onSelect={setActive}
      caption={guitars.find((guitar) => guitar.id === active)?.caption}
      trimControl={
        <NumberField
          label="Input trim"
          value={trim}
          onChange={setTrim}
          min={-24}
          max={24}
          step={0.5}
          unit="dB"
        />
      }
    >
      <Dialog
        open={newName !== null}
        onOpenChange={(open) => {
          if (!open) setNewName(null);
        }}
      >
        <DialogContent>
          <DialogHeader title="Add guitar" closeLabel="Close" />
          <DialogBody>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const name = newName?.trim();
                if (!name) return;
                const id = crypto.randomUUID();
                setGuitars([
                  ...guitars,
                  { id, name, caption: '', active: false },
                ]);
                setNewName(null);
              }}
            >
              <label className="grid gap-1">
                Guitar name
                <input
                  value={newName ?? ''}
                  onChange={(e) => setNewName(e.target.value)}
                  required
                />
              </label>
              <Button type="submit" disabled={!newName?.trim()}>
                Add
              </Button>
            </form>
          </DialogBody>
        </DialogContent>
      </Dialog>
      <SoundCheckDemo />
      <Card>
        <CardHeader>
          <CardTitle>Input level</CardTitle>
          <Readout size="sm">{level.toFixed(1)} dB</Readout>
        </CardHeader>
        <Meter
          label="Input"
          value={level}
          peak={level + 4}
          size="lg"
          showValue={false}
        />
        <Caption>
          Play your loudest chord. The peak should land just under the hot zone;
          Oxidal sets the trim from it.
        </Caption>
        {checking ? (
          <StepProgress
            label="Sound check"
            steps={['Listening', 'Setting trim', 'Done']}
            current={1}
            onCancel={() => setChecking(false)}
          />
        ) : (
          <CardFooter>
            <Button onClick={() => setChecking(true)}>Start sound check</Button>
          </CardFooter>
        )}
      </Card>
      <LevelMatchDemo />
      <EvenOutDemo />
      <CaptureReferencesDemo appliedTrim={trim} />
    </GuitarWorkspace>
  );
}
