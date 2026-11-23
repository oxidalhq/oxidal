import {
  LockSimple,
  LockSimpleOpen,
  Microphone,
  Play,
} from '@phosphor-icons/react';
import type { ReactNode } from 'react';

import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardHeader, CardTitle } from '../components/ui/card';
import { List, ListRow } from '../components/ui/list-row';
import { Segment, SegmentedControl } from '../components/ui/segmented';
import { Slider } from '../components/ui/slider';
import { StableLabel } from '../components/ui/stable-label';
import { Caption } from '../components/ui/text';
import { Toggle } from '../components/ui/toggle';
import { responseCurve, type VenueSettings } from '../lib/venue-eq';

export type EqBand = { id: number; name: string; hz: number };
export type EqPosition = 'before' | 'after';

const settings = (bands: EqBand[], gains: number[]): VenueSettings => ({
  trimDb: 0,
  bands: [
    { enabled: false, freqHz: 80 },
    { enabled: true, freqHz: bands[0]?.hz ?? 120, gainDb: gains[0] },
    { enabled: true, freqHz: bands[1]?.hz ?? 400, gainDb: gains[1], q: 1 },
    { enabled: false, freqHz: 1000, gainDb: 0, q: 1 },
    { enabled: true, freqHz: bands[2]?.hz ?? 2000, gainDb: gains[2], q: 1 },
    { enabled: true, freqHz: bands[3]?.hz ?? 6000, gainDb: gains[3] },
    { enabled: false, freqHz: 12000 },
  ],
});

/**
 * A block's EQ: four bands you hear while you move them, where it sits
 * (before or after the block), and Cancel to return to the saved version.
 */
export function BlockEq({
  block,
  bands,
  gains,
  saved,
  position,
  status,
  onGains,
  onPosition,
  onKeep,
  onCancel,
}: {
  block: string;
  bands: EqBand[];
  /** What you hear now, in dB per band. */
  gains: number[];
  /** The saved gains, for Cancel. */
  saved: number[];
  position: EqPosition;
  /** A note after Keep or Cancel. */
  status?: string;
  onGains: (gains: number[]) => void;
  onPosition: (position: EqPosition) => void;
  onKeep: () => void;
  onCancel: () => void;
}) {
  const curve = responseCurve(settings(bands, gains), 80);
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
          onValueChange={(v) => v && onPosition(v as EqPosition)}
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
        {bands.map((b, i) => (
          <Slider
            key={b.id}
            label={`${b.name} · ${b.hz >= 1000 ? `${b.hz / 1000} kHz` : `${b.hz} Hz`}`}
            min={-12}
            max={12}
            step={0.5}
            value={[gains[i] ?? 0]}
            onValueChange={([v]) =>
              v !== undefined && onGains(gains.map((x, j) => (j === i ? v : x)))
            }
            readout={`${(gains[i] ?? 0) > 0 ? '+' : ''}${(gains[i] ?? 0).toFixed(1)} dB`}
          />
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={!changed} onClick={onKeep}>
          Keep
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!changed}
          onClick={onCancel}
        >
          Cancel
        </Button>
        <Caption as="span" role="status" className="text-xs">
          {changed ? 'You are hearing it now.' : status}
        </Caption>
      </div>
    </Card>
  );
}

export function RecordDiToggle({
  recording,
  disabled = false,
  onRecording,
}: {
  recording: boolean;
  disabled?: boolean;
  onRecording: (on: boolean) => void;
}) {
  return (
    <Toggle
      disabled={disabled}
      pressed={recording}
      onPressedChange={onRecording}
      aria-label="Record DI"
    >
      <Microphone />{' '}
      <StableLabel
        value={recording ? 'Stop and keep' : 'Record DI'}
        options={['Record DI', 'Stop and keep']}
      />
    </Toggle>
  );
}

export type DiTake = {
  id: string;
  name: string;
  length: string;
  reamps: number;
};

/**
 * DI and reamps: record the dry guitar while you play, then play it back
 * through any preset as if you were playing, to compare tones or record
 * the result. Your playing stays the same; only the rig changes.
 */
export function DiReamps({
  takes,
  recording,
  preset,
  onRecording,
  onReamp,
}: {
  takes: DiTake[];
  recording: boolean;
  /** The preset a reamp plays through: the loaded one. */
  preset: string;
  /** Start (true) or stop and keep (false) a DI recording. */
  onRecording: (recording: boolean) => void;
  onReamp: (take: string) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>DI and reamps</CardTitle>
        <RecordDiToggle recording={recording} onRecording={onRecording} />
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
                aria-label={`Reamp ${t.name} through ${preset}`}
                onClick={() => onReamp(t.id)}
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

export type StorageMode = 'locked' | 'unlocked';

/** Current storage and the selected next boot are independent device readback.
 * Choices only request a mode; a separately confirmed restart applies it.
 */
export function StorageLock({
  current,
  nextBoot,
  disabled = false,
  notice,
  restart,
  onChange,
}: {
  current: StorageMode | null;
  nextBoot: StorageMode | null;
  disabled?: boolean;
  notice?: ReactNode;
  restart?: ReactNode;
  onChange: (mode: StorageMode) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>System storage</CardTitle>
        <Badge size="sm">
          {current === 'locked'
            ? 'Locked now'
            : current === 'unlocked'
              ? 'Unlocked now'
              : 'Current state unknown'}
        </Badge>
      </CardHeader>
      <Caption>
        Locking protects system files at the next boot. Presets and unit data
        stay on the writable data partition. Unsaved changes can still be lost
        if power is cut. This never remounts a playing system.
      </Caption>
      <div
        role="group"
        aria-label="Mode at next boot"
        className="grid gap-2 sm:grid-cols-2"
      >
        <Button
          variant="outline"
          className="h-auto justify-start py-3 text-left aria-pressed:border-foreground aria-pressed:bg-accent"
          aria-pressed={nextBoot === 'unlocked'}
          disabled={disabled}
          onClick={() => onChange('unlocked')}
        >
          <LockSimpleOpen aria-hidden="true" />
          <span className="grid">
            <strong>Unlocked</strong>
            <span className="text-xs font-normal">
              Updates and installs work
            </span>
          </span>
        </Button>
        <Button
          variant="outline"
          className="h-auto justify-start py-3 text-left aria-pressed:border-foreground aria-pressed:bg-accent"
          aria-pressed={nextBoot === 'locked'}
          disabled={disabled}
          onClick={() => onChange('locked')}
        >
          <LockSimple aria-hidden="true" />
          <span className="grid">
            <strong>Locked</strong>
            <span className="text-xs font-normal">System files read-only</span>
          </span>
        </Button>
      </div>
      <Caption>
        Next boot:{' '}
        {nextBoot === 'locked'
          ? 'Locked'
          : nextBoot === 'unlocked'
            ? 'Unlocked'
            : 'Unknown'}
        .
      </Caption>
      {notice}
      {restart}
    </Card>
  );
}

export type BootMode = 'off' | 'last' | 'preset';

/** What plays when the device starts: nothing, the last session, or a chosen preset. */
export function BootPlayback({
  mode,
  lastSession,
  onMode,
}: {
  mode: BootMode;
  /** What the last session was, such as "Rhythm section, Scene 2". */
  lastSession: string;
  onMode: (mode: BootMode) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>When Oxidal starts</CardTitle>
      </CardHeader>
      <SegmentedControl
        size="sm"
        value={mode}
        onValueChange={(v) => v && onMode(v as BootMode)}
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
            ? `Plays ${lastSession}, as it was saved. About 20 s after power-on.`
            : 'Choose the preset in Library › Mine › ⋯ › Play when Oxidal starts.'}
      </Caption>
    </Card>
  );
}

/**
 * The debug console: a shell for diagnosing the device, off by default,
 * time-limited and run as its own restricted account. Not for everyday use.
 */
export function DebugConsole({
  on,
  minutesLeft,
  output,
  onChange,
}: {
  on: boolean;
  minutesLeft?: number;
  /** The terminal's text while it is on. */
  output: string;
  onChange: (on: boolean) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Debug console</CardTitle>
        <Badge size="sm">
          {on ? `On · ${minutesLeft ?? 15} min left` : 'Off'}
        </Badge>
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
          {output}
        </pre>
      )}
      <Button
        className="justify-self-start"
        variant={on ? 'outline' : 'default'}
        onClick={() => onChange(!on)}
      >
        {on ? 'Turn off now' : 'Turn on for 15 minutes'}
      </Button>
    </Card>
  );
}
