import { useRef, useState } from 'react';
import type { GuitarProfiles } from './api';
import { Minus, Plus } from '@phosphor-icons/react';
import { AdjustmentDialog } from './AdjustmentDialog';
import { Button } from './components/ui/button';
import './MasterLevel.css';
import { useMonitorReadings } from './monitorFeed';
import { ToolRow, ToolSection } from './ToolRow';
import { gateFor, useGuitars } from './useGuitars';

type Guitar = GuitarProfiles['guitars'][number];

const LISTEN_MS = 6000;
const SILENT_DB = -60;
/** Muted strings louder than this are playing, not hiss. */
const NOISE_CEILING_DB = -30;
const TRIM = { min: -24, max: 24, step: 0.5 };

const db = (n: number) =>
  `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toFixed(1)} dB`;
const clampTrim = (n: number) =>
  Math.min(TRIM.max, Math.max(TRIM.min, Math.round(n * 2) / 2));

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
  // One guitar's trim or gate dialog.
  const [editing, setEditing] = useState<{
    id: string;
    kind: 'trim' | 'gate';
  } | null>(null);
  const [listening, setListening] = useState<{
    id: string;
    kind: 'strum' | 'noise';
    until: number;
    peak: number;
  } | null>(null);
  const [note, setNote] = useState('');
  const current = useRef(listening);
  function listen(next: typeof listening) {
    current.current = next;
    setListening(next);
  }
  function start(id: string, kind: 'strum' | 'noise') {
    setNote('');
    listen({ id, kind, until: performance.now() + LISTEN_MS, peak: -120 });
  }

  useMonitorReadings(1000, (feed) => {
    const run = current.current;
    if (!run || profiles == null || profiles === 'unsupported') return;
    const input = feed.snapshot?.audio?.input ?? [];
    const peak = Math.max(run.peak, ...input.map((c) => c.peak_dbfs ?? -120));
    if (performance.now() < run.until) {
      if (peak !== run.peak) listen({ ...run, peak });
      return;
    }
    listen(null);
    const measured = Math.round(peak * 10) / 10;
    const update = (change: Partial<Guitar>, next?: Partial<GuitarProfiles>) =>
      void save({
        ...profiles,
        ...next,
        guitars: profiles.guitars.map((g) =>
          g.id === run.id ? { ...g, ...change } : g,
        ),
      });
    if (!feed.snapshot?.audio) {
      setNote('No input. Start audio and measure again.');
      return;
    }
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
  if (profiles == null) return error ? <p role="alert">{error}</p> : null;
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
  return (
    <ToolSection
      title="Profiles"
      scope="This unit · kept across presets, not saved in them"
      label="Guitar profiles"
    >
      <p className="caption">
        Give each guitar a trim so they all hit your presets at the same level:
        a guitar with quieter pickups gets a few dB more. Set it by ear, or let
        Measure strum match it to your first guitar. The gate opens just above
        each guitar&apos;s own hiss.
      </p>
      {profiles.guitars.map((g) => {
        const active = profiles.active === g.id;
        const gate = gateFor({ ...profiles, active: g.id });
        return (
          <ToolRow
            key={g.id}
            title={g.name}
            value={`Trim ${db(g.trim_db ?? 0)}`}
            detail={
              g.noise_dbfs == null
                ? 'Gate not set up.'
                : gate == null
                  ? 'Gate off.'
                  : `Gate opens at ${gate} dBFS.`
            }
          >
            <Button
              variant="outline"
              aria-pressed={active}
              disabled={busy}
              onClick={() => edit({ active: active ? null : g.id })}
            >
              {active ? 'Playing' : 'Play this'}
            </Button>
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
              variant="ghost"
              disabled={busy}
              onClick={() => setNaming({ id: g.id, value: g.name })}
            >
              Rename
            </Button>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() =>
                edit({
                  guitars: profiles.guitars.filter((x) => x.id !== g.id),
                  active: active ? null : profiles.active,
                  reference:
                    profiles.reference === g.id ? null : profiles.reference,
                })
              }
            >
              Remove
            </Button>
          </ToolRow>
        );
      })}
      {note && !editing && <p role="status">{note}</p>}
      {profiles.guitars.length < 16 && (
        <div className="action-row">
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => setNaming({ id: null, value: '' })}
          >
            <Plus aria-hidden="true" />
            Add guitar
          </Button>
        </div>
      )}
      {open && editing?.kind === 'trim' && (
        <AdjustmentDialog
          title={`${open.name} trim`}
          onCancel={() => setEditing(null)}
        >
          <div className="control-stack">
            <div className="guitar-trim">
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
              <output aria-live="polite">{db(openTrim)}</output>
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
            <input
              type="range"
              min={TRIM.min}
              max={TRIM.max}
              step={TRIM.step}
              aria-label={`${open.name} trim`}
              className="ink-range ink-range-wide"
              style={
                {
                  '--level': (openTrim - TRIM.min) / (TRIM.max - TRIM.min),
                } as React.CSSProperties
              }
              value={openTrim}
              disabled={busy}
              onChange={(e) =>
                change(open.id, { trim_db: clampTrim(Number(e.target.value)) })
              }
            />
            <p className="caption">
              {profiles.active === open.id
                ? 'Changes apply as you play.'
                : 'Choose Play this to hear changes.'}{' '}
              Quieter pickups need more trim; hotter ones less.
            </p>
            <div className="action-row">
              <Button
                variant="outline"
                disabled={busy || !!listening}
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
            </div>
            <p className="caption">
              Measure strum: volume fully up, six seconds of your loudest stage
              strum. It matches this guitar to the first one you measured.
            </p>
            {note && <p role="status">{note}</p>}
          </div>
        </AdjustmentDialog>
      )}
      {open && editing?.kind === 'gate' && (
        <AdjustmentDialog
          title={`${open.name} gate`}
          onCancel={() => setEditing(null)}
        >
          <div className="control-stack">
            <p role="status">
              {open.noise_dbfs == null
                ? 'Not set up: measure the noise first.'
                : `Noise ${open.noise_dbfs.toFixed(1)} dBFS · gate ${
                    open.gate
                      ? `opens at ${gateFor({ ...profiles, active: open.id })} dBFS`
                      : 'off'
                  }`}
            </p>
            <div className="action-row">
              <Button
                variant="outline"
                disabled={busy || !!listening}
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
            </div>
            <p className="caption">
              Volume up, strings muted by your hand, on the noisiest pickup
              (usually a single coil). The gate then opens 6 dB above that hiss
              and stays quiet in every position.
            </p>
            {note && <p role="status">{note}</p>}
          </div>
        </AdjustmentDialog>
      )}
      {naming && (
        <AdjustmentDialog
          title={naming.id ? 'Rename guitar' : 'Add guitar'}
          onCancel={() => setNaming(null)}
        >
          <form
            className="form-grid"
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
            <label className="field">
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
            </label>
            <Button type="submit" disabled={busy || !naming.value.trim()}>
              {naming.id ? 'Rename' : 'Add guitar'}
            </Button>
          </form>
        </AdjustmentDialog>
      )}
      {error && <p role="alert">{error}</p>}
    </ToolSection>
  );
}

/** One tap to switch guitars on stage. Hidden until two guitars exist. */
/** One tap per instrument. Compact sits beside the preset name, taking no row. */
export function GuitarSwitch({ compact = false }: { compact?: boolean }) {
  const { profiles, busy, save } = useGuitars();
  if (
    profiles == null ||
    profiles === 'unsupported' ||
    profiles.guitars.length < 2
  )
    return null;
  return (
    <div className={compact ? 'perform-guitar' : 'perform-section'}>
      {compact ? (
        <span className="perform-guitar-label">Guitar</span>
      ) : (
        <h3>Guitar</h3>
      )}
      <div className="perform-guitars" role="group" aria-label="Guitar">
        {profiles.guitars.map((g) => (
          <Button
            key={g.id}
            variant="outline"
            aria-pressed={profiles.active === g.id}
            disabled={busy}
            onClick={() => void save({ ...profiles, active: g.id })}
          >
            {g.name}
          </Button>
        ))}
      </div>
    </div>
  );
}
