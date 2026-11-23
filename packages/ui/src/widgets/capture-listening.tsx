import { type ReactNode, useState } from 'react';

import { Button } from '../components/ui/button';
import { Card, CardHeader, CardTitle } from '../components/ui/card';
import { Caption } from '../components/ui/text';

export type ListeningChoice = { id: string; title: string };

export function ListeningSelect({
  label,
  value,
  choices,
  onChange,
}: {
  label: string;
  value: string;
  choices: ListeningChoice[];
  onChange: (id: string) => void;
}) {
  return (
    <label className="grid min-w-0 gap-1 text-sm">
      {label}
      <select
        className="min-h-touch min-w-0 rounded-md border border-input bg-background px-2 text-foreground"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">Choose…</option>
        {choices.map(({ id, title }) => (
          <option key={id} value={id}>
            {title}
          </option>
        ))}
      </select>
    </label>
  );
}

export function CaptureReferences({
  appliedTrim,
  pedal,
  amp,
}: {
  appliedTrim: number | null;
  pedal: ReactNode;
  amp: ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Capture references</CardTitle>
      </CardHeader>
      <Caption>
        Measure the guitar with your normal interface gain. Choose captures to
        read the input and output references stored in their NAM files.
      </Caption>
      <p className="text-sm">
        Applied guitar trim{' '}
        {appliedTrim == null ? 'Unknown' : `${appliedTrim.toFixed(1)} dB`}
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {pedal}
        {amp}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-sm">
          Interface input reference (dBu)
          <input
            className="min-h-touch min-w-0 rounded-md border border-input bg-background px-2"
            type="number"
            step="any"
            placeholder="Unknown"
          />
        </label>
        <label className="grid gap-1 text-sm">
          Interstage trim (dB)
          <input
            className="min-h-touch min-w-0 rounded-md border border-input bg-background px-2"
            type="number"
            step="any"
            placeholder="Unknown"
          />
        </label>
      </div>
      <Caption>
        Enter a measured interface reference or the trim you set between the
        pedal and amp in Rig. These notes are temporary and apply no gain. When
        a capture reference is unknown, listen and use the meters to set the
        levels manually.
      </Caption>
    </Card>
  );
}

export type ListeningMeasurement = {
  rms: number;
  reduction: number;
};

export function BrowserListening({
  choices,
  first,
  second,
  onFirst,
  onSecond,
  onMeasure,
  measurements,
  busy,
  message,
  status,
  onPlay,
  onStop,
  onClose,
}: {
  choices: ListeningChoice[];
  first: string;
  second: string;
  onFirst: (id: string) => void;
  onSecond: (id: string) => void;
  onMeasure: () => void;
  measurements: [ListeningMeasurement, ListeningMeasurement] | null;
  busy?: boolean;
  message?: string;
  status?: string;
  onPlay: (side: 0 | 1, match: boolean) => void;
  onStop: () => void;
  onClose: () => void;
}) {
  const [match, setMatch] = useState(true);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Browser audition</CardTitle>
        <Button variant="ghost" onClick={onClose}>
          Close audition
        </Button>
      </CardHeader>
      <Caption>
        Create two reamps in DI &amp; Reamp using the same short DI, channel and
        input settings. Choose current input processing to apply guitar trim and
        gate once, or choose none if the DI is already levelled. Listen on this
        browser’s audio output. The match only turns down the louder render by
        up to 18 dB. Saved Boost and the unit’s output stay as set.
      </Caption>
      <div className="grid gap-3 sm:grid-cols-2">
        <ListeningSelect
          label="Reamp A"
          value={first}
          choices={choices}
          onChange={onFirst}
        />
        <ListeningSelect
          label="Reamp B"
          value={second}
          choices={choices}
          onChange={onSecond}
        />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="outline"
          disabled={busy || !first || !second || first === second}
          onClick={onMeasure}
        >
          {busy ? 'Measuring…' : 'Measure pair'}
        </Button>
        {measurements && (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={match}
              onChange={(event) => {
                onStop();
                setMatch(event.target.checked);
              }}
            />
            Match browser playback
          </label>
        )}
      </div>
      {message && (
        <p role="alert" className="text-sm">
          {message}
        </p>
      )}
      {measurements && (
        <div className="grid gap-3 sm:grid-cols-2">
          {Math.abs(measurements[0].rms - measurements[1].rms) > 18 && (
            <Caption className="sm:col-span-2">
              The difference exceeds the 18 dB browser trim limit.
            </Caption>
          )}
          {measurements.map(({ rms, reduction }, side) => {
            const label = side === 0 ? 'A' : 'B';
            const trim = match ? reduction.toFixed(1) : '0.0';
            return (
              <div className="grid justify-items-start gap-2" key={label}>
                <p className="text-sm">
                  {label} · {rms.toFixed(1)} dBFS RMS · {trim} dB browser trim
                </p>
                <Button
                  variant="outline"
                  onClick={() => onPlay(side === 0 ? 0 : 1, match)}
                >
                  Play {label}
                </Button>
              </div>
            );
          })}
        </div>
      )}
      {measurements && (
        <div>
          <Button variant="ghost" onClick={onStop}>
            Stop browser audio
          </Button>
        </div>
      )}
      {status && <Caption role="status">{status}</Caption>}
    </Card>
  );
}
