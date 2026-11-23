import { Guitar as GuitarIcon, Minus, Plus } from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';

import { Badge } from '@oxidal/design-system/components/badge';
import { Button } from '@oxidal/design-system/components/button';
import {
  Card,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@oxidal/design-system/components/card';
import { DialogFooter } from '@oxidal/design-system/components/dialog';
import {
  ActionRow,
  FormField,
  FormGrid,
} from '@oxidal/design-system/components/form-layout';
import { ListRow } from '@oxidal/design-system/components/list-row';
import { NumberField } from '@oxidal/design-system/components/number-field';
import { Slider } from '@oxidal/design-system/components/slider';
import { StateNotice } from '@oxidal/design-system/components/states';
import { Caption } from '@oxidal/design-system/components/text';
import { GuitarWorkspace } from '@oxidal/design-system/patterns/guitar-workspace';
import { Meter } from '@oxidal/design-system/widgets/meter';

import { AdjustmentDialog } from './AdjustmentDialog';
import { boosts, type GuitarProfiles } from './api';
import { CaptureListening } from './CaptureListening';
import { guitarVerificationDetail } from './guitarVerification';
import { useMonitorReadings } from './monitorFeed';
import { gateFor, useGuitars } from './useGuitars';

type Guitar = GuitarProfiles['guitars'][number];

const LISTEN_MS = 6000;
const SILENT_DB = -60;
/** Muted strings louder than this are playing, not hiss. */
const NOISE_CEILING_DB = -30;
const TRIM = { min: -24, max: 24, step: 0.5 };

const db = (n: number) =>
  `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toFixed(1)} dB`;
const dbfs = (n: number) =>
  `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toFixed(1)} dBFS`;
const clampTrim = (n: number) =>
  Math.min(TRIM.max, Math.max(TRIM.min, Math.round(n * 2) / 2));

function GuitarTrimField({
  value,
  busy,
  save,
}: {
  value: number;
  busy: boolean;
  save: (value: number) => void;
}) {
  const drag = useRef<number | null>(null);
  const [preview, setPreview] = useState<number | null>(null);
  return (
    <NumberField
      label="Input trim"
      unit="dB"
      value={preview ?? value}
      min={-24}
      max={24}
      step={0.5}
      fine={0.5}
      disabled={busy}
      onDragStart={() => {
        drag.current = value;
      }}
      onChange={(next) => {
        if (drag.current === null) save(next);
        else {
          drag.current = next;
          setPreview(next);
        }
      }}
      onDragEnd={(cancelled) => {
        const next = drag.current;
        drag.current = null;
        setPreview(null);
        if (!cancelled && next != null && next !== value) save(next);
      }}
    />
  );
}

/**
 * Guitar profiles: a trim per guitar so every guitar reaches the rig at the
 * same level, and a noise gate set just above its own hiss. The trim is a plain
 * number; Measure strum only suggests it. Unit-wide, never in presets.
 * @see docs/audio.md
 */
export function GuitarSettings() {
  const { profiles, error, busy, save } = useGuitars();
  const [naming, setNaming] = useState<{
    id: string | null;
    value: string;
  } | null>(null);
  const [managing, setManaging] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  // One guitar's trim or gate dialog.
  const [editing, setEditing] = useState<{
    id: string;
    kind: 'trim' | 'gate';
  } | null>(null);
  const [listening, setListening] = useState<{
    id: string;
    kind: 'strum' | 'noise';
    until: number;
    peak: number | null;
  } | null>(null);
  const [input, setInput] = useState<{ ready: boolean; level: number | null }>({
    ready: false,
    level: null,
  });
  const [note, setNote] = useState('');
  const current = useRef(listening);
  function listen(next: typeof listening) {
    current.current = next;
    setListening(next);
  }
  function start(id: string, kind: 'strum' | 'noise') {
    setNote('');
    listen({ id, kind, until: performance.now() + LISTEN_MS, peak: null });
  }

  useMonitorReadings(1000, (feed) => {
    const snapshot = feed.snapshot;
    const channels = snapshot?.audio?.input ?? [];
    const ready =
      !feed.disconnected &&
      snapshot?.audio_age_ms != null &&
      snapshot.audio_age_ms < 3000 &&
      channels.length > 0;
    const peaks = channels.flatMap(({ peak_dbfs }) =>
      peak_dbfs != null && Number.isFinite(peak_dbfs) ? [peak_dbfs] : [],
    );
    const level = ready && peaks.length ? Math.max(...peaks) : null;
    setInput({ ready, level });
    const run = current.current;
    if (!run || profiles == null || profiles === 'unsupported') return;
    if (!ready) {
      listen(null);
      setNote('Input readings stopped. Start audio and measure again.');
      return;
    }
    const peak = level == null ? run.peak : Math.max(run.peak ?? level, level);
    if (performance.now() < run.until) {
      if (peak !== run.peak) listen({ ...run, peak });
      return;
    }
    listen(null);
    if (peak == null) {
      setNote(
        run.kind === 'noise'
          ? 'No input level measured. Check the guitar input and measure again.'
          : 'No guitar heard. Start audio, turn the guitar up and strum hard.',
      );
      return;
    }
    const measured = Math.round(peak * 10) / 10;
    const update = (change: Partial<Guitar>, next?: Partial<GuitarProfiles>) =>
      void save({
        ...profiles,
        ...next,
        guitars: profiles.guitars.map((g) =>
          g.id === run.id ? { ...g, ...change } : g,
        ),
      });
    if (run.kind === 'noise') {
      if (peak > NOISE_CEILING_DB) {
        setNote(
          'That was louder than hiss. Mute the strings with your hand, keep the volume up and measure again.',
        );
        return;
      }
      setNote('');
      update({ noise_dbfs: measured, gate: true });
      return;
    }
    if (peak <= SILENT_DB) {
      setNote(
        'No guitar heard. Start audio, turn the guitar up and strum hard.',
      );
      return;
    }
    const reference = profiles.guitars.find(
      (g) => g.id === profiles.reference && g.id !== run.id,
    );
    const clip =
      peak > -1
        ? ' The input is close to clipping: turn the interface gain down a little.'
        : '';
    if (reference?.peak_dbfs == null) {
      // The first guitar measured sets the level the others match.
      setNote(
        `Measured. Other guitars you measure will match this one.${clip}`,
      );
      update({ peak_dbfs: measured }, { reference: run.id });
      return;
    }
    const trim = clampTrim(
      reference.peak_dbfs + (reference.trim_db ?? 0) - peak,
    );
    setNote(`Matched to ${reference.name}: trim ${db(trim)}.${clip}`);
    update({ peak_dbfs: measured, trim_db: trim });
  });

  if (profiles === 'unsupported') return null;
  if (profiles == null)
    return error ? (
      <StateNotice kind="error" title="Guitar profiles unavailable">
        {error}
      </StateNotice>
    ) : null;
  const edit = (next: Partial<GuitarProfiles>) =>
    void save({ ...profiles, ...next });
  const change = (id: string, next: Partial<Guitar>) =>
    edit({
      guitars: profiles.guitars.map((g) =>
        g.id === id ? { ...g, ...next } : g,
      ),
    });
  const open = profiles.guitars.find((g) => g.id === editing?.id);
  const openTrim = open?.trim_db ?? 0;
  const active = profiles.guitars.find(
    (guitar) => guitar.id === profiles.active,
  );
  return (
    <GuitarWorkspace
      guitars={profiles.guitars.map((g) => ({
        ...g,
        caption: profiles.reference === g.id ? 'Level reference' : undefined,
      }))}
      active={profiles.active}
      caption={active ? 'Selected for this rig' : undefined}
      onSelect={busy ? undefined : (id) => edit({ active: id })}
      onAdd={
        !busy && profiles.guitars.length < 16
          ? () => setNaming({ id: null, value: '' })
          : undefined
      }
      trimControl={
        active && (
          <GuitarTrimField
            key={active.id}
            value={active.trim_db ?? 0}
            busy={busy}
            save={(value) => change(active.id, { trim_db: value })}
          />
        )
      }
    >
      <Card>
        <CardHeader>
          <CardTitle>Input level</CardTitle>
        </CardHeader>
        <Meter
          label="Input"
          value={input.level}
          state={input.level == null ? 'unavailable' : 'live'}
          size="lg"
        />
        {active && (
          <CardFooter>
            <Button
              disabled={busy || !!listening || !input.ready}
              onClick={() => {
                setEditing({ id: active.id, kind: 'trim' });
                start(active.id, 'strum');
              }}
            >
              Start sound check
            </Button>
          </CardFooter>
        )}
      </Card>
      <Card aria-label="Guitar profiles">
        <CardHeader>
          <CardTitle>Calibration</CardTitle>
          <span className="text-sm text-muted-foreground">
            This unit · kept across presets, not saved in them
          </span>
        </CardHeader>
        <Caption>
          Choose the guitar you are holding. Its trim and gate apply immediately
          to every rig, and Levels follows the selected profile automatically —
          there is no separate Levels run. Remeasure only after changing the
          guitar&apos;s output or the interface input/gain.
        </Caption>
        {profiles.guitars.map((g) => {
          const active = profiles.active === g.id;
          const gate = gateFor({ ...profiles, active: g.id });
          const strum =
            g.peak_dbfs == null
              ? 'Strum not measured.'
              : `Measured strum ${dbfs(g.peak_dbfs)}.`;
          const noise =
            g.noise_dbfs == null
              ? 'Noise not measured.'
              : gate == null
                ? `Noise ${dbfs(g.noise_dbfs)} · gate off.`
                : `Noise ${dbfs(g.noise_dbfs)} · gate opens at ${dbfs(gate)}.`;
          return (
            <ListRow key={g.id} title={g.name} className="gap-y-2">
              <div className="col-span-full flex flex-wrap items-center gap-2">
                {active && <Badge tone="live">Playing</Badge>}
                {profiles.reference === g.id && <Badge>Level reference</Badge>}
                <span className="font-mono text-sm whitespace-nowrap tabular-nums">
                  Trim {db(g.trim_db ?? 0)}
                </span>
              </div>
              <p className="col-span-full text-sm text-muted-foreground">
                {strum} {noise} {guitarVerificationDetail(g)}
              </p>
              <div className="col-span-full flex flex-wrap items-center gap-2">
                {!active && (
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => edit({ active: g.id })}
                  >
                    Use guitar
                  </Button>
                )}
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => setEditing({ id: g.id, kind: 'trim' })}
                >
                  Trim
                </Button>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => setEditing({ id: g.id, kind: 'gate' })}
                >
                  Gate
                </Button>
                <Button
                  variant="outline"
                  disabled={busy}
                  aria-label={`Manage ${g.name}`}
                  onClick={() => setManaging(g.id)}
                >
                  Manage
                </Button>
              </div>
            </ListRow>
          );
        })}
        {note && !editing && <p role="status">{note}</p>}
        {open && editing?.kind === 'trim' && (
          <AdjustmentDialog
            title={`${open.name} trim`}
            onCancel={() => setEditing(null)}
          >
            <div className="grid min-w-0 items-start gap-3 [&>button]:max-w-full [&>button]:justify-self-start">
              <div className="flex items-center justify-center gap-4">
                <Button
                  variant="outline"
                  size="icon"
                  aria-label="Trim down 0.5 dB"
                  disabled={busy || openTrim <= TRIM.min}
                  onClick={() =>
                    change(open.id, {
                      trim_db: clampTrim(openTrim - TRIM.step),
                    })
                  }
                >
                  <Minus aria-hidden="true" />
                </Button>
                <output
                  className="min-w-[6ch] text-center font-mono text-xl font-semibold tabular-nums"
                  aria-live="polite"
                >
                  {db(openTrim)}
                </output>
                <Button
                  variant="outline"
                  size="icon"
                  aria-label="Trim up 0.5 dB"
                  disabled={busy || openTrim >= TRIM.max}
                  onClick={() =>
                    change(open.id, {
                      trim_db: clampTrim(openTrim + TRIM.step),
                    })
                  }
                >
                  <Plus aria-hidden="true" />
                </Button>
              </div>
              <Slider
                label={`${open.name} trim`}
                min={TRIM.min}
                max={TRIM.max}
                step={TRIM.step}
                value={[openTrim]}
                aria-valuetext={db(openTrim)}
                disabled={busy}
                onValueChange={([trim]) =>
                  change(open.id, { trim_db: clampTrim(trim!) })
                }
              />
              <Caption>
                {profiles.active === open.id
                  ? 'Changes apply as you play.'
                  : 'Choose Play this to hear changes.'}{' '}
                Quieter pickups need more trim; hotter ones less.
              </Caption>
              <ActionRow>
                <Button
                  variant="outline"
                  disabled={busy || !!listening || !input.ready}
                  onClick={() => start(open.id, 'strum')}
                >
                  {listening?.id === open.id && listening.kind === 'strum'
                    ? 'Strum hard…'
                    : 'Measure strum'}
                </Button>
                <Button
                  variant="ghost"
                  disabled={busy || openTrim === 0}
                  onClick={() => change(open.id, { trim_db: 0 })}
                >
                  Reset to 0 dB
                </Button>
              </ActionRow>
              <Caption>
                Measure strum: volume fully up, six seconds of your loudest
                stage strum. It matches this guitar to the first one you
                measured.
              </Caption>
              {note && <p role="status">{note}</p>}
            </div>
          </AdjustmentDialog>
        )}
        {open && editing?.kind === 'gate' && (
          <AdjustmentDialog
            title={`${open.name} gate`}
            onCancel={() => setEditing(null)}
          >
            <div className="grid min-w-0 items-start gap-3 [&>button]:max-w-full [&>button]:justify-self-start">
              <p role="status">
                {open.noise_dbfs == null
                  ? 'Not set up: measure the noise first.'
                  : `Noise ${open.noise_dbfs.toFixed(1)} dBFS · gate ${
                      open.gate
                        ? `opens at ${gateFor({ ...profiles, active: open.id })} dBFS`
                        : 'off'
                    }`}
              </p>
              <ActionRow>
                <Button
                  variant="outline"
                  disabled={busy || !!listening || !input.ready}
                  onClick={() => start(open.id, 'noise')}
                >
                  {listening?.id === open.id && listening.kind === 'noise'
                    ? 'Strings muted…'
                    : 'Measure noise'}
                </Button>
                <Button
                  variant="outline"
                  aria-pressed={!!open.gate && open.noise_dbfs != null}
                  disabled={busy || open.noise_dbfs == null}
                  onClick={() => change(open.id, { gate: !open.gate })}
                >
                  {open.gate ? 'Gate on' : 'Gate off'}
                </Button>
              </ActionRow>
              <Caption>
                Volume up, strings muted by your hand, on the noisiest pickup
                (usually a single coil). The gate then opens 6 dB above that
                hiss and stays quiet in every position.
              </Caption>
              {note && <p role="status">{note}</p>}
            </div>
          </AdjustmentDialog>
        )}
        {naming && (
          <AdjustmentDialog
            title={naming.id ? 'Rename guitar' : 'Add guitar'}
            onCancel={() => setNaming(null)}
          >
            <FormGrid
              as="form"

              onSubmit={(e) => {
                e.preventDefault();
                const trimmed = naming.value.trim().slice(0, 40);
                if (!trimmed) return;
                if (naming.id) {
                  change(naming.id, { name: trimmed });
                } else {
                  const id = `${
                    trimmed
                      .toLowerCase()
                      .replace(/[^a-z0-9]+/g, '-')
                      .replace(/^-|-$/g, '') || 'guitar'
                  }-${crypto.randomUUID().slice(0, 8)}`;
                  edit({
                    guitars: [
                      ...profiles.guitars,
                      { id, name: trimmed, trim_db: 0, peak_dbfs: null },
                    ],
                    active: profiles.active ?? id,
                  });
                }
                setNaming(null);
              }}
            >
              <FormField>
                Name
                <input
                  autoFocus
                  maxLength={40}
                  placeholder="For example: Ibanez Jiva or Jericho · neck"
                  value={naming.value}
                  onChange={(e) =>
                    setNaming({ ...naming, value: e.target.value })
                  }
                />
              </FormField>
              <Button type="submit" disabled={busy || !naming.value.trim()}>
                {naming.id ? 'Rename' : 'Add guitar'}
              </Button>
            </FormGrid>
          </AdjustmentDialog>
        )}
        {managing &&
          (() => {
            const guitar = profiles.guitars.find((g) => g.id === managing);
            if (!guitar) return null;
            return (
              <AdjustmentDialog
                title={guitar.name}
                onCancel={() => setManaging(null)}
              >
                <div className="grid min-w-0 items-start gap-3 [&>button]:max-w-full [&>button]:justify-self-start">
                  <Caption>
                    Profile management does not change any presets.
                  </Caption>
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => {
                      setManaging(null);
                      setNaming({ id: guitar.id, value: guitar.name });
                    }}
                  >
                    Rename guitar
                  </Button>
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => {
                      setManaging(null);
                      setRemoving(guitar.id);
                    }}
                  >
                    Remove profile…
                  </Button>
                </div>
              </AdjustmentDialog>
            );
          })()}
        {removing &&
          (() => {
            const guitar = profiles.guitars.find((g) => g.id === removing);
            if (!guitar) return null;
            const isActive = profiles.active === guitar.id;
            const isReference = profiles.reference === guitar.id;
            return (
              <AdjustmentDialog
                title={`Remove ${guitar.name}?`}
                onCancel={() => setRemoving(null)}
              >
                <div className="grid min-w-0 items-start gap-3 [&>button]:max-w-full [&>button]:justify-self-start">
                  <p>
                    This removes its trim, strum and noise measurements from
                    this unit. Presets and other guitar profiles are not
                    changed.
                  </p>
                  {(isActive || isReference) && (
                    <Caption>
                      {isActive
                        ? 'The next guitar will become the selected profile. '
                        : ''}
                      {isReference
                        ? 'The next measured guitar will become the level reference.'
                        : ''}
                    </Caption>
                  )}
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setRemoving(null)}>
                      Keep guitar
                    </Button>
                    <Button
                      variant="destructive"
                      disabled={busy}
                      onClick={() => {
                        const remaining = profiles.guitars.filter(
                          (item) => item.id !== guitar.id,
                        );
                        edit({
                          guitars: remaining,
                          active: isActive
                            ? (remaining[0]?.id ?? null)
                            : profiles.active,
                          reference: isReference ? null : profiles.reference,
                        });
                        setRemoving(null);
                      }}
                    >
                      Remove guitar
                    </Button>
                  </DialogFooter>
                </div>
              </AdjustmentDialog>
            );
          })()}
      </Card>
      <CaptureListening
        appliedTrim={
          profiles.guitars.find((guitar) => guitar.id === profiles.active)
            ?.trim_db ?? null
        }
      />
      {error && (
        <StateNotice kind="error" title="Guitar profile action failed">
          {error}
        </StateNotice>
      )}
    </GuitarWorkspace>
  );
}

/** One tap to switch guitars on stage. Hidden until two guitars exist. */
/**
 * One tap per instrument. Compact sits beside the preset name, taking no row;
 * the default is a section of its own.
 */
export function GuitarSwitch({
  layout = 'section',
}: {
  layout?: 'section' | 'compact';
}) {
  const { profiles, busy, save } = useGuitars();
  if (
    profiles == null ||
    profiles === 'unsupported' ||
    profiles.guitars.length < 2
  )
    return null;
  const buttons = profiles.guitars.map((g) => (
    <Button
      key={g.id}
      variant={profiles.active === g.id ? 'default' : 'outline'}
      aria-pressed={profiles.active === g.id}
      disabled={busy}
      onClick={() => void save({ ...profiles, active: g.id })}
    >
      {g.name}
    </Button>
  ));
  return (
    <div
      className={
        layout === 'compact'
          ? 'flex min-w-0 flex-wrap items-center justify-center gap-2'
          : 'grid min-w-0 gap-2'
      }
    >
      {layout === 'compact' ? (
        <span className="text-xs font-semibold small-caps text-muted-foreground">
          Guitar
        </span>
      ) : (
        <h3>Guitar</h3>
      )}
      <div
        className="flex min-w-0 flex-wrap items-center gap-1"
        role="group"
        aria-label="Guitar"
      >
        {buttons}
      </div>
    </div>
  );
}

/**
 * The guitar in use, as a button beside Level; it opens the choice. Rig view
 * has no room for a row of guitars, and the choice rarely changes mid-song.
 */
export function GuitarPicker() {
  const { profiles, busy, save } = useGuitars();
  const [open, setOpen] = useState(false);
  // The preset playing when the choice opened: it can remember a guitar.
  const [preset, setPreset] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    const abort = new AbortController();
    boosts(undefined, abort.signal)
      .then((state) => setPreset(state?.playing[0] ?? null))
      .catch(() => setPreset(null));
    return () => abort.abort();
  }, [open]);
  if (
    profiles == null ||
    profiles === 'unsupported' ||
    profiles.guitars.length < 2
  )
    return null;
  const active =
    profiles.guitars.find((g) => g.id === profiles.active) ??
    profiles.guitars[0]!;
  return (
    <>
      <Button
        variant="outline"
        aria-label={`Guitar: ${active.name}`}
        aria-haspopup="dialog"
        title="Choose the guitar being played"
        onClick={() => setOpen(true)}
      >
        <GuitarIcon aria-hidden="true" />
        <span className="phone-hidden">{active.name}</span>
      </Button>
      {open && (
        <AdjustmentDialog title="Guitar" onCancel={() => setOpen(false)}>
          <div className="grid divide-y divide-border [&>button]:h-auto [&>button]:justify-start [&>button]:rounded-none [&>button]:py-2.5 [&>button]:text-left [&>button]:whitespace-normal">
            {profiles.guitars.map((g) => (
              <Button
                variant="ghost"
                key={g.id}
                type="button"
                aria-pressed={profiles.active === g.id}
                disabled={busy}
                onClick={() => {
                  setOpen(false);
                  void save({ ...profiles, active: g.id });
                }}
              >
                {g.name}
                {profiles.active === g.id && (
                  <Caption as="span">Playing</Caption>
                )}
              </Button>
            ))}
          </div>
          {preset &&
            (() => {
              const kept = profiles.guitars.find(
                (g) => g.id === profiles.presets?.[preset],
              );
              const rest = Object.fromEntries(
                Object.entries(profiles.presets ?? {}).filter(
                  ([key]) => key !== preset,
                ),
              );
              return kept ? (
                <ActionRow>
                  <Caption>
                    This preset switches to {kept.name} when it starts.
                  </Caption>
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => void save({ ...profiles, presets: rest })}
                  >
                    Forget
                  </Button>
                </ActionRow>
              ) : (
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    void save({
                      ...profiles,
                      presets: { ...rest, [preset]: active.id },
                    })
                  }
                >
                  Always use {active.name} for this preset
                </Button>
              );
            })()}
        </AdjustmentDialog>
      )}
    </>
  );
}
