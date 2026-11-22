import {
  ArrowLeft,
  ArrowsClockwise,
  CaretLeft,
  CaretRight,
} from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';

import { Button } from '@oxidal/design-system/components/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@oxidal/design-system/components/select';
import { Caption } from '@oxidal/design-system/components/text';
import { StageHeading } from '@oxidal/design-system/patterns/stage-heading';
import { FootswitchPad } from '@oxidal/design-system/widgets/footswitches';
import { Meter } from '@oxidal/design-system/widgets/meter';

import {
  type MidiPosition,
  midiPosition,
  type Monitoring,
  muteMidi,
  navigateMidi,
} from './api';
import { PerformanceTempo } from './components/media/PerformanceTempo';
import { PerformPlayerRow } from './components/media/PerformPlayerRow';
import { CueEntryBacking } from './components/media/SongLinkControls';
import { LinkedSheet } from './features/library/LinkedSheet';
import { RehearsalReport } from './features/library/RehearsalReport';
import {
  StageFootswitches,
  type StageSceneControls,
} from './features/stage/StageFootswitches';
import { StageSetList } from './features/stage/StageSetList';
import { GuitarSwitch } from './GuitarSettings';
import { friendlyError } from './lib/friendlyError';
import { useSessionState } from './lib/sessionState';
import { MasterLevel } from './MasterLevel';
import { useMonitorReadings } from './monitorFeed';
import { setPerform, usePerform } from './performState';
import type { RigLaneVM } from './rigChain';

const FLOOR_DB = -60;
const HOLD_MS = 1500;
const NO_INPUT_MS = 3000;
// Rails appear while there is signal and fade this long after it stops.
const SHOW_MS = 2000;
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
      className="pointer-events-none self-stretch opacity-0 transition-opacity data-[showing]:opacity-100 motion-reduce:transition-none [[data-display=epaper]_&]:opacity-100 [[data-display=epaper]_&]:transition-none"
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
      <div aria-hidden="true" className="flex h-full gap-px">
        {(channels?.length ? channels : [null, null]).map((channel, i) => (
          <Meter
            key={i}
            orientation="vertical"
            size="sm"
            label={`${label} ${i + 1}`}
            value={channel?.peak_dbfs ?? null}
            peak={held[i]}
            clipped={clipped[i]}
            state={channel ? 'live' : 'unavailable'}
            showValue={false}
            className="min-w-0 [&>[aria-hidden=true]]:w-[3px] [&>span]:sr-only"
          />
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
function PresetSteps({
  disabled,
  muted,
  owner,
  stepping,
  navigationRefresh,
  onStep,
}: {
  disabled: boolean;
  muted: boolean;
  owner: string;
  stepping: boolean;
  navigationRefresh: number;
  onStep: (direction: 'previous' | 'next') => void;
}) {
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState('');
  const [position, setPosition] = useState<MidiPosition | null>(null);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let live = true;
    const load = () =>
      Promise.resolve()
        .then(() => midiPosition())
        .then((next) => live && setPosition(next ?? null))
        .catch(() => live && setPosition(null));
    void load();
    const timer = window.setInterval(() => void load(), 3000);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, [owner, reload, navigationRefresh]);
  async function mute() {
    setBusy(true);
    setRefusal('');
    try {
      await muteMidi();
    } catch (cause) {
      setRefusal(friendlyError(cause, 'change mute'));
    } finally {
      setBusy(false);
    }
  }
  const line = (label: string, n: MidiPosition['previous']) =>
    n ? (
      <span data-ready={n.ready} className="data-[ready=false]:text-foreground">
        {label}: {n.name} · {n.detail}
      </span>
    ) : (
      <span>{label}: none, end of the Set list</span>
    );
  return (
    <div className="flex min-w-0 flex-wrap items-center justify-center gap-2">
      <StageSetList
        key={owner}
        position={position}
        disabled={disabled || busy || stepping}
        onRecall={() => setReload((count) => count + 1)}
      />
      <div role="group" aria-label="Set list" className="inline-flex gap-1">
        <Button
          variant="outline"
          type="button"
          disabled={disabled || busy || stepping}
          onClick={() => onStep('previous')}
        >
          <CaretLeft aria-hidden="true" /> Previous
        </Button>
        <Button
          variant="outline"
          type="button"
          disabled={disabled || busy || stepping}
          onClick={() => onStep('next')}
        >
          Next <CaretRight aria-hidden="true" />
        </Button>
      </div>
      {position && position.index != null && (
        <div
          className="min-w-0 text-center text-xs text-muted-foreground"
          aria-label="Set list neighbours"
        >
          <p>
            {line('Previous', position.previous)} {line('Next', position.next)}
          </p>
          <p className="sr-only">
            An entry can choose a starting scene. Previous and Next stop at the
            ends.
          </p>
        </div>
      )}
      <Button
        variant="outline"
        type="button"
        className="aria-pressed:bg-primary aria-pressed:text-primary-foreground"
        aria-pressed={muted}
        disabled={disabled || busy}
        onClick={() => void mute()}
      >
        {muted ? 'Muted · tap to unmute' : 'Mute output'}
      </Button>
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
  sceneControls,
  selector,
}: {
  /** What is playing: the surface is the same for every engine. */
  now: {
    session: string;
    playing: boolean;
    name?: string | null;
    modified: boolean;
    scene?: string;
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
  sceneControls?: StageSceneControls;
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
  const [layout, setLayout] = useSessionState<'pads' | 'four' | 'ten'>(
    'stage-controller-layout',
    'pads',
  );
  const [stepping, setStepping] = useState(false);
  const [navigationRefresh, setNavigationRefresh] = useState(0);
  const [stepRefusal, setStepRefusal] = useState('');
  const navigationPending = useRef(false);
  async function step(direction: 'previous' | 'next') {
    if (navigationPending.current || disabled || switching) return;
    navigationPending.current = true;
    setStepping(true);
    setStepRefusal('');
    try {
      await navigateMidi(direction);
      setNavigationRefresh((count) => count + 1);
    } catch (cause) {
      setStepRefusal(friendlyError(cause, 'change preset'));
    } finally {
      navigationPending.current = false;
      setStepping(false);
    }
  }
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
      className="grid min-w-0 gap-3"
      data-slot="stage"
      aria-label="Perform"
      data-mode={mode}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Button
          variant="outline"
          type="button"
          aria-label="Back to Rig"
          onClick={onEdit}
        >
          <ArrowLeft aria-hidden="true" /> Rig
        </Button>
        <h2 className="m-0 text-base font-semibold">Perform</h2>
        <Select
          value={layout}
          onValueChange={(value) => {
            if (value === 'pads' || value === 'four' || value === 'ten')
              setLayout(value);
          }}
        >
          <SelectTrigger aria-label="On-screen controller layout" size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="pads">Rig pads</SelectItem>
            <SelectItem value="four">Four switches</SelectItem>
            <SelectItem value="ten">Ten switches</SelectItem>
          </SelectContent>
        </Select>
        <div
          className="ml-auto inline-flex flex-wrap gap-1"
          role="group"
          aria-label="Perform view"
        >
          {(
            [
              ['play', 'Play'],
              ['presets', 'Presets'],
            ] as const
          ).map(([id, label]) => (
            <Button
              variant={mode === id ? 'default' : 'outline'}
              key={id}
              type="button"
              aria-pressed={mode === id}
              onClick={() => setMode(id)}
            >
              {label}
            </Button>
          ))}
        </div>
      </div>
      <div className="grid min-h-[calc(100dvh-9rem)] min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] gap-1 sm:gap-2">
        <EdgeMeter
          side="in"
          channels={audio?.input}
          held={inHeld}
          clipped={[false, false]}
          quiet={quiet}
          showing={live.showing}
        />
        <div className="flex min-w-0 flex-col gap-3">
          <StageHeading
            name={
              now.name ?? (switching ? 'Preparing preset…' : 'Unsaved preset')
            }
            state={
              switching
                ? 'Switching'
                : now.scene
                  ? `Scene · ${now.scene}`
                  : now.playing
                    ? 'Playing'
                    : 'Stopped'
            }
            detail={
              now.modified ? (
                <span className="font-medium text-brand">
                  edited, not saved
                </span>
              ) : (
                'saved'
              )
            }
          />
          <div className="flex flex-wrap items-center justify-center gap-2">
            <RehearsalReport
              stage
              playing={
                link != null && now.playing
                  ? (now.name ?? undefined)
                  : undefined
              }
              disabled={disabled || !!switching || link == null}
            />
            <PresetSteps
              disabled={disabled || !!switching}
              muted={audio?.monitoring?.output_muted ?? false}
              owner={recallKey}
              stepping={stepping}
              navigationRefresh={navigationRefresh}
              onStep={(direction) => void step(direction)}
            />
          </div>
          {stepRefusal && <p role="alert">{stepRefusal}</p>}
          {switching ? (
            <div
              className="flex min-h-32 items-center justify-center gap-3 rounded-lg border border-border bg-card p-4 [&>span]:grid [&>svg]:size-6 [&>svg]:animate-spin motion-reduce:[&>svg]:animate-none [[data-display=epaper]_&>svg]:animate-none"
              role="status"
              aria-live="polite"
            >
              <ArrowsClockwise aria-hidden="true" />
              <span>
                <strong>Switching preset…</strong>
                <small>
                  Perform stays open while the next chain is prepared.
                </small>
              </span>
            </div>
          ) : mode === 'presets' ? (
            <div className="grid min-w-0 flex-1 content-start">{selector}</div>
          ) : null}
          <LinkedSheet stage />
          {!switching && mode === 'play' && (
            <>
              {scenes}
              {layout !== 'pads' && (
                <StageFootswitches
                  layout={layout}
                  scenes={sceneControls}
                  blocks={boxes.map(({ block }) => block)}
                  disabled={disabled || stepping}
                  tempo={snapshot?.tempo ?? undefined}
                  boost={
                    now.playing && audio?.monitoring
                      ? (audio.monitoring.boost_active ?? false)
                      : undefined
                  }
                  onStep={(direction) => void step(direction)}
                  onToggle={onToggle}
                />
              )}
              {layout === 'pads' &&
                (boxes.length > 0 ? (
                  <div
                    className="grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-[repeat(auto-fit,minmax(9rem,1fr))] [&>button]:min-h-24"
                    role="group"
                    aria-label="Blocks"
                  >
                    {boxes.map(({ block, tag }) => (
                      <FootswitchPad
                        key={block.id}
                        name={tag ?? block.kind}
                        label={block.label}
                        accessibleName={`${tag ?? block.kind} ${block.label} on`}
                        pressed={block.on}
                        disabled={disabled}
                        onTap={() => onToggle(block.id)}
                      />
                    ))}
                  </div>
                ) : (
                  !scenes && (
                    <Caption>
                      Nothing to switch in this preset. Presets has the rest.
                    </Caption>
                  )
                ))}
            </>
          )}
          <div className="flex flex-wrap items-end justify-center gap-x-6 gap-y-2 border-t border-border pt-2">
            <PerformanceTempo />
            <GuitarSwitch layout="compact" />
            {snapshot?.set_entry && (
              <CueEntryBacking
                row={snapshot.set_entry}
                disabled={disabled || !!switching || link == null}
              />
            )}
          </div>
          <PerformPlayerRow />
          {knobs}
          <MasterLevel />
          <details
            className="min-w-0 rounded-lg border border-border bg-card px-3 data-[warn]:border-brand"
            data-warn={stats.some((s) => s.warn) || undefined}
          >
            <summary className="min-h-touch cursor-pointer py-3 text-sm font-medium">
              {summary}
            </summary>
            <div
              className="grid min-w-0 grid-cols-2 gap-2 border-t border-border py-2 sm:grid-cols-3 lg:grid-cols-6"
              role="group"
              aria-label="Live stats"
            >
              {stats.map((s) => {
                const tile =
                  'group grid min-w-0 content-start gap-0.5 rounded-md p-2 text-left';
                const content = (
                  <>
                    <span className="small-caps text-xs text-muted-foreground">
                      {s.label}
                    </span>
                    <span className="font-mono text-lg font-semibold tabular-nums group-data-[warn]:text-brand [&>small]:ml-1 [&>small]:text-xs">
                      {s.value}
                      {s.unit && <small>{s.unit}</small>}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {s.detail}
                    </span>
                  </>
                );
                return s.onClick ? (
                  <Button
                    variant="ghost"
                    key={s.label}
                    type="button"
                    className={`${tile} h-auto justify-start whitespace-normal`}
                    data-warn={s.warn || undefined}
                    onClick={s.onClick}
                  >
                    {content}
                  </Button>
                ) : (
                  <div
                    key={s.label}
                    className={tile}
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
