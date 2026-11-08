import {
  ArrowLeft,
  ArrowsClockwise,
  CaretLeft,
  CaretRight,
} from '@phosphor-icons/react';
import { useState } from 'react';
import { navigateMidi, type Monitoring } from './api';
import { friendlyError } from './lib/friendlyError';
import { GuitarSwitch } from './GuitarSettings';
import { MasterLevel } from './MasterLevel';
import { useMonitorReadings } from './monitorFeed';
import { setPerform, usePerform } from './performState';
import type { RigLaneVM } from './rigChain';
import './ChainView.css';
import './PerformView.css';

const FLOOR_DB = -60;
const HOLD_MS = 1500;
const NO_INPUT_MS = 3000;
// Rails appear while there is signal and fade this long after it stops.
const SHOW_MS = 2000;
const level = (db: number | null | undefined) =>
  db == null || !Number.isFinite(db)
    ? 0
    : Math.min(1, Math.max(0, (db - FLOOR_DB) / -FLOOR_DB));
type Channel = NonNullable<Monitoring['audio']>['input'][number];
type Held = { db: number; at: number }[];

/** Held peaks per channel; a hold decays after HOLD_MS. */
function hold(previous: Held, channels: Channel[] | undefined, now: number) {
  return (channels ?? []).map((c, i) => {
    const peak = c.peak_dbfs ?? FLOOR_DB;
    const old = previous[i];
    return !old || peak >= old.db || now - old.at > HOLD_MS
      ? { db: peak, at: now }
      : old;
  });
}

function EdgeMeter({
  side,
  channels,
  held,
  clipped,
  quiet,
  showing,
}: {
  showing: boolean;
  side: 'in' | 'out';
  channels: Channel[] | undefined;
  held: number[];
  clipped: boolean[];
  quiet: boolean;
}) {
  const label = side === 'in' ? 'Input' : 'Output';
  const top = held.length ? Math.max(...held) : null;
  return (
    <div
      className="edge-meter"
      data-side={side}
      data-showing={showing || undefined}
      role="meter"
      aria-label={`${label} level`}
      aria-valuemin={FLOOR_DB}
      aria-valuemax={0}
      aria-valuenow={top ?? FLOOR_DB}
      aria-valuetext={
        quiet
          ? 'No input'
          : top == null
            ? 'Unavailable'
            : `${top.toFixed(1)} dBFS peak`
      }
    >
      <div className="edge-meter-bars">
        {(channels ?? [null, null]).map((c, i) => (
          <span
            key={i}
            className="edge-meter-bar"
            data-clip={clipped[i] || undefined}
          >
            <i style={{ height: `${level(c?.peak_dbfs) * 100}%` }} />
            {held[i] != null && (
              <b style={{ bottom: `${level(held[i]) * 100}%` }} />
            )}
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * Live performance surface: input and output meters on the screen edges,
 * honest live stats, the playing preset, stomp bypass and preset pads.
 * Rails stay visible so a silent input reads as "No input", not as nothing.
 * @see docs/interface.md
 */
/**
 * Previous/Next through the Mine set-list. It runs the same daemon action as a
 * footswitch, so the ends and unready presets refuse with a reason and keep the
 * current sound playing.
 */
function PresetSteps({ disabled }: { disabled: boolean }) {
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState('');
  async function step(direction: 'previous' | 'next') {
    setBusy(true);
    setRefusal('');
    try {
      await navigateMidi(direction);
    } catch (cause) {
      setRefusal(friendlyError(cause, 'change preset'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="perform-steps">
      <div role="group" aria-label="Set list">
        <button
          type="button"
          disabled={disabled || busy}
          onClick={() => void step('previous')}
        >
          <CaretLeft aria-hidden="true" /> Previous
        </button>
        <button
          type="button"
          disabled={disabled || busy}
          onClick={() => void step('next')}
        >
          Next <CaretRight aria-hidden="true" />
        </button>
      </div>
      {refusal && <p role="alert">{refusal}</p>}
    </div>
  );
}

export function PerformView({
  now,
  lanes,
  disabled,
  switching = false,
  onToggle,
  onEdit,
  knobs,
  scenes,
  selector,
}: {
  /** What is playing: the surface is the same for every engine. */
  now: {
    session: string;
    playing: boolean;
    name?: string | null;
    modified: boolean;
  };
  lanes: RigLaneVM[];
  disabled: boolean;
  /** Keeps the live surface mounted while another preset is preparing. */
  switching?: boolean;
  onToggle: (blockId: string) => void;
  onEdit: () => void;
  /** Performance knob strip, rendered by the rig that owns the controls. */
  knobs?: React.ReactNode;
  /** Scene pads, for a preset with scenes. */
  scenes?: React.ReactNode;
  /** The preset pads, rendered by the rig that owns the library. */
  selector: React.ReactNode;
}) {
  const [live, setLive] = useState<{
    snapshot: Monitoring | null;
    link: number | null;
    inHeld: Held;
    outHeld: Held;
    silentSince: number | null;
    quiet: boolean;
    signalAt: number | null;
    showing: boolean;
  }>({
    snapshot: null,
    link: null,
    inHeld: [],
    outHeld: [],
    silentSince: null,
    quiet: false,
    signalAt: null,
    showing: false,
  });
  const { mode } = usePerform();
  const setMode = (next: 'play' | 'presets') => setPerform({ mode: next });
  const [baseline, setBaseline] = useState<{
    key: string;
    xruns: number;
    clips: number[];
  } | null>(null);
  const slow = document.documentElement.dataset.display === 'epaper';
  useMonitorReadings(slow ? 5000 : 1000, (feed) => {
    const next = feed.snapshot;
    const now = feed.at;
    if (feed.link == null) {
      setLive((old) => ({ ...old, link: null }));
      return;
    }
    if (!next || now == null) return;
    const audio = next.audio ?? null;
    const peak = Math.max(
      ...(audio?.input ?? []).map((c) => c.peak_dbfs ?? FLOOR_DB),
      FLOOR_DB,
    );
    const loudest = Math.max(
      peak,
      ...(audio?.output ?? []).map((c) => c.peak_dbfs ?? FLOOR_DB),
    );
    setLive((old) => {
      const signalAt = loudest > FLOOR_DB ? now : old.signalAt;
      const silentSince =
        audio && peak <= FLOOR_DB ? (old.silentSince ?? now) : null;
      return {
        snapshot: next,
        link: feed.link,
        inHeld: hold(old.inHeld, audio?.input, now),
        outHeld: hold(old.outHeld, audio?.output, now),
        silentSince,
        quiet: silentSince != null && now - silentSince >= NO_INPUT_MS,
        signalAt,
        showing: signalAt != null && now - signalAt < SHOW_MS,
      };
    });
  });

  const { snapshot, link, quiet } = live;
  const audio = snapshot?.audio ?? null;
  const xruns = audio?.xruns ?? snapshot?.xruns ?? null;
  const outputClips = (audio?.output ?? []).map((c) => c.clips ?? 0);
  const recallKey = `${now.session}:${now.name ?? ''}`;
  // Counters restart from the moment this preset is playing in Perform.
  if (audio && (!baseline || baseline.key !== recallKey) && xruns != null)
    setBaseline({ key: recallKey, xruns, clips: outputClips });
  const sinceXruns =
    baseline && xruns != null ? Math.max(0, xruns - baseline.xruns) : null;
  const clipped = outputClips.map(
    (c, i) => c > (baseline?.key === recallKey ? (baseline.clips[i] ?? 0) : c),
  );
  const inHeld = live.inHeld.map((h) => h.db);
  const outHeld = live.outHeld.map((h) => h.db);
  const period = snapshot?.stream?.input;
  const dsp =
    audio && audio.deadline_us > 0
      ? (audio.process_us_p95 / audio.deadline_us) * 100
      : null;
  const stats: {
    label: string;
    value: string;
    unit?: string;
    detail: string;
    warn?: boolean;
    onClick?: () => void;
  }[] = [
    {
      label: 'DSP p95',
      value: dsp == null ? '—' : dsp.toFixed(0),
      unit: dsp == null ? '' : '%',
      detail: audio
        ? `of ${(audio.deadline_us / 1000).toFixed(2)} ms${period ? ` · ${period.period_frames} @ ${(period.sample_rate / 1000).toFixed(0)}k` : ''}`
        : 'audio stopped',
      warn: dsp != null && dsp >= 80,
    },
    {
      label: 'Xruns',
      value: sinceXruns == null ? '—' : String(sinceXruns),
      detail: 'since this preset',
      warn: !!sinceXruns,
    },
    {
      label: 'Levels',
      value: quiet
        ? 'Silent'
        : [inHeld, outHeld]
            .map((held) => {
              const top = held.length ? Math.max(...held) : null;
              return top == null || top <= FLOOR_DB ? '—' : top.toFixed(0);
            })
            .join(' / '),
      detail: quiet ? 'no input signal' : 'in / out peak dB',
      warn: quiet,
    },
    {
      label: 'Clip',
      value: clipped.some(Boolean)
        ? clipped.map((c, i) => (c ? (i ? 'R' : 'L') : '')).join('') || 'Out'
        : 'None',
      detail: clipped.some(Boolean) ? 'tap to clear' : 'output, this preset',
      warn: clipped.some(Boolean),
      onClick: clipped.some(Boolean)
        ? () =>
            setBaseline((old) => (old ? { ...old, clips: outputClips } : old))
        : undefined,
    },
    {
      label: 'Temp',
      value:
        snapshot?.host?.temperature_c == null
          ? '—'
          : snapshot.host.temperature_c.toFixed(0),
      unit: snapshot?.host?.temperature_c == null ? '' : '°C',
      detail:
        snapshot?.host?.cpu_percent == null
          ? 'CPU —'
          : `CPU ${snapshot.host.cpu_percent.toFixed(0)}%`,
    },
    {
      label: 'Link',
      value: link == null ? '—' : link.toFixed(0),
      unit: link == null ? '' : 'ms',
      detail: link == null ? 'no reply' : 'this device',
      warn: link == null || link > 250,
    },
  ];

  // Empty slots are for editing; on stage only real blocks are shown.
  const played = lanes
    .map((lane) => ({ ...lane, blocks: lane.blocks.filter((b) => !b.empty) }))
    .filter((lane) => lane.blocks.length);
  const boxes = played.flatMap((lane) =>
    lane.blocks.map((block) => ({
      block,
      tag:
        played.length > 1
          ? (lane.tag ?? (lane.id === 'left' ? 'L' : 'R'))
          : undefined,
    })),
  );
  // A one-line read of the live stats; the full set opens beneath it.
  const summary = stats
    .slice(0, 4)
    .map((s) => `${s.label} ${s.value}${s.unit ?? ''}`)
    .join(' · ');
  return (
    <section
      className="perform perform-gig"
      aria-label="Perform"
      data-mode={mode}
    >
      <div className="perform-bar">
        <button
          type="button"
          className="perform-edit"
          aria-label="Back to Rig"
          onClick={onEdit}
        >
          <ArrowLeft aria-hidden="true" /> Rig
        </button>
        <h2>Perform</h2>
        <div className="perform-modes" role="group" aria-label="Perform view">
          {(
            [
              ['play', 'Play'],
              ['presets', 'Presets'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              aria-pressed={mode === id}
              onClick={() => setMode(id)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="perform-body">
        <EdgeMeter
          side="in"
          channels={audio?.input}
          held={inHeld}
          clipped={[false, false]}
          quiet={quiet}
          showing={live.showing}
        />
        <div className="perform-main">
          <div className="perform-headline">
            <div className="perform-now">
              <span className="perform-now-state">
                {switching ? 'Switching' : now.playing ? 'Playing' : 'Stopped'}
              </span>
              <strong className="perform-now-name">
                {now.name ??
                  (switching ? 'Preparing preset…' : 'Unsaved preset')}
              </strong>
              <span className="perform-now-sub">
                {now.modified ? (
                  <span className="perform-edited">edited, not saved</span>
                ) : (
                  'saved'
                )}
              </span>
            </div>
            <GuitarSwitch layout="compact" />
          </div>
          <PresetSteps disabled={disabled || !!switching} />
          {switching ? (
            <div className="perform-switching" role="status" aria-live="polite">
              <ArrowsClockwise aria-hidden="true" />
              <span>
                <strong>Switching preset…</strong>
                <small>
                  Perform stays open while the next chain is prepared.
                </small>
              </span>
            </div>
          ) : mode === 'presets' ? (
            <div className="perform-section perform-fill">{selector}</div>
          ) : (
            <>
              {scenes}
              {boxes.length > 0 ? (
                <div className="perform-boxes" role="group" aria-label="Blocks">
                  {boxes.map(({ block, tag }) => (
                    <button
                      key={block.id}
                      type="button"
                      className="perform-box"
                      data-kind={block.kind}
                      data-on={block.on}
                      aria-pressed={block.on}
                      aria-label={`${block.label} on`}
                      title={block.label}
                      disabled={disabled}
                      onClick={() => onToggle(block.id)}
                    >
                      <span className="chain-led" aria-hidden="true" />
                      {tag && <span className="perform-box-tag">{tag}</span>}
                      <span className="perform-box-face">{block.face}</span>
                      <span className="perform-box-label">{block.label}</span>
                      <span className="perform-box-state">
                        {block.on ? 'On' : 'Off'}
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                !scenes && (
                  <p className="caption">
                    Nothing to switch in this preset. Presets has the rest.
                  </p>
                )
              )}
            </>
          )}
          {knobs}
          <MasterLevel />
          <details
            className="perform-more"
            data-warn={stats.some((s) => s.warn) || undefined}
          >
            <summary>{summary}</summary>
            <div className="perform-stats" role="group" aria-label="Live stats">
              {stats.map((s) => {
                const content = (
                  <>
                    <span className="perform-stat-label">{s.label}</span>
                    <span className="perform-stat-value">
                      {s.value}
                      {s.unit && <small>{s.unit}</small>}
                    </span>
                    <span className="perform-stat-detail">{s.detail}</span>
                  </>
                );
                return s.onClick ? (
                  <button
                    key={s.label}
                    type="button"
                    className="perform-stat"
                    data-warn={s.warn || undefined}
                    onClick={s.onClick}
                  >
                    {content}
                  </button>
                ) : (
                  <div
                    key={s.label}
                    className="perform-stat"
                    data-warn={s.warn || undefined}
                  >
                    {content}
                  </div>
                );
              })}
            </div>
          </details>
        </div>
        <EdgeMeter
          side="out"
          channels={audio?.output}
          held={outHeld}
          clipped={clipped}
          quiet={false}
          showing={live.showing}
        />
      </div>
    </section>
  );
}
