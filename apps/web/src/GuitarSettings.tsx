import { useRef, useState } from 'react';
import { StateNotice } from './components/ui/state-notice';
import type { GuitarProfiles } from './api';
import { Guitar as GuitarIcon, Minus, Plus } from '@phosphor-icons/react';
import { AdjustmentDialog } from './AdjustmentDialog';
import { Button } from './components/ui/button';
import { Badge } from './components/ui/badge';
import { DialogFooter } from './components/ui/dialog';
import './MasterLevel.css';
import './GuitarSettings.css';
import { useMonitorReadings } from './monitorFeed';
import { ToolRow, ToolSection } from './ToolRow';
import { gateFor, useGuitars } from './useGuitars';
import { guitarVerificationDetail } from './guitarVerification';

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
  return (
    <ToolSection
      title="Profiles"
      scope="This unit · kept across presets, not saved in them"
      label="Guitar profiles"
      className="guitar-profiles"
    >
      <p className="caption">
        Choose the guitar you are holding. Its trim and gate apply immediately
        to every rig, and Sound Check follows the selected profile automatically
        — there is no separate Sound Check run. Remeasure only after changing
        the guitar&apos;s output or the interface input/gain.
      </p>
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
          <ToolRow
            key={g.id}
            title={g.name}
            value={
              <span className="guitar-profile-value">
                {active && <Badge data-state="playing">Playing</Badge>}
                {profiles.reference === g.id && <Badge>Level reference</Badge>}
                <span>Trim {db(g.trim_db ?? 0)}</span>
              </span>
            }
            detail={`${strum} ${noise} ${guitarVerificationDetail(g)}`}
          >
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
              variant="ghost"
              disabled={busy}
              aria-label={`Manage ${g.name}`}
              onClick={() => setManaging(g.id)}
            >
              Manage
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
      {managing &&
        (() => {
          const guitar = profiles.guitars.find((g) => g.id === managing);
          if (!guitar) return null;
          return (
            <AdjustmentDialog
              title={guitar.name}
              onCancel={() => setManaging(null)}
            >
              <div className="control-stack">
                <p className="caption">
                  Profile management does not change any presets.
                </p>
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
              <div className="control-stack">
                <p>
                  This removes its trim, strum and noise measurements from this
                  unit. Presets and other guitar profiles are not changed.
                </p>
                {(isActive || isReference) && (
                  <p className="caption">
                    {isActive
                      ? 'The next guitar will become the selected profile. '
                      : ''}
                    {isReference
                      ? 'The next measured guitar will become the level reference.'
                      : ''}
                  </p>
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
      {error && (
        <StateNotice kind="error" title="Guitar profile action failed">
          {error}
        </StateNotice>
      )}
    </ToolSection>
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
      variant="outline"
      aria-pressed={profiles.active === g.id}
      disabled={busy}
      onClick={() => void save({ ...profiles, active: g.id })}
    >
      {g.name}
    </Button>
  ));
  return (
    <div
      className={layout === 'compact' ? 'perform-guitar' : 'perform-section'}
    >
      {layout === 'compact' ? (
        <span className="perform-guitar-label">Guitar</span>
      ) : (
        <h3>Guitar</h3>
      )}
      <div className="perform-guitars" role="group" aria-label="Guitar">
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
          <div className="menu-list">
            {profiles.guitars.map((g) => (
              <button
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
                  <span className="caption">Playing</span>
                )}
              </button>
            ))}
          </div>
        </AdjustmentDialog>
      )}
    </>
  );
}
