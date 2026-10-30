import { useRef, useState } from 'react';
import type { GuitarProfiles } from './api';
import { Button } from './components/ui/button';
import './MasterLevel.css';
import { useMonitorReadings } from './monitorFeed';
import { ToolRow, ToolSection } from './ToolRow';
import { trimFor, useGuitars } from './useGuitars';

const LISTEN_MS = 6000;
const SILENT_DB = -60;

const db = (n: number) =>
  `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toFixed(1)} dB`;

/**
 * Guitar profiles: measure each guitar's loudest strum once, then switching
 * guitars evens out pickup output before the rig. Unit-wide, never in presets.
 * @see docs/audio.md
 */
export function GuitarSettings() {
  const { profiles, error, busy, save } = useGuitars();
  const [name, setName] = useState('');
  const [listening, setListening] = useState<{
    id: string;
    until: number;
    peak: number;
  } | null>(null);
  const [note, setNote] = useState('');
  const current = useRef(listening);
  function listen(next: typeof listening) {
    current.current = next;
    setListening(next);
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
    if (!feed.snapshot?.audio || peak <= SILENT_DB) {
      setNote(
        'No guitar heard. Start audio, turn the guitar up and strum hard.',
      );
      return;
    }
    // Leave headroom warnings to the player: near 0 dBFS the interface clips.
    setNote(
      peak > -1
        ? 'Measured, but the input is close to clipping: turn the interface gain down a little and measure again.'
        : '',
    );
    void save({
      ...profiles,
      guitars: profiles.guitars.map((g) =>
        g.id === run.id ? { ...g, peak_dbfs: Math.round(peak * 10) / 10 } : g,
      ),
      reference: profiles.reference ?? run.id,
    });
  });

  if (profiles === 'unsupported') return null;
  if (profiles == null) return error ? <p role="alert">{error}</p> : null;
  const edit = (next: Partial<GuitarProfiles>) =>
    void save({ ...profiles, ...next });
  return (
    <ToolSection
      title="Guitars"
      scope="This unit · kept across presets, not saved in them"
      label="Guitar profiles"
    >
      <p className="caption">
        Measure each guitar once with its volume knob fully up and your loudest
        stage strum. Switching guitars then brings each one to the level of your
        reference guitar, so presets sound the same on all of them. Set the
        interface gain once for your hottest guitar and leave it.
      </p>
      {profiles.guitars.map((g) => {
        const active = profiles.active === g.id;
        const reference = profiles.reference === g.id;
        const trim = trimFor({ ...profiles, active: g.id });
        return (
          <ToolRow
            key={g.id}
            title={g.name}
            value={
              listening?.id === g.id
                ? 'Strum hard…'
                : g.peak_dbfs == null
                  ? 'Not measured'
                  : reference
                    ? 'Reference'
                    : `Trim ${db(trim)}`
            }
            detail={
              g.peak_dbfs == null
                ? 'Plays untrimmed until measured.'
                : `Loudest strum ${g.peak_dbfs.toFixed(1)} dBFS.`
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
              disabled={busy || !!listening}
              onClick={() => {
                setNote('');
                listen({
                  id: g.id,
                  until: performance.now() + LISTEN_MS,
                  peak: -120,
                });
              }}
            >
              Measure
            </Button>
            <Button
              variant="ghost"
              aria-pressed={reference}
              disabled={busy || g.peak_dbfs == null}
              onClick={() => edit({ reference: g.id })}
            >
              Reference
            </Button>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() =>
                edit({
                  guitars: profiles.guitars.filter((x) => x.id !== g.id),
                  active: active ? null : profiles.active,
                  reference: reference ? null : profiles.reference,
                })
              }
            >
              Remove
            </Button>
          </ToolRow>
        );
      })}
      {note && <p role="status">{note}</p>}
      <ToolRow
        title="Character"
        value={`${Math.round(profiles.character * 100)}%`}
        detail="0% matches every guitar exactly. Higher keeps more of each guitar's own output, so a hot guitar still drives the amp harder."
      >
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          aria-label="Guitar character"
          className="ink-range ink-range-wide"
          style={{ '--level': profiles.character } as React.CSSProperties}
          value={Math.round(profiles.character * 100)}
          disabled={busy}
          onChange={(e) => edit({ character: Number(e.target.value) / 100 })}
        />
      </ToolRow>
      {profiles.guitars.length < 16 && (
        <form
          className="action-row"
          onSubmit={(e) => {
            e.preventDefault();
            const trimmed = name.trim().slice(0, 40);
            if (!trimmed) return;
            const id = `${
              trimmed
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, '-')
                .replace(/^-|-$/g, '') || 'guitar'
            }-${crypto.randomUUID().slice(0, 8)}`;
            setName('');
            edit({
              guitars: [
                ...profiles.guitars,
                { id, name: trimmed, peak_dbfs: null },
              ],
              active: profiles.active ?? id,
            });
          }}
        >
          <input
            aria-label="New guitar name"
            placeholder="Guitar name"
            maxLength={40}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Button
            type="submit"
            variant="outline"
            disabled={busy || !name.trim()}
          >
            Add guitar
          </Button>
        </form>
      )}
      {error && <p role="alert">{error}</p>}
    </ToolSection>
  );
}

/** One tap to switch guitars on stage. Hidden until two guitars exist. */
export function GuitarSwitch() {
  const { profiles, busy, save } = useGuitars();
  if (
    profiles == null ||
    profiles === 'unsupported' ||
    profiles.guitars.length < 2
  )
    return null;
  return (
    <div className="perform-section">
      <h3>Guitar</h3>
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
