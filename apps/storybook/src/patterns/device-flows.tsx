import * as React from 'react';
import {
  LockSimple,
  LockSimpleOpen,
  Microphone,
  Play,
} from '@phosphor-icons/react';
import { responseCurve, type VenueSettings } from '../lib/venue-eq';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardHeader, CardTitle } from '../components/ui/card';
import { List, ListRow } from '../components/ui/list-row';
import { Segment, SegmentedControl } from '../components/ui/segmented';
import { Slider } from '../components/ui/slider';
import { Caption } from '../components/ui/text';
import { Toggle } from '../components/ui/toggle';

const BANDS = [
  { id: 1, name: 'Low', hz: 120 },
  { id: 2, name: 'Low mid', hz: 400 },
  { id: 3, name: 'High mid', hz: 2000 },
  { id: 4, name: 'High', hz: 6000 },
];
const settings = (gains: number[]): VenueSettings => ({
  trimDb: 0,
  bands: [
    { enabled: false, freqHz: 80 },
    { enabled: true, freqHz: BANDS[0]!.hz, gainDb: gains[0] },
    { enabled: true, freqHz: BANDS[1]!.hz, gainDb: gains[1], q: 1 },
    { enabled: false, freqHz: 1000, gainDb: 0, q: 1 },
    { enabled: true, freqHz: BANDS[2]!.hz, gainDb: gains[2], q: 1 },
    { enabled: true, freqHz: BANDS[3]!.hz, gainDb: gains[3] },
    { enabled: false, freqHz: 12000 },
  ],
});

/**
 * A block's EQ: four bands you hear while you move them, where it sits
 * (before or after the block), and Cancel to return to the saved version.
 */
export function BlockEq({ block = 'Plexi 50' }: { block?: string }) {
  const [saved, setSaved] = React.useState([0, -2, 1.5, 0]);
  const [gains, setGains] = React.useState(saved);
  const [position, setPosition] = React.useState('after');
  const [note, setNote] = React.useState('');
  const curve = responseCurve(settings(gains), 80);
  const W = 400;
  const H = 80;
  const path = curve
    .map(
      ([hz, db], i) =>
        `${i ? 'L' : 'M'}${((Math.log10(hz / 20) / 3) * W).toFixed(1)} ${(H / 2 - (db / 12) * (H / 2 - 4)).toFixed(1)}`,
    )
    .join(' ');
  const changed = gains.some((g, i) => g !== saved[i]);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{block} · EQ</CardTitle>
        <SegmentedControl
          size="sm"
          value={position}
          onValueChange={setPosition}
          aria-label="EQ position"
        >
          <Segment value="before">Before</Segment>
          <Segment value="after">After</Segment>
        </SegmentedControl>
      </CardHeader>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-20 w-full rounded-lg border border-border bg-background"
        role="img"
        aria-label="EQ curve"
      >
        <line x1="0" x2={W} y1={H / 2} y2={H / 2} stroke="var(--border)" />
        <path
          d={path}
          fill="none"
          stroke="var(--foreground)"
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div
        role="group"
        aria-label="EQ bands"
        className="grid gap-3 sm:grid-cols-2"
      >
        {BANDS.map((b, i) => (
          <Slider
            key={b.id}
            label={`${b.name} · ${b.hz >= 1000 ? `${b.hz / 1000} kHz` : `${b.hz} Hz`}`}
            min={-12}
            max={12}
            step={0.5}
            value={[gains[i]!]}
            onValueChange={([v]) =>
              v !== undefined &&
              setGains((g) => g.map((x, j) => (j === i ? v : x)))
            }
            readout={`${gains[i]! > 0 ? '+' : ''}${gains[i]!.toFixed(1)} dB`}
          />
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          disabled={!changed}
          onClick={() => (
            setSaved(gains),
            setNote('Kept. Save the preset to keep it for good.')
          )}
        >
          Keep
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!changed}
          onClick={() => (
            setGains(saved),
            setNote('Cancelled. Nothing was saved.')
          )}
        >
          Cancel
        </Button>
        <Caption as="span" role="status" className="text-xs">
          {changed ? 'You are hearing it now.' : note}
        </Caption>
      </div>
    </Card>
  );
}

/**
 * DI and reamps: record the dry guitar while you play, then play it back
 * through any preset as if you were playing, to compare tones or record
 * the result. Your playing stays the same; only the rig changes.
 */
export function DiReamps() {
  const [recording, setRecording] = React.useState(false);
  const [takes, setTakes] = React.useState([
    { id: 't1', name: 'Verse riff', length: '0:42', reamps: 2 },
    { id: 't2', name: 'Solo idea', length: '1:15', reamps: 0 },
  ]);
  return (
    <Card>
      <CardHeader>
        <CardTitle>DI and reamps</CardTitle>
        <Toggle
          size="sm"
          pressed={recording}
          onPressedChange={(on) => {
            setRecording(on);
            if (!on)
              setTakes((t) => [
                {
                  id: `t${t.length + 1}`,
                  name: `Take ${t.length + 1}`,
                  length: '0:18',
                  reamps: 0,
                },
                ...t,
              ]);
          }}
          aria-label="Record DI"
        >
          <Microphone /> {recording ? 'Stop and keep' : 'Record DI'}
        </Toggle>
      </CardHeader>
      {recording && (
        <Caption role="status">
          Recording the dry guitar… play as usual.
        </Caption>
      )}
      <List aria-label="DI recordings">
        {takes.map((t) => (
          <ListRow
            key={t.id}
            leading={<Play aria-hidden="true" />}
            title={t.name}
            caption={`${t.length} · ${t.reamps ? `${t.reamps} reamps` : 'not reamped yet'}`}
            trailing={
              <Button
                size="sm"
                variant="outline"
                aria-label={`Reamp ${t.name} through Rhythm section`}
              >
                Reamp
              </Button>
            }
          />
        ))}
      </List>
      <Caption className="text-xs">
        Reamp plays a DI through the preset that is loaded and saves the result
        beside it.
      </Caption>
    </Card>
  );
}

/**
 * System storage: read-only while you play; unlock it to install updates or
 * LV2 packs, then lock it again. Changes take a restart.
 */
export function StorageLock() {
  const [unlocked, setUnlocked] = React.useState(false);
  return (
    <Card>
      <CardHeader>
        <CardTitle>System storage</CardTitle>
        <Badge size="sm">{unlocked ? 'Unlocked' : 'Locked'}</Badge>
      </CardHeader>
      <Caption>
        {unlocked
          ? 'Updates and installs work. Lock it again when you are done; a power cut while unlocked is less safe.'
          : 'System files are read-only, so a power cut on stage cannot damage them. Unlock to install updates or LV2 packs.'}
      </Caption>
      <Button
        className="justify-self-start"
        variant="outline"
        onClick={() => setUnlocked(!unlocked)}
      >
        {unlocked ? <LockSimple /> : <LockSimpleOpen />}{' '}
        {unlocked ? 'Lock and restart' : 'Unlock and restart'}
      </Button>
    </Card>
  );
}

/** What plays when the device starts: nothing, the last session, or a chosen preset. */
export function BootPlayback() {
  const [mode, setMode] = React.useState('last');
  return (
    <Card>
      <CardHeader>
        <CardTitle>When Oxidal starts</CardTitle>
      </CardHeader>
      <SegmentedControl
        size="sm"
        value={mode}
        onValueChange={setMode}
        aria-label="Mode at next boot"
      >
        <Segment value="off">Stay silent</Segment>
        <Segment value="last">Last session</Segment>
        <Segment value="preset">A preset</Segment>
      </SegmentedControl>
      <Caption className="text-xs">
        {mode === 'off'
          ? 'Audio waits until you press Play.'
          : mode === 'last'
            ? 'Plays Rhythm section, Scene 2, as it was saved. About 20 s after power-on.'
            : 'Choose the preset in Library › Mine › ⋯ › Play when Oxidal starts.'}
      </Caption>
    </Card>
  );
}

/**
 * The debug console: a shell for diagnosing the device, off by default,
 * time-limited and run as its own restricted account. Not for everyday use.
 */
export function DebugConsole() {
  const [on, setOn] = React.useState(false);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Debug console</CardTitle>
        <Badge size="sm">{on ? 'On · 14 min left' : 'Off'}</Badge>
      </CardHeader>
      <Caption>
        For diagnosing problems with help. It runs as a restricted account and
        turns itself off after 15 minutes.
      </Caption>
      {on && (
        <pre
          aria-label="Console"
          className="m-0 h-32 overflow-auto rounded-lg bg-enclosure p-3 font-mono text-xs text-enclosure-foreground"
        >
          {`oxidal-debug@oxidal:~$ systemctl status oxidald --no-pager\n● oxidald.service - Oxidal daemon\n   Active: active (running) since Mon 09:12\noxidal-debug@oxidal:~$ █`}
        </pre>
      )}
      <Button
        className="justify-self-start"
        variant={on ? 'outline' : 'default'}
        onClick={() => setOn(!on)}
      >
        {on ? 'Turn off now' : 'Turn on for 15 minutes'}
      </Button>
    </Card>
  );
}
