import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { StateNotice } from './components/ui/state-notice';
import {
  CheckCircle,
  Guitar,
  Pulse,
  SpeakerHigh,
  WarningCircle,
} from '@phosphor-icons/react';
import {
  boosts,
  calibration,
  calibrationCoverage,
  guitarProfiles,
  unitLevels,
  type BoostState,
  type CalibrationState,
  type CalibrationCoverage,
  type GuitarProfiles,
  type UnitLevels,
} from './api';
import { Badge } from './components/ui/badge';
import { Button } from './components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './components/ui/tabs';
import { EvenOut } from './EvenOut';
import { Monitoring } from './Monitoring';
import { useMonitorFeed } from './monitorFeed';
import { processingHeadroom } from './processingHeadroom';
import { ToolRow, ToolSection } from './ToolRow';
import {
  guitarVerificationDetail,
  guitarVerificationState,
} from './guitarVerification';
import './SoundCheck.css';

type HealthData = {
  calibration: CalibrationState | null;
  coverage: CalibrationCoverage | null;
  boosts: BoostState | null;
  guitars: GuitarProfiles | null;
  levels: UnitLevels | null;
};

type Fix = {
  title: string;
  detail: ReactNode;
  action?: { label: string; run: () => void };
};

type SoundCheckView = 'overview' | 'loudness' | 'diagnostics';

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
}: {
  connected: boolean;
  displayMode: string;
  onAudioSetup: () => void;
  onGuitars: () => void;
  onLibrary: () => void;
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
  const [view, setView] = useState<SoundCheckView>('overview');
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
  const limitedCorrections = entries.filter(
    (entry) => Math.abs(entry.offset_db) >= 11.95,
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
        'Presets and scenes have not been measured against one target yet. Use Even out below.',
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
  if (spread != null && spread > 6)
    fixes.push({
      title: 'Review loudness outliers',
      detail: `${loudest?.name} and ${quietest?.name} are ${spread.toFixed(1)} LU apart before correction.`,
      action: { label: 'Preset library', run: onLibrary },
    });
  if (limitedCorrections.length)
    fixes.push({
      title: `${limitedCorrections.length} ${limitedCorrections.length === 1 ? 'scene needs' : 'scenes need'} manual gain review`,
      detail:
        'Even Out stopped at its ±12 dB safety limit. The affected sounds are grouped in Loudness instead of adding more automatic gain.',
      action: { label: 'Review loudness', run: () => setView('loudness') },
    });

  return (
    <section className="sound-check" aria-label="Sound Check">
      <header className="sound-check-intro">
        <div>
          <Badge data-state={fixes.length ? 'attention' : 'ready'}>
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
          <h2>Is the whole instrument ready?</h2>
          <p>
            One view of the guitar, interface, loudness, intentional boosts and
            live processing health. Digital readings cannot judge a physical
            output knob or room loudness.
          </p>
        </div>
        <Button variant="outline" disabled={loading} onClick={load}>
          Refresh checks
        </Button>
      </header>

      {error && (
        <StateNotice kind="error" title="Sound Check could not refresh">
          {error}
        </StateNotice>
      )}
      <Tabs
        className="sound-check-tabs"
        value={view}
        onValueChange={(value) => setView(value as SoundCheckView)}
      >
        <TabsList aria-label="Sound Check sections">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="loudness">Loudness</TabsTrigger>
          <TabsTrigger value="diagnostics">Diagnostics</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <div className="sound-check-tab-panel">
            <div
              className="sound-check-meters"
              role="group"
              aria-label="Live levels"
            >
              <MeterTile
                label="Input"
                value={live ? dbfs(inputPeak) : '—'}
                level={live ? dbToFraction(inputPeak) : null}
                state={!live ? 'idle' : inputClips > 0 ? 'warn' : 'ok'}
                note={live ? `${inputClips} clips` : 'No stream'}
              />
              <MeterTile
                label="Output"
                value={live ? dbfs(outputPeak) : '—'}
                level={live ? dbToFraction(outputPeak) : null}
                state={!live ? 'idle' : outputClips > 0 ? 'warn' : 'ok'}
                note={live ? `${outputClips} clips` : 'No stream'}
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
            <section className="sound-check-fixes" aria-label="Fix next">
              <div className="sound-check-section-heading">
                <h2>Fix next</h2>
                <span>Highest-value checks first</span>
              </div>
              {loading ? (
                <StateNotice
                  kind="loading"
                  title="Reading instrument health…"
                />
              ) : fixes.length ? (
                fixes.slice(0, 5).map((fix) => (
                  <ToolRow
                    key={fix.title}
                    title={fix.title}
                    detail={fix.detail}
                    inline
                  >
                    {fix.action && (
                      <Button variant="outline" onClick={fix.action.run}>
                        {fix.action.label}
                      </Button>
                    )}
                  </ToolRow>
                ))
              ) : (
                <p className="sound-check-clear">
                  <CheckCircle aria-hidden="true" /> No current software
                  warning. Keep listening: this does not replace physical gain,
                  cable, speaker or room checks.
                </p>
              )}
            </section>

            <div className="sound-check-grid">
              <ToolSection
                title="Loudness"
                scope="Reference riff · before intentional Boost"
                label="Preset loudness health"
              >
                <ToolRow
                  title="Target"
                  value={lufs(data.calibration?.target_lufs)}
                  detail={
                    data.coverage
                      ? `${data.coverage.measured} current · ${data.coverage.stale} stale after changes · ${data.coverage.unmeasured} never measured · ${data.coverage.total} total.`
                      : `${entries.length} stored measurements. Refresh checks to scan current Library coverage.`
                  }
                />
                <ToolRow
                  title="Before correction"
                  value={
                    spread == null ? '—' : `${spread.toFixed(1)} LU spread`
                  }
                  detail={
                    loudest && quietest
                      ? `${loudest.name} ${lufs(loudest.lufs)} · ${quietest.name} ${lufs(quietest.lufs)}`
                      : 'Run Even out to build a measured comparison.'
                  }
                />
                <ToolRow
                  title="After correction"
                  value={
                    correctedSpread == null
                      ? '—'
                      : `${correctedSpread.toFixed(1)} LU spread`
                  }
                  detail={
                    loudest && quietest
                      ? `${loudest.name} ${lufs(loudest.lufs + loudest.offset_db)} · ${quietest.name} ${lufs(quietest.lufs + quietest.offset_db)}. Intentional Boost remains on top.`
                      : 'Corrections appear after the first completed Even out run.'
                  }
                >
                  <Button variant="outline" onClick={onLibrary}>
                    Preset library
                  </Button>
                </ToolRow>
              </ToolSection>

              <ToolSection
                title="Guitar"
                scope="Before every rig"
                label="Guitar health"
              >
                <ToolRow
                  title={activeGuitar?.name ?? 'No active profile'}
                  value={db(activeGuitar?.trim_db ?? 0)}
                  detail={
                    activeGuitar
                      ? `Strum ${dbfs(activeGuitar.peak_dbfs)} · noise ${dbfs(activeGuitar.noise_dbfs)}`
                      : 'Choose the instrument currently plugged into the interface.'
                  }
                >
                  <Button variant="outline" onClick={onGuitars}>
                    <Guitar aria-hidden="true" /> Guitar profiles
                  </Button>
                </ToolRow>
                <ToolRow
                  title="Profile health"
                  value={
                    verification === 'current'
                      ? 'Current input verified'
                      : verification === 'stored'
                        ? 'Checked input stored'
                        : verification === 'stale'
                          ? 'Input changed'
                          : verification === 'unverified'
                            ? 'Recheck input'
                            : 'Measurement needed'
                  }
                  detail={`${guitarVerificationDetail(activeGuitar)} Sound Check follows the active profile automatically. Remeasure after changing the physical input-gain knob or the guitar's output level; Oxidal cannot read either control.`}
                />
              </ToolSection>

              <ToolSection
                title="Interface"
                scope="Current digital stream"
                label="Audio interface health"
              >
                <ToolRow
                  title={live ? 'Live' : 'No live stream'}
                  value={
                    monitor?.stream
                      ? `${monitor.stream.input.sample_rate / 1000} kHz`
                      : '—'
                  }
                  detail={
                    monitor?.stream
                      ? `${monitor.stream.input.endpoint} → ${monitor.stream.output.endpoint} · ${monitor.stream.input.period_frames} frames × ${monitor.stream.input.periods}`
                      : 'Select a capture and playback device, then start audio.'
                  }
                >
                  <Button variant="outline" onClick={onAudioSetup}>
                    <SpeakerHigh aria-hidden="true" /> Audio setup
                  </Button>
                </ToolRow>
                <ToolRow
                  title="Input / output peak"
                  value={`${dbfs(inputPeak)} / ${dbfs(outputPeak)}`}
                  detail={`${inputClips} input clips · ${outputClips} output clips in this audio session.`}
                />
                <ToolRow
                  title="Input gain guidance"
                  value={
                    inputClips > 0
                      ? 'Reduce physical gain'
                      : activeGuitar?.peak_dbfs == null
                        ? 'Measure your guitar'
                        : activeGuitar.peak_dbfs > -3
                          ? 'Very little headroom'
                          : activeGuitar.peak_dbfs < -30
                            ? 'Measured level is low'
                            : 'Measured level is usable'
                  }
                  detail={
                    activeGuitar?.peak_dbfs == null
                      ? 'Measure a strong strum. Re-measure whenever the interface input-gain knob changes.'
                      : `Profile strum ${dbfs(activeGuitar.peak_dbfs)} before trim. Re-measure after changing the physical input-gain knob; Oxidal cannot read that knob.`
                  }
                />
                <ToolRow
                  title="Listening volume"
                  value={
                    outputClips > 0
                      ? 'Digital clipping'
                      : 'Physical level unknown'
                  }
                  detail={
                    outputClips > 0
                      ? 'Reduce Boost or master Level before raising any physical output control.'
                      : 'If the digital output is healthy but headphones or speakers are too loud or quiet, adjust the interface, amplifier or speaker controls.'
                  }
                />
              </ToolSection>

              <ToolSection
                title="Processing"
                scope="Audio thread · not total CPU"
                label="Processing health"
              >
                <ToolRow
                  title="DSP p95 / deadline"
                  value={
                    processing.p95 != null
                      ? `${processing.p95.toFixed(0)}%`
                      : '—'
                  }
                  detail={`${processing.peak == null ? 'No session peak' : `${processing.peak.toFixed(0)}% session peak`} · ${monitor?.xruns ?? 0} recovered xruns · ${deadlineMisses} missed deadlines.`}
                >
                  <Pulse aria-hidden="true" className="sound-check-row-icon" />
                </ToolRow>
              </ToolSection>
            </div>

            <ToolSection
              title="Playing level stages"
              scope="Shown separately so correction is not confused with solo Boost"
              label="Playing level stages"
            >
              <div className="sound-check-stages">
                <ToolRow
                  title="Guitar trim"
                  value={db(data.levels?.input_trim_db)}
                  detail="Before the rig; selected by the active guitar profile."
                />
                <ToolRow
                  title="Even out correction"
                  value={db(data.boosts?.calibrated_db)}
                  detail="Measured correction for the sounding preset or scene."
                />
                <ToolRow
                  title="Preset Boost"
                  value={db(presetBoost)}
                  detail={
                    playingKeys[0]
                      ? 'Intentional extra level on the sounding preset.'
                      : 'No sounding preset boost key.'
                  }
                />
                <ToolRow
                  title="Scene Boost"
                  value={db(sceneBoost)}
                  detail={
                    playingKeys[1]
                      ? 'Intentional extra level on the sounding scene.'
                      : 'No separate sounding scene boost.'
                  }
                />
                <ToolRow
                  title="Applied correction + Boost"
                  value={db(data.boosts?.applied_db)}
                  detail="The combined bounded amount currently added before master Level."
                />
                <ToolRow
                  title="Master Level"
                  value={db(data.levels?.output_level_db)}
                  detail="Unit-wide digital output after the rig; not the interface's physical knob."
                />
              </div>
            </ToolSection>
          </div>
        </TabsContent>

        <TabsContent value="loudness">
          <div className="sound-check-tab-panel">
            <div className="sound-check-metrics" aria-label="Loudness summary">
              <div className="sound-check-metric">
                <span>Target</span>
                <strong>{lufs(data.calibration?.target_lufs)}</strong>
                <small>Reference riff, before intentional Boost</small>
              </div>
              <div className="sound-check-metric">
                <span>Before correction</span>
                <strong>
                  {spread == null ? '—' : `${spread.toFixed(1)} LU`}
                </strong>
                <small>Measured loudest-to-quietest spread</small>
              </div>
              <div className="sound-check-metric">
                <span>After correction</span>
                <strong>
                  {correctedSpread == null
                    ? '—'
                    : `${correctedSpread.toFixed(1)} LU`}
                </strong>
                <small>Bounded automatic correction applied</small>
              </div>
            </div>

            {limitedCorrections.length > 0 && (
              <section
                className="sound-check-limit"
                aria-labelledby="sound-check-limit-title"
              >
                <div className="sound-check-limit-heading">
                  <div>
                    <Badge>{limitedCorrections.length} scenes</Badge>
                    <h3 id="sound-check-limit-title">
                      Automatic correction stopped at ±12 dB
                    </h3>
                    <p>
                      This ceiling protects gain structure. These sounds remain
                      farther from the target and need manual preset-level
                      review.
                    </p>
                  </div>
                  <Button variant="outline" onClick={onLibrary}>
                    Preset library
                  </Button>
                </div>
                <details className="sound-check-limit-details">
                  <summary>
                    Show {limitedGroups.length}{' '}
                    {limitedGroups.length === 1 ? 'preset' : 'presets'}
                  </summary>
                  <div className="sound-check-limit-groups">
                    {limitedGroups.map((group) => (
                      <div key={group.preset}>
                        <strong>{group.preset}</strong>
                        <span>
                          {group.scenes
                            .map(
                              (scene) => `${scene.name} (${db(scene.offset)})`,
                            )
                            .join(' · ')}
                        </span>
                      </div>
                    ))}
                  </div>
                </details>
              </section>
            )}

            <EvenOut connected={connected} />
          </div>
        </TabsContent>

        <TabsContent value="diagnostics">
          <div className="sound-check-tab-panel">
            <div className="sound-check-diagnostics-heading">
              <h2>Live diagnostics &amp; history</h2>
              <p>
                Detailed meters, recent charts, retained device history and the
                redacted control audit remain available for investigation.
              </p>
            </div>
            <Monitoring displayMode={displayMode} />
          </div>
        </TabsContent>
      </Tabs>
    </section>
  );
}

/** Map a dBFS peak onto a 0–1 meter, −60 dB to 0 dB. */
function dbToFraction(db: number | null) {
  if (db == null || !Number.isFinite(db)) return 0;
  return Math.max(0, Math.min(1, (db + 60) / 60));
}

/** One at-a-glance reading: a name, a big value, a bar and a status LED. */
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
    <div className="meter-tile" data-state={state}>
      <span className="meter-tile-label">
        <i className="meter-tile-led" aria-hidden="true" />
        {label}
      </span>
      <strong className="meter-tile-value">{value}</strong>
      {level != null && (
        <span
          className="meter-tile-bar"
          role="meter"
          aria-label={`${label} level`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(level * 100)}
        >
          <span style={{ width: `${Math.round(level * 100)}%` }} />
        </span>
      )}
      <span className="meter-tile-note">{note}</span>
    </div>
  );
}
