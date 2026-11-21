import { useEffect, useState } from 'react';

import { Badge } from '../components/ui/badge';
import { Card, CardHeader, CardTitle } from '../components/ui/card';
import { Segment, SegmentedControl } from '../components/ui/segmented';
import { Slider } from '../components/ui/slider';
import { Switch } from '../components/ui/switch';
import { Caption, Readout } from '../components/ui/text';
import { PageHeading } from '../patterns/app-shell';
import { DeviceDashboard } from '../patterns/device-dashboard';
import { READINGS } from '../patterns/device-dashboard.data';
import {
  BrowserListeningDemo,
  CaptureReferencesDemo,
} from '../widgets/capture-listening.demo';
import { StereoMeter } from '../widgets/meter';
import { VenueEq } from '../widgets/venue-eq';
import { VENUE_PROFILES } from '../widgets/venue-eq.data';

function series(seed: number, n = 120) {
  const out: number[] = [];
  let v = seed;
  for (let i = 0; i < n; i++) {
    v = Math.max(
      0,
      Math.min(
        100,
        v + (Math.sin(i * 0.37 + seed) * 6 + (Math.random() - 0.5) * 8),
      ),
    );
    out.push(v);
  }
  return out;
}

/** A thin line chart with the deadline drawn as a dashed rule. */
function History({
  label,
  data,
  unit,
  limit,
  colour = 'var(--foreground)',
}: {
  label: string;
  data: number[];
  unit: string;
  limit?: number;
  colour?: string;
}) {
  const W = 320;
  const H = 72;
  const path = data
    .map(
      (v, i) =>
        `${i ? 'L' : 'M'}${((i / (data.length - 1)) * W).toFixed(1)} ${(H - 4 - (v / 100) * (H - 8)).toFixed(1)}`,
    )
    .join(' ');
  const last = data[data.length - 1] ?? 0;
  return (
    <div className="grid gap-1">
      <div className="flex items-baseline justify-between">
        <span className="small-caps text-sm font-medium text-muted-foreground">
          {label}
        </span>
        <Readout size="sm">
          {last.toFixed(0)}
          {unit}
        </Readout>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-18 w-full"
        aria-label={`${label} over the last ten minutes`}
        role="img"
        preserveAspectRatio="none"
      >
        {limit !== undefined && (
          <line
            x1="0"
            x2={W}
            y1={H - 4 - (limit / 100) * (H - 8)}
            y2={H - 4 - (limit / 100) * (H - 8)}
            stroke="var(--brand)"
            strokeDasharray="3 4"
          />
        )}
        <path d={path} fill="none" stroke={colour} strokeWidth="1.5" />
      </svg>
    </div>
  );
}

/**
 * Levels: the live stereo meters at input and output, and the device's
 * history — processing against the deadline, host CPU, temperature — with
 * xruns and clips as counts. Everything measured, nothing decorative.
 */

/**
 * The output, after the mix: master level, mono for a single PA feed, and
 * the venue EQ profile for the room. These are for the room, not the
 * preset, so they live here with the meters rather than in the rig or in
 * Settings › Audio.
 */
function Output() {
  const [level, setLevel] = useState(-3);
  const [mono, setMono] = useState(false);
  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <CardTitle>Output</CardTitle>
        <Caption as="span" className="text-xs">
          After the mix · not saved in presets
        </Caption>
      </CardHeader>
      <div className="grid gap-x-6 gap-y-4 md:grid-cols-2">
        <Slider
          label="Master level"
          min={-60}
          max={6}
          step={0.5}
          value={[level]}
          onValueChange={([v]) => v !== undefined && setLevel(v)}
          readout={`${level.toFixed(1)} dB`}
        />
        <div className="flex items-center justify-between gap-3">
          <label htmlFor="mono" className="grid gap-0.5">
            <span className="text-sm font-medium">Mono</span>
            <Caption as="span" className="text-xs">
              For a single PA or amp feed.
            </Caption>
          </label>
          <Switch id="mono" checked={mono} onCheckedChange={setMono} />
        </div>
      </div>
      <div className="grid gap-2 border-t border-border pt-3">
        <span className="text-md font-semibold">Venue EQ</span>
        <VenueEq profiles={VENUE_PROFILES} />
      </div>
    </Card>
  );
}

export function Levels({
  view: initial = 'meters',
}: { view?: 'meters' | 'device' } = {}) {
  const [view, setView] = useState(initial);
  const [range, setRange] = useState('10m');
  const [live, setLive] = useState({ il: -18, ir: -19, ol: -9, or: -10 });
  const [dsp] = useState(() => series(40));
  const [cpu] = useState(() => series(35));
  const [temp] = useState(() => series(58));
  useEffect(() => {
    const timer = setInterval(
      () =>
        setLive({
          il: -30 + Math.random() * 20,
          ir: -30 + Math.random() * 20,
          ol: -20 + Math.random() * 16,
          or: -20 + Math.random() * 16,
        }),
      200,
    );
    return () => clearInterval(timer);
  }, []);
  return (
    <>
      <PageHeading
        eyebrow="Levels"
        title={view === 'device' ? 'Device details' : 'Output and meters'}
        caption={
          view === 'device'
            ? 'Everything the device reports, over the last ten minutes'
            : 'What leaves the device, set for the room you are in'
        }
        actions={
          <>
            <SegmentedControl
              size="sm"
              value={view}
              onValueChange={(v) => setView(v as 'meters' | 'device')}
              aria-label="Levels view"
            >
              <Segment value="meters">Output and meters</Segment>
              <Segment value="device">Device details</Segment>
            </SegmentedControl>
            {view === 'meters' && (
              <SegmentedControl
                size="sm"
                value={range}
                onValueChange={setRange}
                aria-label="History range"
              >
                <Segment value="1m">1 min</Segment>
                <Segment value="10m">10 min</Segment>
                <Segment value="1h">1 h</Segment>
              </SegmentedControl>
            )}
          </>
        }
      />
      {view === 'device' ? (
        <DeviceDashboard readings={READINGS} />
      ) : (
        <div className="grid gap-4 px-page lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
          <Output />
          <div className="grid gap-4 lg:col-span-2">
            <CaptureReferencesDemo />
            <BrowserListeningDemo />
          </div>
          <Card>
            <CardHeader>
              <CardTitle>Now</CardTitle>
              <Badge tone="live">Running</Badge>
            </CardHeader>
            <div className="grid gap-5">
              <StereoMeter
                label="Input"
                left={live.il}
                right={live.ir}
                peaks={[live.il + 3, live.ir + 3]}
                size="lg"
              />
              <StereoMeter
                label="Output"
                left={live.ol}
                right={live.or}
                peaks={[live.ol + 2, live.or + 2]}
                size="lg"
              />
            </div>
            <div className="grid grid-cols-3 gap-3">
              {[
                ['Xruns', '0'],
                ['Clips', '0'],
                ['Recovered', '2'],
              ].map(([k, v]) => (
                <div
                  key={k}
                  className="grid gap-0.5 rounded-lg border border-border p-3"
                >
                  <span className="small-caps text-xs font-medium text-muted-foreground">
                    {k}
                  </span>
                  <Readout size="lg">{v}</Readout>
                </div>
              ))}
            </div>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>
                Last{' '}
                {range === '1m'
                  ? 'minute'
                  : range === '10m'
                    ? 'ten minutes'
                    : 'hour'}
              </CardTitle>
              <Caption as="span" className="text-xs">
                The dashed line is the period deadline.
              </Caption>
            </CardHeader>
            <History
              label="Processing, p95 of the period"
              data={dsp}
              unit="%"
              limit={100}
            />
            <History
              label="Host CPU"
              data={cpu}
              unit="%"
              colour="var(--wire)"
            />
            <History
              label="Temperature"
              data={temp}
              unit="°"
              limit={80}
              colour="var(--wire)"
            />
          </Card>
        </div>
      )}
    </>
  );
}
