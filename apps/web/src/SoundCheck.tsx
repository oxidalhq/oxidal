import { useCallback, useEffect, useMemo, useState } from 'react';
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
  guitarProfiles,
  unitLevels,
  type BoostState,
  type CalibrationState,
  type GuitarProfiles,
  type UnitLevels,
} from './api';
import { Badge } from './components/ui/badge';
import { Button } from './components/ui/button';
import { EvenOut } from './EvenOut';
import { Monitoring } from './Monitoring';
import { useMonitorFeed } from './monitorFeed';
import { processingHeadroom } from './processingHeadroom';
import { ToolRow, ToolSection } from './ToolRow';
import './SoundCheck.css';

type HealthData = {
  calibration: CalibrationState | null;
  boosts: BoostState | null;
  guitars: GuitarProfiles | null;
  levels: UnitLevels | null;
};

type Fix = {
  title: string;
  detail: string;
  action?: { label: string; run: () => void };
};

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
}: {
  connected: boolean;
  displayMode: string;
  onAudioSetup: () => void;
  onGuitars: () => void;
}) {
  const [data, setData] = useState<HealthData>({
    calibration: null,
    boosts: null,
    guitars: null,
    levels: null,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
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
        boosts: results[1].status === 'fulfilled' ? results[1].value : null,
        guitars: results[2].status === 'fulfilled' ? results[2].value : null,
        levels: results[3].status === 'fulfilled' ? results[3].value : null,
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
  const activeGuitar = data.guitars?.guitars.find(
    (guitar) => guitar.id === data.guitars?.active,
  );
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

      {error && <p role="alert">{error}</p>}
      <section className="sound-check-fixes" aria-label="Fix next">
        <div className="sound-check-section-heading">
          <h2>Fix next</h2>
          <span>Highest-value checks first</span>
        </div>
        {loading ? (
          <p role="status">Reading instrument health…</p>
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
            <CheckCircle aria-hidden="true" /> No current software warning. Keep
            listening: this does not replace physical gain, cable, speaker or
            room checks.
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
            detail={`${entries.length} measured presets and scenes.`}
          />
          <ToolRow
            title="Loudest / quietest"
            value={spread == null ? '—' : `${spread.toFixed(1)} LU spread`}
            detail={
              loudest && quietest
                ? `${loudest.name} ${lufs(loudest.lufs)} · ${quietest.name} ${lufs(quietest.lufs)}`
                : 'Run Even out to build a measured comparison.'
            }
          />
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
              activeGuitar?.peak_dbfs != null && activeGuitar.noise_dbfs != null
                ? 'Checked automatically'
                : 'Measurement needed'
            }
            detail="Sound Check follows the active profile automatically. Measure each guitar once; remeasure after changing interface, input, physical gain or the guitar's output level."
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
              outputClips > 0 ? 'Digital clipping' : 'Physical level unknown'
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
              processing.p95 != null ? `${processing.p95.toFixed(0)}%` : '—'
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

      <EvenOut connected={connected} />

      <div className="sound-check-diagnostics-heading">
        <h2>Live diagnostics & history</h2>
        <p>
          Detailed meters, recent charts, retained device history and the
          redacted control audit remain available for investigation.
        </p>
      </div>
      <Monitoring displayMode={displayMode} />
    </section>
  );
}
