import {
  CheckCircle,
  Guitar,
  SpeakerHigh,
  WarningCircle,
} from '@phosphor-icons/react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { Badge } from '@oxidal/design-system/components/badge';
import { Button } from '@oxidal/design-system/components/button';
import {
  Card,
  CardHeader,
} from '@oxidal/design-system/components/card';
import { StateNotice } from '@oxidal/design-system/components/states';
import {
  Caption,
  Description,
  Eyebrow,
  Readout,
  Title,
} from '@oxidal/design-system/components/text';
import { SoundCheck as ReadinessList } from '@oxidal/design-system/patterns/guitar-tools';
import {
  LEVELS_SECTIONS,
  type LevelsSection,
} from '@oxidal/design-system/patterns/levels-sections';
import { ReadingsTabs } from '@oxidal/design-system/patterns/readings-table';
import { SettingRow } from '@oxidal/design-system/patterns/settings-page';
import { Workspace } from '@oxidal/design-system/patterns/workspace';
import { Meter } from '@oxidal/design-system/widgets/meter';

import {
  boosts,
  type BoostState,
  calibration,
  type CalibrationCoverage,
  calibrationCoverage,
  type CalibrationState,
  type GuitarProfiles,
  guitarProfiles,
  type UnitLevels,
  unitLevels,
} from './api';
import { CaptureListening } from './CaptureListening';
import { VenueEq } from './components/media/VenueEq';
import { EvenOut } from './EvenOut';
import {
  guitarVerificationDetail,
  guitarVerificationState,
} from './guitarVerification';
import { leaveScreen } from './lib/leaveGuard';
import { MasterLevel } from './MasterLevel';
import { useMonitorFeed } from './monitorFeed';
import { Monitoring } from './Monitoring';
import { processingHeadroom } from './processingHeadroom';
import { useSectionLocation } from './workspaceMemory';

type HealthData = {
  calibration: CalibrationState | null;
  coverage: CalibrationCoverage | null;
  boosts: BoostState | null;
  guitars: GuitarProfiles | null;
  levels: UnitLevels | null;
};

type Fix = {
  title: string;
  detail: string;
  action?: { label: string; run: () => void };
};

const sections = LEVELS_SECTIONS.map(({ id }) => id);

const db = (value: number | null | undefined) =>
  value == null
    ? '—'
    : `${value > 0 ? '+' : value < 0 ? '−' : ''}${Math.abs(value).toFixed(1)} dB`;
const dbfs = (value: number | null | undefined) =>
  value == null ? '—' : `${value.toFixed(1)} dBFS`;
const lufs = (value: number | null | undefined) =>
  value == null ? '—' : `${value.toFixed(1)} LUFS`;

/**
 * Musician-facing health and gain-staging overview, with the measured monitor
 * and retained diagnostic history kept on the same page.
 * @see docs/audio.md
 * @see docs/monitoring.md
 */
export function SoundCheck({
  connected,
  displayMode,
  onAudioSetup,
  onGuitars,
  onLibrary,
  beforePlay,
}: {
  connected: boolean;
  displayMode: string;
  onAudioSetup: () => void;
  onGuitars: () => void;
  onLibrary: () => void;
  beforePlay?: {
    storage: string | null;
    onStorage: () => void;
    onLevels: () => void;
  };
}) {
  const [data, setData] = useState<HealthData>({
    calibration: null,
    coverage: null,
    boosts: null,
    guitars: null,
    levels: null,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [view, setView] = useSectionLocation<LevelsSection>(
    'monitor',
    sections,
    'overview',
  );
  const feed = useMonitorFeed(displayMode === 'epaper' ? 5000 : 1000);

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    setRefresh((value) => value + 1);
  }, []);
  useEffect(() => {
    const abort = new AbortController();
    Promise.allSettled([
      calibration(undefined, abort.signal),
      calibrationCoverage(abort.signal),
      boosts(undefined, abort.signal),
      guitarProfiles(undefined, abort.signal),
      unitLevels(undefined, abort.signal),
    ]).then((results) => {
      if (abort.signal.aborted) return;
      const failed = results.find(
        (result): result is PromiseRejectedResult =>
          result.status === 'rejected',
      );
      setData({
        calibration:
          results[0].status === 'fulfilled' ? results[0].value : null,
        coverage: results[1].status === 'fulfilled' ? results[1].value : null,
        boosts: results[2].status === 'fulfilled' ? results[2].value : null,
        guitars: results[3].status === 'fulfilled' ? results[3].value : null,
        levels: results[4].status === 'fulfilled' ? results[4].value : null,
      });
      setError(
        failed ? `Some health checks are unavailable: ${failed.reason}` : '',
      );
      setLoading(false);
    });
    return () => abort.abort();
  }, [refresh]);

  const monitor = feed.snapshot;
  const live =
    connected &&
    !!monitor?.audio &&
    monitor.audio_age_ms != null &&
    monitor.audio_age_ms < 3000;
  const input = monitor?.audio?.input ?? [];
  const output = monitor?.audio?.output ?? [];
  const inputPeak = input.length
    ? Math.max(...input.map((channel) => channel.peak_dbfs))
    : null;
  const outputPeak = output.length
    ? Math.max(...output.map((channel) => channel.peak_dbfs))
    : null;
  const inputClips = input.reduce((sum, channel) => sum + channel.clips, 0);
  const outputClips = output.reduce((sum, channel) => sum + channel.clips, 0);
  const deadlineMisses = monitor?.audio?.deadline_misses ?? 0;
  const processing = processingHeadroom(live ? monitor?.audio : null);
  const entries = useMemo(
    () =>
      [...(data.calibration?.entries ?? [])].sort((a, b) => b.lufs - a.lufs),
    [data.calibration?.entries],
  );
  const loudest = entries[0];
  const quietest = entries.at(-1);
  const spread =
    loudest && quietest ? Math.max(0, loudest.lufs - quietest.lufs) : null;
  const corrected = entries
    .map((entry) => entry.lufs + entry.offset_db)
    .sort((a, b) => b - a);
  const correctedSpread = corrected.length
    ? Math.max(0, corrected[0]! - corrected.at(-1)!)
    : null;
  const targetLufs = data.calibration?.target_lufs;
  const limitedCorrections = entries.filter(
    (entry) =>
      targetLufs != null &&
      Math.abs(entry.offset_db) >= 24 &&
      Math.abs(entry.lufs + entry.offset_db - targetLufs) >= 0.25,
  );
  const limitedGroups = limitedCorrections.reduce<
    { preset: string; scenes: { name: string; offset: number }[] }[]
  >((groups, entry) => {
    const parts = entry.name.split(' · ');
    const scene = parts.length > 1 ? parts.pop()! : entry.name;
    const preset = parts.join(' · ') || 'Preset';
    let group = groups.find((candidate) => candidate.preset === preset);
    if (!group) {
      group = { preset, scenes: [] };
      groups.push(group);
    }
    group.scenes.push({ name: scene, offset: entry.offset_db });
    return groups;
  }, []);
  const activeGuitar = data.guitars?.guitars.find(
    (guitar) => guitar.id === data.guitars?.active,
  );
  const verification = guitarVerificationState(activeGuitar, monitor?.stream);
  const playingKeys = data.boosts?.playing ?? [];
  const presetBoost = playingKeys[0]
    ? (data.boosts?.boosts[playingKeys[0]] ?? 0)
    : 0;
  const sceneBoost = playingKeys[1]
    ? (data.boosts?.boosts[playingKeys[1]] ?? 0)
    : 0;

  const fixes: Fix[] = [];
  if (!connected) {
    fixes.push({
      title: 'Reconnect to Oxidal',
      detail: 'Live readings and device actions are unavailable.',
    });
  } else if (!live) {
    fixes.push({
      title: 'Choose and start an audio interface',
      detail: 'No current input/output reading is available.',
      action: { label: 'Audio setup', run: onAudioSetup },
    });
  }
  if (data.guitars && !activeGuitar)
    fixes.push({
      title: 'Select the guitar you are playing',
      detail: 'No guitar profile is applying its trim or measured gate.',
      action: { label: 'Guitar profiles', run: onGuitars },
    });
  else if (
    activeGuitar &&
    (activeGuitar.peak_dbfs == null || activeGuitar.noise_dbfs == null)
  )
    fixes.push({
      title: `Finish measuring ${activeGuitar.name}`,
      detail:
        'Measure both a strong strum and muted-string noise for useful trim and gate advice.',
      action: { label: 'Measure guitar', run: onGuitars },
    });
  else if (activeGuitar && verification === 'unverified')
    fixes.push({
      title: `Verify ${activeGuitar.name} on this input`,
      detail:
        'This measurement predates input tracking. Measure strum or noise once while the current interface is running.',
      action: { label: 'Measure guitar', run: onGuitars },
    });
  else if (activeGuitar && verification === 'stale')
    fixes.push({
      title: `Recheck ${activeGuitar.name} for this input`,
      detail:
        'The current endpoint, format, channel routing or buffer differs from the profile measurement.',
      action: { label: 'Measure guitar', run: onGuitars },
    });
  if (!loading && data.calibration && data.calibration.target_lufs == null)
    fixes.push({
      title: 'Even out preset loudness',
      detail:
        'Presets and scenes have not been measured against one target yet.',
      action: {
        label: 'Even out',
        run: beforePlay?.onLevels ?? (() => setView('loudness')),
      },
    });
  if (live && inputClips === 0 && inputPeak !== null && inputPeak >= -3)
    fixes.push({
      title: `Input peaks at ${dbfs(inputPeak)}`,
      detail:
        'Turn the interface gain down a little. Aim for −12 dBFS when you play hard.',
      action: {
        label: 'Show input meter',
        run: () => document.getElementById('sound-check-meters')?.focus(),
      },
    });
  if (inputClips > 0)
    fixes.push({
      title: 'Reduce interface input gain',
      detail: `${inputClips} clipped input samples were recorded before the rig. Lower the interface's physical input-gain knob, then remeasure the guitar profile.`,
      action: { label: 'Audio setup', run: onAudioSetup },
    });
  if (outputClips > 0)
    fixes.push({
      title: 'Reduce digital output level',
      detail: `${outputClips} clipped output samples were recorded after the rig. Reduce scene/preset Boost or master Level; the interface's physical volume knob cannot repair digital clipping.`,
      action: { label: 'Audio setup', run: onAudioSetup },
    });
  if ((monitor?.xruns ?? 0) > 0 || deadlineMisses > 0)
    fixes.push({
      title: 'Increase audio headroom',
      detail: `${monitor?.xruns ?? 0} recovered xruns and ${deadlineMisses} missed processing deadlines are recorded in this session.`,
      action: { label: 'Audio setup', run: onAudioSetup },
    });
  else if (processing.tight)
    fixes.push({
      title: 'Processing headroom is tight',
      detail: `DSP p95 is ${processing.p95?.toFixed(0)}% and the session peak is ${processing.peak?.toFixed(0)}% of one audio period. Use fewer gapless-ready rigs or a larger buffer before dropouts begin.`,
      action: { label: 'Audio setup', run: onAudioSetup },
    });
  const openLoudness = beforePlay?.onLevels ?? (() => setView('loudness'));
  // A measurement far outside a played guitar was taken without signal (or
  // with feedback): it makes the spread look huge and its correction up to
  // ±24 dB wrong, so measure it again.
  const silent = entries.filter((entry) => entry.lufs < -40 || entry.lufs > -6);
  if (silent.length)
    fixes.push({
      title: `Measure ${silent.length === 1 ? silent[0]!.name : `${silent.length} sounds`} again`,
      detail: `${silent
        .slice(0, 3)
        .map((entry) => `${entry.name} ${lufs(entry.lufs)}`)
        .join(
          ' · ',
        )}${silent.length > 3 ? ' and more' : ''}: outside the range of a played guitar, so probably measured without signal or with feedback. Even out measures them again.`,
      action: { label: 'Even out', run: openLoudness },
    });
  // Correction already brings the presets together: no outlier warning.
  if (
    spread != null &&
    spread > 6 &&
    (correctedSpread == null || correctedSpread > 1.5)
  )
    fixes.push({
      title: 'Even out loudness outliers',
      detail: `${loudest?.name} and ${quietest?.name} are ${spread.toFixed(1)} LU apart${correctedSpread != null ? `, still ${correctedSpread.toFixed(1)} LU after correction` : ' before correction'}. Even out measures and corrects them.`,
      action: { label: 'Even out', run: openLoudness },
    });
  if (limitedCorrections.length)
    fixes.push({
      title: `${limitedCorrections.length} ${limitedCorrections.length === 1 ? 'scene needs' : 'scenes need'} manual gain review`,
      detail:
        'The Library is wider than Oxidal’s complete ±24 dB correction range. The affected sounds are grouped in Loudness instead of claiming they reached the target.',
      action: { label: 'Review loudness', run: openLoudness },
    });

  if (beforePlay) {
    const checks = fixes.map((fix) => ({
      ok: false,
      title: fix.title,
      fix: fix.detail,
      action: fix.action?.label ?? 'Open levels',
      run: fix.action?.run ?? beforePlay.onLevels,
    }));
    if (beforePlay.storage)
      checks.push({
        ok: beforePlay.storage === 'locked',
        title: `System storage is ${beforePlay.storage}`,
        fix: 'Changes take effect after restarting the device.',
        action: 'System storage',
        run: beforePlay.onStorage,
      });
    if (live && monitor?.stream)
      checks.push({
        ok: true,
        title: `Audio: ${monitor.stream.input.period_frames} frames at ${monitor.stream.input.sample_rate / 1000} kHz`,
        fix: 'The audio engine is reporting live readings.',
        action: 'Audio setup',
        run: onAudioSetup,
      });
    return (
      <>
        {loading && <p role="status">Reading device checks…</p>}
        {error && <p role="status">{error}</p>}
        <ReadinessList
          plain
          title="Before you play"
          caption="What needs a look is first"
          checks={checks.sort((a, b) => Number(a.ok) - Number(b.ok))}
          onAction={(item) => checks.find((c) => c === item)?.run()}
        />
      </>
    );
  }

  return (
    <section className="grid min-w-0 gap-6" aria-label="Levels">
      <Workspace
        label="Levels"
        sections={LEVELS_SECTIONS}
        current={view}
        className="px-0"
        onSelect={(id) => {
          if (sections.includes(id as LevelsSection))
            leaveScreen(() => setView(id as LevelsSection));
        }}
      >
        {/* The readiness check as one quiet line: its state, the question
            and Refresh, with what it covers underneath. */}
        <header className="grid gap-1 border-b border-border pb-3">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <Badge
              tone={fixes.length ? 'warning' : 'neutral'}
              data-state={fixes.length ? 'attention' : 'ready'}
            >
              {fixes.length ? (
                <WarningCircle aria-hidden="true" />
              ) : (
                <CheckCircle aria-hidden="true" />
              )}
              {loading
                ? 'Checking'
                : fixes.length
                  ? `${fixes.length} to review`
                  : 'No current software warnings'}
            </Badge>
            <Title as="h2" size="sm" className="m-0">
              Is the whole instrument ready?
            </Title>
            <Button
              variant="outline"
              size="sm"
              className="ms-auto"
              disabled={loading}
              onClick={load}
            >
              Refresh checks
            </Button>
          </div>
          <Description className="max-w-prose text-xs">
            One view of the guitar, interface, loudness, intentional boosts and
            live processing health. Digital readings cannot judge a physical
            output knob or room loudness.
          </Description>
        </header>

        {error && (
          <StateNotice kind="error" title="Levels could not refresh">
            {error}
          </StateNotice>
        )}
        {view === 'overview' && (
          <div className="grid min-w-0 gap-6">
            <div
              id="sound-check-meters"
              tabIndex={-1}
              className="grid grid-cols-2 gap-2 min-[761px]:grid-cols-5 max-[760px]:[&>:last-child]:col-span-full"
              role="group"
              aria-label="Live levels"
            >
              <PeakTile
                label="Input"
                live={live}
                peak={inputPeak}
                clips={inputClips}
              />
              <PeakTile
                label="Output"
                live={live}
                peak={outputPeak}
                clips={outputClips}
              />
              <MeterTile
                label="DSP load"
                value={
                  live && processing.p95 != null
                    ? `${processing.p95.toFixed(0)}%`
                    : '—'
                }
                level={
                  live && processing.p95 != null ? processing.p95 / 100 : null
                }
                state={
                  !live
                    ? 'idle'
                    : processing.tight || deadlineMisses > 0
                      ? 'warn'
                      : 'ok'
                }
                note={`${deadlineMisses} missed`}
              />
              <MeterTile
                label="Loudness spread"
                value={spread != null ? `${spread.toFixed(1)} LU` : '—'}
                level={spread != null ? Math.min(1, spread / 24) : null}
                state={spread == null ? 'idle' : spread > 6 ? 'warn' : 'ok'}
                note={
                  correctedSpread != null
                    ? `${correctedSpread.toFixed(1)} LU after`
                    : 'Not measured'
                }
              />
              <MeterTile
                label="Guitar"
                value={activeGuitar?.name ?? '—'}
                level={null}
                state={
                  !activeGuitar
                    ? 'idle'
                    : verification === 'current'
                      ? 'ok'
                      : 'warn'
                }
                note={
                  activeGuitar
                    ? `Trim ${(activeGuitar.trim_db ?? 0).toFixed(1)} dB`
                    : 'None selected'
                }
              />
            </div>
            {loading ? (
              <StateNotice kind="loading" title="Reading instrument health…" />
            ) : (
              <ReadinessList
                title="Fix next"
                checks={[
                  ...fixes.map((fix) => ({
                    ok: false,
                    title: fix.title,
                    fix: fix.detail,
                    action: fix.action?.label,
                  })),
                  ...(live && monitor?.xruns === 0 && deadlineMisses === 0
                    ? [
                        {
                          ok: true,
                          title: 'No dropouts this session',
                          fix: 'No xruns or missed processing deadlines reported.',
                        },
                      ]
                    : []),
                  ...(entries.length >= 2 &&
                  correctedSpread !== null &&
                  correctedSpread <= 1.5
                    ? [
                        {
                          ok: true,
                          title: `Presets are within ${correctedSpread.toFixed(1)} dB of each other`,
                          fix: 'Estimated from the measured loudness and saved offsets.',
                        },
                      ]
                    : []),
                ]}
                onAction={(item) =>
                  fixes.find((fix) => fix.title === item.title)?.action?.run()
                }
              />
            )}

            {/* The readings as tabs under Fix next, so none is pushed to the
                bottom; a tab with something to look at carries a light. */}
            <ReadingsTabs
              groups={[
                {
                  title: 'Loudness',
                  note: 'Reference riff · before intentional Boost',
                  readings: [
                    {
                      id: 'target',
                      label: 'Target',
                      value: lufs(data.calibration?.target_lufs),
                      detail: data.coverage
                        ? `${data.coverage.measured} current · ${data.coverage.stale} stale after changes · ${data.coverage.unmeasured} never measured · ${data.coverage.total} total.`
                        : `${entries.length} stored measurements. Refresh checks to scan current Library coverage.`,
                    },
                    {
                      id: 'before',
                      label: 'Before correction',
                      value:
                        spread == null ? '—' : `${spread.toFixed(1)} LU spread`,
                      attention: spread != null && spread > 6,
                      detail:
                        loudest && quietest
                          ? `${loudest.name} ${lufs(loudest.lufs)} · ${quietest.name} ${lufs(quietest.lufs)}`
                          : 'Run Even out to build a measured comparison.',
                    },
                    {
                      id: 'after',
                      label: 'After correction',
                      value:
                        correctedSpread == null
                          ? '—'
                          : `${correctedSpread.toFixed(1)} LU spread`,
                      detail:
                        loudest && quietest
                          ? `${loudest.name} ${lufs(loudest.lufs + loudest.offset_db)} · ${quietest.name} ${lufs(quietest.lufs + quietest.offset_db)}. Intentional Boost remains on top.`
                          : 'Corrections appear after the first completed Even out run.',
                      action: (
                        <Button variant="outline" size="sm" onClick={onLibrary}>
                          Preset library
                        </Button>
                      ),
                    },
                  ],
                },
                {
                  title: 'Guitar',
                  note: 'Before every rig',
                  readings: [
                    {
                      id: 'trim',
                      label: activeGuitar?.name ?? 'No active profile',
                      value: db(activeGuitar?.trim_db ?? 0),
                      detail: activeGuitar
                        ? `Trim. Strum ${dbfs(activeGuitar.peak_dbfs)} · noise ${dbfs(activeGuitar.noise_dbfs)}`
                        : 'Choose the instrument currently plugged into the interface.',
                      action: (
                        <Button variant="outline" size="sm" onClick={onGuitars}>
                          <Guitar aria-hidden="true" /> Guitar profiles
                        </Button>
                      ),
                    },
                    {
                      id: 'profile',
                      label: 'Profile health',
                      value:
                        verification === 'current'
                          ? 'Current input verified'
                          : verification === 'stored'
                            ? 'Checked input stored'
                            : verification === 'stale'
                              ? 'Input changed'
                              : verification === 'unverified'
                                ? 'Recheck input'
                                : 'Measurement needed',
                      attention:
                        verification !== 'current' && verification !== 'stored',
                      detail: `${guitarVerificationDetail(activeGuitar)} Levels follows the active profile automatically. Remeasure after changing the physical input-gain knob or the guitar's output level; Oxidal cannot read either control.`,
                    },
                  ],
                },
                {
                  title: 'Interface',
                  note: 'Current digital stream',
                  readings: [
                    {
                      id: 'stream',
                      label: live ? 'Live' : 'No live stream',
                      value: monitor?.stream
                        ? `${monitor.stream.input.sample_rate / 1000} kHz`
                        : '—',
                      detail: monitor?.stream
                        ? `${monitor.stream.input.endpoint} → ${monitor.stream.output.endpoint} · ${monitor.stream.input.period_frames} frames × ${monitor.stream.input.periods}`
                        : 'Select a capture and playback device, then start audio.',
                      action: (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={onAudioSetup}
                        >
                          <SpeakerHigh aria-hidden="true" /> Audio setup
                        </Button>
                      ),
                    },
                    {
                      id: 'peaks',
                      label: 'Input / output peak',
                      value: `${dbfs(inputPeak)} / ${dbfs(outputPeak)}`,
                      attention: inputClips + outputClips > 0,
                      detail: `${inputClips} input clips · ${outputClips} output clips in this audio session.`,
                    },
                    {
                      id: 'gain',
                      label: 'Input gain guidance',
                      value:
                        inputClips > 0
                          ? 'Reduce physical gain'
                          : activeGuitar?.peak_dbfs == null
                            ? 'Measure your guitar'
                            : activeGuitar.peak_dbfs > -3
                              ? 'Very little headroom'
                              : activeGuitar.peak_dbfs < -30
                                ? 'Measured level is low'
                                : 'Measured level is usable',
                      attention: inputClips > 0,
                      detail:
                        activeGuitar?.peak_dbfs == null
                          ? 'Measure a strong strum. Re-measure whenever the interface input-gain knob changes.'
                          : `Profile strum ${dbfs(activeGuitar.peak_dbfs)} before trim. Re-measure after changing the physical input-gain knob; Oxidal cannot read that knob.`,
                    },
                    {
                      id: 'listening',
                      label: 'Listening volume',
                      value:
                        outputClips > 0
                          ? 'Digital clipping'
                          : 'Physical level unknown',
                      attention: outputClips > 0,
                      detail:
                        outputClips > 0
                          ? 'Reduce Boost or master Level before raising any physical output control.'
                          : 'If the digital output is healthy but headphones or speakers are too loud or quiet, adjust the interface, amplifier or speaker controls.',
                    },
                  ],
                },
                {
                  title: 'Processing',
                  note: 'Audio thread · not total CPU',
                  readings: [
                    {
                      id: 'dsp',
                      label: 'DSP p95 / deadline',
                      value:
                        processing.p95 != null
                          ? `${processing.p95.toFixed(0)}%`
                          : '—',
                      attention: processing.tight || deadlineMisses > 0,
                      detail: `${processing.peak == null ? 'No session peak' : `${processing.peak.toFixed(0)}% session peak`} · ${monitor?.xruns ?? 0} recovered xruns · ${deadlineMisses} missed deadlines.`,
                    },
                  ],
                },
                {
                  title: 'Playing level stages',
                  note: 'Shown separately so correction is not confused with solo Boost',
                  readings: [
                    {
                      id: 'trim',
                      label: 'Guitar trim',
                      value: db(data.levels?.input_trim_db),
                      detail:
                        'Before the rig; selected by the active guitar profile.',
                    },
                    {
                      id: 'even',
                      label: 'Even out correction',
                      value: db(data.boosts?.calibrated_db),
                      detail:
                        'Measured correction for the sounding preset or scene.',
                    },
                    {
                      id: 'preset',
                      label: 'Preset Boost',
                      value: db(presetBoost),
                      detail: playingKeys[0]
                        ? 'Intentional extra level on the sounding preset.'
                        : 'No sounding preset boost key.',
                    },
                    {
                      id: 'scene',
                      label: 'Scene Boost',
                      value: db(sceneBoost),
                      detail: playingKeys[1]
                        ? 'Intentional extra level on the sounding scene.'
                        : 'No separate sounding scene boost.',
                    },
                    {
                      id: 'applied',
                      label: 'Applied correction + Boost',
                      value: db(data.boosts?.applied_db),
                      detail:
                        'The combined bounded amount currently added before master Level.',
                    },
                    {
                      id: 'master',
                      label: 'Master Level',
                      value: db(data.levels?.output_level_db),
                      detail:
                        "Unit-wide digital output after the rig; not the interface's physical knob.",
                    },
                  ],
                },
              ]}
            />
            {/* After the readings, so what needs a look comes first. As C2:
                one card for what happens after the mix, the level
                and Mono, then the venue EQ under one rule. */}
            <Card aria-label="Output controls" className="grid gap-4">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <h3 className="m-0 text-base font-semibold">Output</h3>
                <Caption as="span" className="text-xs">
                  After the mix · not saved in presets
                </Caption>
              </div>
              <MasterLevel disabled={!connected} layout="page" />
              <VenueEq connected={connected} bare />
            </Card>
          </div>
        )}

        {view === 'loudness' && (
          <div className="grid min-w-0 gap-6">
            {/* First in Loudness: it changes every preset, so it is not left for the end. */}
            <EvenOut connected={connected} />
            <CaptureListening
              appliedTrim={data.levels?.input_trim_db ?? null}
              audition
            />
            <div
              className="grid gap-3 min-[761px]:grid-cols-3"
              role="group"
              aria-label="Loudness summary"
            >
              <Card className="min-w-0 gap-2">
                <Eyebrow>Target</Eyebrow>
                <Readout size="lg">
                  {lufs(data.calibration?.target_lufs)}
                </Readout>
                <Caption>Reference riff, before intentional Boost</Caption>
              </Card>
              <Card className="min-w-0 gap-2">
                <Eyebrow>Before correction</Eyebrow>
                <Readout size="lg">
                  {spread == null ? '—' : `${spread.toFixed(1)} LU`}
                </Readout>
                <Caption>Measured loudest-to-quietest spread</Caption>
              </Card>
              <Card className="min-w-0 gap-2">
                <Eyebrow>After correction</Eyebrow>
                <Readout size="lg">
                  {correctedSpread == null
                    ? '—'
                    : `${correctedSpread.toFixed(1)} LU`}
                </Readout>
                <Caption>Bounded automatic correction applied</Caption>
              </Card>
            </div>

            {limitedCorrections.length > 0 && (
              <Card aria-labelledby="sound-check-limit-title">
                <CardHeader>
                  <div className="grid max-w-prose justify-items-start gap-2">
                    <Badge>{limitedCorrections.length} scenes</Badge>
                    <h3 id="sound-check-limit-title">
                      Automatic correction stopped at ±24 dB
                    </h3>
                    <Description>
                      These sounds remain outside the reachable common level and
                      need manual preset-level review.
                    </Description>
                  </div>
                  <Button variant="outline" onClick={onLibrary}>
                    Preset library
                  </Button>
                </CardHeader>
                <details>
                  <summary className="min-h-touch cursor-pointer border-t border-border py-3 text-sm font-semibold">
                    Show {limitedGroups.length}{' '}
                    {limitedGroups.length === 1 ? 'preset' : 'presets'}
                  </summary>
                  <div>
                    {limitedGroups.map((group) => (
                      <SettingRow
                        key={group.preset}
                        label={group.preset}
                        caption={group.scenes
                          .map((scene) => `${scene.name} (${db(scene.offset)})`)
                          .join(' · ')}
                      />
                    ))}
                  </div>
                </details>
              </Card>
            )}
          </div>
        )}

        {view === 'diagnostics' && (
          <div className="grid min-w-0 gap-6">
            <Monitoring displayMode={displayMode} />
          </div>
        )}
      </Workspace>
    </section>
  );
}

function PeakTile({
  label,
  live,
  peak,
  clips,
}: {
  label: string;
  live: boolean;
  peak: number | null;
  clips: number;
}) {
  return (
    <Card className="min-w-0 gap-2 p-3">
      <Meter
        label={label}
        value={live ? peak : null}
        state={live && peak != null ? 'live' : 'unavailable'}
        clipped={live && clips > 0}
      />
      <Caption>
        {!live
          ? 'No stream'
          : clips > 0
            ? `${dbfs(peak)} · ${clips} clips`
            : '0 clips'}
      </Caption>
    </Card>
  );
}

/** The remaining readings have their own units and scales. */
function MeterTile({
  label,
  value,
  level,
  state,
  note,
}: {
  label: string;
  value: string;
  level: number | null;
  state: 'ok' | 'warn' | 'idle';
  note: string;
}) {
  return (
    <Card className="min-w-0 gap-2 p-3" data-state={state}>
      <Eyebrow>{label}</Eyebrow>
      <Readout size="md" className="break-words">
        {value}
      </Readout>
      {level != null && (
        <meter
          className="h-2 w-full"
          aria-label={`${label} level`}
          aria-valuetext={value}
          min={0}
          max={1}
          value={Math.min(1, Math.max(0, level))}
        />
      )}
      <Caption>
        {state === 'warn' && (
          <WarningCircle aria-label="Warning" className="mr-1 inline size-4" />
        )}
        {note}
      </Caption>
    </Card>
  );
}
