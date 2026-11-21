import { DownloadSimple, Stop, Warning } from '@phosphor-icons/react';
import { type CSSProperties, useRef, useState } from 'react';

import { Button } from '@oxidal/design-system/components/button';

import { AdjustmentDialog } from '../../AdjustmentDialog';
import { type MediaAsset, originalPath, updateAsset } from '../../api';
import { deviceSentence } from '../../lib/friendlyError';
import { formatDb, formatTime } from '../../lib/playerClock';
import { PerformanceTempo } from './PerformanceTempo';
import { PositionBar } from './PositionBar';
import { PracticeControls } from './PracticeControls';
import {
  channelsLabel,
  durationOf,
  fileSize,
  formatLabel,
  nextUp,
  PROTECT_REASON,
  stateWord,
  usePlayerPosition,
  useProtect,
  useSessionMedia,
} from './sessionMedia';
import { StateChip } from './StateChip';
import { StemMixEditor } from './StemMixEditor';
import { LiveStemsPanel } from './StemMixer';
import { DeleteDialog, RenameDialog } from './TrackDialogs';
import { FullTransport } from './TransportBar';

const LEVEL_MIN = -60;
const LEVEL_MAX = 6;

/** The device's words for a stopped or unplayable track, and refusals. */
function Banner() {
  const { shown, player, refusal, notice } = useSessionMedia();
  const { at } = usePlayerPosition();
  const lines: string[] = [];
  if (shown === 'interrupted')
    lines.push(
      `Stopped by an audio restart at ${formatTime(at)}. Nothing plays until you press Resume.`,
    );
  if (shown === 'stalled')
    lines.push(
      'Playback stalled: storage is slow. It carries on when data arrives.',
    );
  if (shown === 'unavailable')
    lines.push(
      `Not playable yet: ${player?.reason ?? 'the track is not ready'}`,
    );
  else if (player?.reason && shown !== 'interrupted') lines.push(player.reason);
  if (notice) lines.push(notice);
  return (
    <>
      {lines.map((line) => (
        <p key={line} className="media-note">
          {shown !== 'ready' && <Warning aria-hidden="true" weight="bold" />}
          <span>{line}</span>
        </p>
      ))}
      {refusal && (
        <p className="media-note" role="alert">
          <Warning aria-hidden="true" weight="bold" />
          <span>{refusal}</span>
        </p>
      )}
    </>
  );
}

/**
 * Player level, −60 to +6 dB. Moves are sent as they happen; while one is in
 * flight only the newest waits. E-paper uses −/+ steps of 1 dB.
 */
function PlayerLevel() {
  const { player, slow, send } = useSessionMedia();
  const [local, setLocal] = useState<number | null>(null);
  const sending = useRef(false);
  const waiting = useRef<number | null>(null);
  const device = player?.levelDb ?? -6;
  const db = local ?? device;
  async function change(next: number) {
    const value = Math.min(LEVEL_MAX, Math.max(LEVEL_MIN, Math.round(next)));
    setLocal(value);
    if (sending.current) {
      waiting.current = value;
      return;
    }
    sending.current = true;
    let pending: number | null = value;
    while (pending !== null) {
      waiting.current = null;
      await send({ kind: 'set_level', db: pending });
      pending = waiting.current;
    }
    sending.current = false;
    setLocal(null);
  }
  if (slow)
    return (
      <div className="media-level" role="group" aria-label="Level">
        <strong>Level</strong>
        <output>{formatDb(db)}</output>
        <Button
          variant="outline"
          size="icon"
          aria-label="Lower level"
          disabled={db <= LEVEL_MIN}
          onClick={() => void change(db - 1)}
        >
          −
        </Button>
        <Button
          variant="outline"
          size="icon"
          aria-label="Raise level"
          disabled={db >= LEVEL_MAX}
          onClick={() => void change(db + 1)}
        >
          +
        </Button>
      </div>
    );
  return (
    <div className="media-level">
      <label htmlFor="media-level">
        <strong>Level</strong>
      </label>
      <input
        id="media-level"
        className="ink-range"
        type="range"
        min={LEVEL_MIN}
        max={LEVEL_MAX}
        step={1}
        value={db}
        aria-valuetext={formatDb(db)}
        style={
          {
            '--level': (db - LEVEL_MIN) / (LEVEL_MAX - LEVEL_MIN),
          } as CSSProperties
        }
        onChange={(event) => void change(Number(event.target.value))}
      />
      <output htmlFor="media-level">{formatDb(db)}</output>
    </div>
  );
}

function FullPlayer({ onClose }: { onClose: () => void }) {
  const media = useSessionMedia();
  const { player, shown, muted, slow, tracks, send, pending } = media;
  const { at, length } = usePlayerPosition();
  const track = player?.track;
  const asset = tracks.find((t) => t.id === track?.id);
  const upNext = nextUp(player, tracks);
  return (
    <AdjustmentDialog
      title="Backing player"
      onCancel={onClose}
      className="media-sheet"
    >
      <PerformanceTempo />
      {!track || shown === 'empty' ? (
        <div className="media-sheet-body">
          <p>No track cued.</p>
          <Button onClick={() => media.setSheet({ kind: 'list' })}>
            Choose track
          </Button>
        </div>
      ) : (
        <div className="media-sheet-body" data-slow={slow || undefined}>
          <div>
            <p className="media-sheet-title">{track.title}</p>
            <p className="caption">
              {[
                channelsLabel(track.channels),
                asset ? formatLabel(asset) : null,
                formatTime(length),
                stateWord[shown],
              ]
                .filter(Boolean)
                .join(' · ')}
              {muted && (
                <>
                  {' · '}
                  <strong>Output muted</strong>
                </>
              )}
            </p>
          </div>
          <Banner />
          {slow ? (
            <p className="media-slow-position">
              <strong>{stateWord[shown].toUpperCase()}</strong> · Position{' '}
              <span className="media-mono">{formatTime(at)}</span> of{' '}
              {formatTime(length)}{' '}
              <span className="caption">(updates every second)</span>
            </p>
          ) : (
            <PositionBar disabled={shown === 'unavailable'} />
          )}
          <FullTransport />
          <Button
            variant="outline"
            className="media-wide"
            aria-busy={pending || undefined}
            disabled={shown === 'ready'}
            onClick={() => void send({ kind: 'stop' })}
          >
            <Stop aria-hidden="true" weight="fill" />
            Stop track
          </Button>
          <PlayerLevel />
          <LiveStemsPanel />
          <PracticeControls key={track.id} />
          <div className="media-repeat" role="group" aria-label="Repeat">
            <strong aria-hidden="true">Repeat</strong>
            <div className="segmented">
              {(
                [
                  [false, 'Off'],
                  [true, 'Track'],
                ] as const
              ).map(([repeat, label]) => (
                <Button
                  key={label}
                  variant="outline"
                  aria-pressed={player.repeat === repeat}
                  aria-label={`Repeat ${label}`}
                  onClick={() => void send({ kind: 'set_repeat', repeat })}
                >
                  {label}
                </Button>
              ))}
            </div>
          </div>
          <p>
            Next up:{' '}
            <strong>
              {upNext ? upNext.title : 'none, this is the last track'}
            </strong>
          </p>
          <div className="media-actions">
            <Button
              variant="outline"
              onClick={() => media.setSheet({ kind: 'list' })}
            >
              Backing list
            </Button>
            <Button
              variant="outline"
              disabled={!asset}
              onClick={() =>
                media.setSheet({ kind: 'details', asset: track.id })
              }
            >
              Details
            </Button>
          </div>
          <p className="caption">
            Plays over your guitar from the device, so it keeps going if you
            close this page. Preset changes don&apos;t affect it.
          </p>
        </div>
      )}
    </AdjustmentDialog>
  );
}

function BackingList({ onClose }: { onClose: () => void }) {
  const media = useSessionMedia();
  const { player, tracks, send } = media;
  return (
    <AdjustmentDialog
      title="Backing list"
      onCancel={onClose}
      className="media-sheet media-list-sheet"
    >
      <div className="media-sheet-body">
        {tracks.length ? (
          <ol className="media-rows" aria-label="Backing list">
            {tracks.map((track, index) => {
              const cued = player?.track?.id === track.id;
              return (
                <li
                  key={track.id}
                  className="media-row"
                  data-cued={cued || undefined}
                >
                  <span className="media-row-num">{index + 1}</span>
                  <div className="media-row-main">
                    <span className="media-row-name">{track.title}</span>
                    <span className="media-row-sub">
                      {formatTime(durationOf(track))}
                    </span>
                  </div>
                  <div className="media-row-actions">
                    {cued ? (
                      <StateChip state="cued" />
                    ) : (
                      <Button
                        variant="outline"
                        aria-label={`Cue ${track.title}`}
                        onClick={() =>
                          void send({ kind: 'cue', asset: track.id }).then(
                            (ok) => ok && media.setSheet({ kind: 'player' }),
                          )
                        }
                      >
                        Cue
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        ) : (
          <p>No backing tracks yet. Import a WAV or MP3 in Library.</p>
        )}
        {media.refusal && <p role="alert">{media.refusal}</p>}
        <p className="caption">
          Cue fades out the current track and cues the one you pick, stopped.
        </p>
        <Button
          variant="outline"
          onClick={() => {
            media.setSheet(null);
            window.location.hash = 'library/backing';
          }}
        >
          Edit order in Library
        </Button>
      </div>
    </AdjustmentDialog>
  );
}

/** Format, rate, length, loudness and trim; rename, download and delete. */
function TrackDetails({
  asset,
  onClose,
}: {
  asset: MediaAsset;
  onClose: () => void;
}) {
  const media = useSessionMedia();
  const protect = useProtect();
  const [trim, setTrim] = useState(String(asset.playback?.trim_db ?? 0));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [dialog, setDialog] = useState<'rename' | 'delete' | null>(null);
  const saved = asset.playback?.trim_db ?? 0;
  const source = asset.source;
  const render = asset.renders[0];
  const cued = media.player?.track?.id === asset.id;
  const value = Number(trim);
  const valid = trim.trim() !== '' && value >= -24 && value <= 6;
  async function saveTrim() {
    setSaving(true);
    setError('');
    try {
      await updateAsset(asset.id, { trimDb: value });
      media.refreshLibrary();
    } catch (cause) {
      setError(deviceSentence(cause, 'change the track trim'));
    } finally {
      setSaving(false);
    }
  }
  if (dialog === 'rename')
    return <RenameDialog asset={asset} onClose={() => setDialog(null)} />;
  if (dialog === 'delete')
    return <DeleteDialog asset={asset} onClose={onClose} />;
  return (
    <AdjustmentDialog
      title={`${asset.title} · Details`}
      onCancel={onClose}
      className="media-sheet"
    >
      <div className="media-sheet-body">
        <dl className="media-facts">
          {source && (
            <>
              <dt>File</dt>
              <dd>
                {formatLabel(asset)} · {fileSize(source.bytes)} · {source.codec}
                {source.lossy ? ' · lossy' : ''}
              </dd>
              <dt>Source</dt>
              <dd>
                {(source.rate / 1000).toFixed(1)} kHz ·{' '}
                {channelsLabel(source.channels).toLowerCase()} ·{' '}
                {formatTime(source.rate ? source.frames / source.rate : 0)}
              </dd>
            </>
          )}
          {render && (
            <>
              <dt>Prepared</dt>
              <dd>
                {asset.renders
                  .map(
                    (r) =>
                      `${(r.rate / 1000).toFixed(r.rate % 1000 ? 1 : 0)} kHz float · ${fileSize(r.frames * r.channels * 4)}`,
                  )
                  .join('; ')}{' '}
                · ready
              </dd>
              {render.loudness_lufs != null && (
                <>
                  <dt>Loudness</dt>
                  <dd>
                    {render.loudness_lufs.toFixed(1)} LUFS
                    {render.peak_dbfs != null &&
                      ` · peak ${render.peak_dbfs.toFixed(1)} dBFS`}
                  </dd>
                </>
              )}
            </>
          )}
          <dt>Played</dt>
          <dd>
            Underruns this session: {cued ? (media.player?.underruns ?? 0) : 0}
          </dd>
        </dl>
        <div className="media-trim">
          <label className="field">
            Track trim (dB)
            <input
              type="number"
              inputMode="decimal"
              min={-24}
              max={6}
              step={0.1}
              value={trim}
              disabled={protect || saving}
              aria-describedby="media-trim-help"
              onChange={(event) => setTrim(event.target.value)}
            />
          </label>
          <Button
            variant="outline"
            disabled={protect || saving || !valid || value === saved}
            onClick={() => void saveTrim()}
          >
            Save trim
          </Button>
          <p id="media-trim-help" className="caption">
            Set at import to match −18 LUFS. −24 to +6 dB.
          </p>
        </div>
        {protect && <p className="caption">{PROTECT_REASON}</p>}
        {error && <p role="alert">{error}</p>}
        <div className="media-actions">
          <Button
            variant="outline"
            disabled={protect}
            onClick={() => setDialog('rename')}
          >
            Rename
          </Button>
          <Button variant="outline" asChild>
            <a href={originalPath(asset.id)} download>
              <DownloadSimple aria-hidden="true" />
              Download original
            </a>
          </Button>
          <Button
            variant="outline"
            disabled={protect}
            onClick={() => setDialog('delete')}
          >
            Delete…
          </Button>
        </div>
      </div>
    </AdjustmentDialog>
  );
}

/**
 * The player's overlays, shown over whatever page is open: the full player
 * (right-side sheet on desktop, centred on tablets, full screen on phones),
 * the Backing list picker and a track's details. Closing returns to the page.
 * @see docs/media.md
 */
function StemsSheet({
  sheet,
  onClose,
}: {
  sheet: { source: string; mix?: string };
  onClose: () => void;
}) {
  const { tracks } = useSessionMedia();
  const protect = useProtect();
  const source = tracks.find((track) => track.id === sheet.source);
  return source ? (
    <StemMixEditor
      key={`${source.id}:${sheet.mix ?? ''}`}
      source={source}
      initialMix={sheet.mix}
      locked={protect}
      onClose={onClose}
    />
  ) : null;
}

export function MediaSheets() {
  const media = useSessionMedia();
  const { sheet, tracks } = media;
  const close = () => {
    media.clearRefusal();
    media.setSheet(null);
  };
  if (!media.ready || !sheet) return null;
  if (sheet.kind === 'player') return <FullPlayer onClose={close} />;
  if (sheet.kind === 'list') return <BackingList onClose={close} />;
  if (sheet.kind === 'stems')
    return <StemsSheet sheet={sheet} onClose={close} />;
  const asset = tracks.find((track) => track.id === sheet.asset);
  // A new stored trim (from here or another client) starts the form afresh.
  return asset ? (
    <TrackDetails
      key={`${asset.id}:${asset.playback?.trim_db ?? 0}`}
      asset={asset}
      onClose={close}
    />
  ) : null;
}
