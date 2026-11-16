import { useEffect, useState } from 'react';
import { Guitar, Plus } from '@phosphor-icons/react';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardFooter, CardHeader, CardTitle } from '../components/ui/card';
import { List, ListRow } from '../components/ui/list-row';
import { NumberField } from '../components/ui/number-field';
import { StepProgress } from '../components/ui/states';
import { Caption, Readout } from '../components/ui/text';
import { PageHeading } from '../patterns/app-shell';
import { Meter } from '../widgets/meter';
import { GUITARS } from './fixtures';

/**
 * Guitars: the instrument profiles (which one is plugged in, its trim),
 * the sound check that sets the input level by ear and meter, and the
 * loudness tools (Level match, Even out) as cards with one action each.
 */
export function Guitars() {
  const [active, setActive] = useState('g1');
  const [trim, setTrim] = useState(-6);
  const [level, setLevel] = useState(-20);
  const [checking, setChecking] = useState(false);
  useEffect(() => {
    const timer = setInterval(() => setLevel(-26 + Math.random() * 20), 200);
    return () => clearInterval(timer);
  }, []);
  return (
    <>
      <PageHeading
        eyebrow="Guitars"
        title="Telecaster"
        caption="Plugged in · single coils"
        actions={
          <Button variant="outline">
            <Plus /> Add guitar
          </Button>
        }
      />
      <div className="grid gap-4 px-page lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Your guitars</CardTitle>
          </CardHeader>
          <List>
            {GUITARS.map((g) => (
              <ListRow
                key={g.id}
                leading={<Guitar className="ml-2 size-5" />}
                title={g.name}
                caption={g.caption}
                selected={g.id === active}
                onClick={() => setActive(g.id)}
                trailing={
                  g.id === active ? (
                    <Badge
                      tone="live"
                      className="border-background text-background"
                    >
                      Plugged in
                    </Badge>
                  ) : undefined
                }
              />
            ))}
          </List>
          <div className="flex items-center justify-between gap-4">
            <div className="grid gap-0.5">
              <span className="text-sm font-medium">Input trim</span>
              <Caption className="text-xs">
                Applied before the rig for this guitar.
              </Caption>
            </div>
            <NumberField
              label="Input trim"
              value={trim}
              onChange={setTrim}
              min={-24}
              max={12}
              step={0.5}
              unit="dB"
            />
          </div>
        </Card>
        <div className="grid content-start gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Sound check</CardTitle>
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
              Play your loudest chord. The peak should land just under the hot
              zone; Oxidal sets the trim from it.
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
                <Button onClick={() => setChecking(true)}>
                  Start sound check
                </Button>
              </CardFooter>
            )}
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Even out</CardTitle>
              <Badge>Last run 96 × 3</Badge>
            </CardHeader>
            <Caption>
              Plays every preset for a moment and matches their loudness so no
              preset jumps out on stage. Takes about a minute per ten presets.
            </Caption>
            <CardFooter>
              <Button variant="outline">Even out all</Button>
              <Button variant="ghost">Level match…</Button>
            </CardFooter>
          </Card>
        </div>
      </div>
    </>
  );
}
