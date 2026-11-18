import * as React from 'react';
import { CheckCircle, DotsThree, Warning } from '@phosphor-icons/react';
import { cn } from '../lib/cn';
import {
  BANDS,
  GAIN_LIMIT,
  TRIM_MAX,
  TRIM_MIN,
  clamp,
  formatDb,
  formatHz,
  headroom,
  isPass,
  responseCurve,
  roundHz,
  withBand,
  type VenueSettings,
} from '../lib/venue-eq';
import { Button } from '../components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu';
import { NumberField } from '../components/ui/number-field';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import { Switch } from '../components/ui/switch';
import { Toggle } from '../components/ui/toggle';
import { Caption } from '../components/ui/text';
import { StableLabel } from '../components/ui/stable-label';

export type VenueProfile = {
  id: string;
  name: string;
  /** A starting point that ships with Oxidal; saving makes your own copy. */
  builtIn?: boolean;
  eq: VenueSettings;
};

const W = 820;
const H = 230;
const PAD = { l: 30, r: 10, t: 22, b: 24 };
const GRID_HZ = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
const x = (hz: number) =>
  PAD.l + (Math.log10(hz / 20) / 3) * (W - PAD.l - PAD.r);
const y = (db: number) =>
  PAD.t + ((GAIN_LIMIT - db) / (2 * GAIN_LIMIT)) * (H - PAD.t - PAD.b);
const hzAt = (px: number) => 20 * 1000 ** ((px - PAD.l) / (W - PAD.l - PAD.r));
const dbAt = (py: number) =>
  GAIN_LIMIT - ((py - PAD.t) / (H - PAD.t - PAD.b)) * 2 * GAIN_LIMIT;

/**
 * The venue EQ: the output's correction for the room, after the mix. Pick a
 * profile (Home, Small room, Friday gig), drag a band on the graph or set it
 * in the fields, trim the output, and check the peak boost before it clips.
 * Bypass and Compare to saved are for listening; nothing here changes
 * presets, recordings or reamps.
 */
export function VenueEq({
  profiles: initial,
  onHear,
  onProfiles,
  className,
}: {
  profiles: VenueProfile[];
  /** What the output should play now: the EQ, or null when bypassed. */
  onHear?: (eq: VenueSettings | null) => void;
  /** The saved profiles after Save, Save as, rename or delete. */
  onProfiles?: (profiles: VenueProfile[]) => void;
  className?: string;
}) {
  const [profiles, setProfiles] = React.useState(initial);
  const [id, setId] = React.useState(initial[0]!.id);
  const saved = profiles.find((p) => p.id === id)!;
  const [eq, setEq] = React.useState<VenueSettings>(saved.eq);
  const [band, setBand] = React.useState(2);
  const [bypass, setBypass] = React.useState(false);
  const [compare, setCompare] = React.useState(false);
  const svg = React.useRef<SVGSVGElement>(null);
  const dragging = React.useRef<number | null>(null);
  const hear = React.useRef(onHear);
  const keep = React.useRef(onProfiles);
  React.useEffect(() => {
    hear.current = onHear;
    keep.current = onProfiles;
  }, [onHear, onProfiles]);
  const first = React.useRef(true);
  React.useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    keep.current?.(profiles);
  }, [profiles]);

  const changed = JSON.stringify(eq) !== JSON.stringify(saved.eq);
  const heard = compare ? saved.eq : eq;
  const live = bypass ? null : heard;
  const liveKey = JSON.stringify(live);
  React.useEffect(() => {
    hear.current?.(JSON.parse(liveKey) as VenueSettings | null);
  }, [liveKey]);
  const room = headroom(heard);
  const curve = responseCurve(heard, 160);
  const path = curve
    .map(
      ([hz, db], i) =>
        `${i ? 'L' : 'M'}${x(hz).toFixed(1)} ${y(clamp(db + heard.trimDb, -GAIN_LIMIT, GAIN_LIMIT)).toFixed(1)}`,
    )
    .join(' ');
  const selected = eq.bands[band]!;
  const info = BANDS[band]!;

  const pick = (next: string) => {
    const profile = profiles.find((p) => p.id === next)!;
    setId(next);
    setEq(profile.eq);
    setCompare(false);
  };
  const change = (
    index: number,
    patch: Partial<VenueSettings['bands'][number]>,
  ) => setEq((now) => withBand(now, index, patch));

  const move = (event: React.PointerEvent) => {
    const index = dragging.current;
    if (index === null || !svg.current) return;
    const box = svg.current.getBoundingClientRect();
    const px = ((event.clientX - box.left) / box.width) * W;
    const py = ((event.clientY - box.top) / box.height) * H;
    const b = BANDS[index]!;
    change(index, {
      enabled: true,
      freqHz: roundHz(clamp(hzAt(px), b.minHz, b.maxHz)),
      ...(isPass(index)
        ? {}
        : {
            gainDb:
              Math.round(clamp(dbAt(py), -GAIN_LIMIT, GAIN_LIMIT) * 2) / 2,
          }),
    });
  };

  return (
    <section
      data-slot="venue-eq"
      aria-label="Venue EQ"
      className={cn('grid gap-3', className)}
    >
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-48 flex-1">
          <Select value={id} onValueChange={pick}>
            <SelectTrigger aria-label="Venue profile">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {profiles.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={!changed || saved.builtIn}
          onClick={() =>
            setProfiles((all) =>
              all.map((p) => (p.id === id ? { ...p, eq } : p)),
            )
          }
        >
          Save
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            const copy = {
              id: `p-${Date.now()}`,
              name: `${saved.name} copy`,
              eq,
            };
            setProfiles((all) => [...all, copy]);
            setId(copy.id);
          }}
        >
          Save as…
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!changed}
          onClick={() => setEq(saved.eq)}
        >
          Revert
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="icon"
              variant="outline"
              aria-label="More for this profile"
            >
              <DotsThree />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem disabled={saved.builtIn}>
              Rename…
            </DropdownMenuItem>
            <DropdownMenuItem>Duplicate</DropdownMenuItem>
            <DropdownMenuItem disabled={saved.builtIn}>
              Delete…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <Caption className="text-xs">
        {saved.builtIn
          ? `“${saved.name}” is a starting point to tune by ear, not a measured correction. Saving makes your own copy.`
          : 'Applies to the main outputs, and the headphones on this interface.'}
      </Caption>

      <svg
        ref={svg}
        viewBox={`0 0 ${W} ${H}`}
        className={cn(
          'w-full touch-none rounded-lg border border-border bg-background',
          bypass && 'opacity-50',
        )}
        role="img"
        aria-label={`Venue EQ response. Peak boost ${formatDb(room.peak)}.`}
        onPointerMove={move}
        onPointerUp={() => (dragging.current = null)}
        onPointerLeave={() => (dragging.current = null)}
      >
        {GRID_HZ.map((hz) => (
          <g key={hz}>
            <line
              x1={x(hz)}
              x2={x(hz)}
              y1={PAD.t}
              y2={H - PAD.b}
              stroke="var(--border)"
            />
            <text
              x={x(hz)}
              y={H - 8}
              textAnchor="middle"
              fontSize="10"
              fill="var(--muted-foreground)"
            >
              {hz >= 1000 ? `${hz / 1000}k` : hz}
            </text>
          </g>
        ))}
        {[12, 6, 0, -6, -12].map((db) => (
          <g key={db}>
            <line
              x1={PAD.l}
              x2={W - PAD.r}
              y1={y(db)}
              y2={y(db)}
              stroke="var(--border)"
              strokeWidth={db === 0 ? 1.5 : 1}
            />
            <text
              x={PAD.l - 4}
              y={y(db) + 3}
              textAnchor="end"
              fontSize="10"
              fill="var(--muted-foreground)"
            >
              {db > 0 ? `+${db}` : db === 0 ? '0' : `−${-db}`}
            </text>
          </g>
        ))}
        <path
          d={`${path} L${x(20000)} ${y(0)} L${x(20)} ${y(0)} Z`}
          fill="var(--foreground)"
          opacity="0.06"
        />
        <path
          d={path}
          fill="none"
          stroke="var(--foreground)"
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
        />
        {eq.bands.map((b, i) => {
          const pass = isPass(i);
          const cx = x(b.freqHz);
          const cy = y(pass ? 0 : (b.gainDb ?? 0));
          const active = i === band;
          return (
            <g
              key={i}
              className="cursor-grab"
              onPointerDown={(event) => {
                setBand(i);
                dragging.current = i;
                (
                  event.currentTarget.ownerSVGElement as SVGSVGElement
                ).setPointerCapture(event.pointerId);
              }}
            >
              {pass ? (
                <rect
                  x={cx - 6}
                  y={cy - 6}
                  width="12"
                  height="12"
                  fill={b.enabled ? 'var(--foreground)' : 'var(--background)'}
                  stroke={active ? 'var(--brand)' : 'var(--foreground)'}
                  strokeWidth="2"
                />
              ) : (
                <circle
                  cx={cx}
                  cy={cy}
                  r="7"
                  fill={
                    active
                      ? 'var(--brand)'
                      : b.enabled
                        ? 'var(--foreground)'
                        : 'var(--background)'
                  }
                  stroke={active ? 'var(--brand)' : 'var(--foreground)'}
                  strokeWidth="2"
                />
              )}
              <text
                x={cx}
                y={pass ? cy + 20 : cy - 12}
                textAnchor="middle"
                fontSize="10"
                fontWeight="600"
                fill="var(--foreground)"
              >
                {BANDS[i]!.short}
              </text>
            </g>
          );
        })}
      </svg>

      <div
        role="group"
        aria-label="Bands"
        className="grid grid-cols-4 gap-1.5 sm:grid-cols-7"
      >
        {eq.bands.map((b, i) => (
          <button
            key={i}
            type="button"
            aria-pressed={i === band}
            onClick={() => setBand(i)}
            className={cn(
              'grid min-h-touch place-items-center rounded-lg border border-input px-1 py-1 text-xs hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring aria-pressed:border-foreground aria-pressed:bg-foreground aria-pressed:text-background',
              !b.enabled && 'border-dashed',
            )}
          >
            <span className="font-semibold">{BANDS[i]!.short}</span>{' '}
            <span className="font-mono tabular-nums opacity-80">
              {b.enabled ? formatHz(b.freqHz) : 'off'}
            </span>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(7.5rem,1fr))] items-end gap-3">
        <div className="flex items-center gap-2">
          <label htmlFor="band-on" className="text-sm font-medium">
            {info.name}
          </label>
          <Switch
            id="band-on"
            checked={selected.enabled}
            onCheckedChange={(on) => change(band, { enabled: on })}
          />
        </div>
        <div className="grid gap-0.5">
          <span className="small-caps text-xs text-muted-foreground">
            Frequency
          </span>
          <NumberField
            label={`${info.name} frequency`}
            value={selected.freqHz}
            min={info.minHz}
            max={info.maxHz}
            step={selected.freqHz >= 1000 ? 10 : 1}
            unit="Hz"
            digits={0}
            onChange={(v) => change(band, { freqHz: roundHz(v) })}
          />
        </div>
        {!isPass(band) && (
          <div className="grid gap-0.5">
            <span className="small-caps text-xs text-muted-foreground">
              Gain
            </span>
            <NumberField
              label={`${info.name} gain`}
              value={selected.gainDb ?? 0}
              min={-GAIN_LIMIT}
              max={GAIN_LIMIT}
              step={0.5}
              unit="dB"
              digits={1}
              onChange={(v) => change(band, { gainDb: v })}
            />
          </div>
        )}
        {info.kind === 'bell' && (
          <div className="grid gap-0.5">
            <span className="small-caps text-xs text-muted-foreground">Q</span>
            <NumberField
              label={`${info.name} Q`}
              value={selected.q ?? 1}
              min={0.3}
              max={8}
              step={0.1}
              digits={2}
              onChange={(v) => change(band, { q: v })}
            />
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="grid w-48 gap-0.5">
          <span className="small-caps text-xs text-muted-foreground">
            Output trim
          </span>
          <NumberField
            label="Output trim"
            value={eq.trimDb}
            min={TRIM_MIN}
            max={TRIM_MAX}
            step={0.5}
            unit="dB"
            digits={1}
            onChange={(v) => setEq((now) => ({ ...now, trimDb: v }))}
          />
        </div>
        <Toggle size="sm" pressed={bypass} onPressedChange={setBypass}>
          <StableLabel
            value={bypass ? 'Bypassed' : 'Bypass'}
            options={['Bypass', 'Bypassed']}
          />
        </Toggle>
        <Toggle
          size="sm"
          pressed={compare}
          disabled={!changed}
          onPressedChange={setCompare}
        >
          <StableLabel
            value={compare ? 'Hearing saved' : 'Compare to saved'}
            options={['Compare to saved', 'Hearing saved']}
          />
        </Toggle>
        <span
          role="status"
          className={cn(
            'ml-auto inline-flex items-center gap-1.5 text-sm',
            room.risky && 'font-semibold text-brand',
          )}
        >
          {room.risky ? (
            <Warning aria-hidden="true" />
          ) : (
            <CheckCircle aria-hidden="true" />
          )}
          Peak boost {formatDb(room.peak)}
          {room.risky &&
            room.trim !== null &&
            ` · trim to ${formatDb(room.trim)} to stay clear of clipping`}
        </span>
      </div>
      <Caption className="text-xs">
        Does not change presets, recordings or reamp results.
      </Caption>
    </section>
  );
}
