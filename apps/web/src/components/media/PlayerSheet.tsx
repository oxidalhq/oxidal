import { DownloadSimple, Stop, Warning } from '@phosphor-icons/react';
import { useRef, useState } from 'react';

import { Button } from '@oxidal/design-system/components/button';
import { FormField } from '@oxidal/design-system/components/form-layout';
import { Slider } from '@oxidal/design-system/components/slider';
import { Caption } from '@oxidal/design-system/components/text';

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
        <p
          key={line}
          className="flex min-w-0 flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-3 text-sm [&>svg]:size-4 [&>svg]:shrink-0"
        >
          {shown !== 'ready' && <Warning aria-hidden="true" weight="bold" />}
          <span>{line}</span>
        </p>
      ))}
      {refusal && (
        <p
          className="flex min-w-0 flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-3 text-sm [&>svg]:size-4 [&>svg]:shrink-0"
          role="alert"
        >
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
      <div
        className="flex min-w-0 flex-wrap items-center gap-2 [&>output]:min-w-14 [&>output]:font-mono [&>output]:text-sm"
        role="group"
        aria-label="Level"
      >
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
    <Slider
      label="Level"
      min={LEVEL_MIN}
      max={LEVEL_MAX}
      step={1}
      value={[db]}
      aria-valuetext={formatDb(db)}
      readout={formatDb(db)}
      onValueChange={([next]) => void change(next!)}
    />
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
    <AdjustmentDialog title="Backing player" onCancel={onClose} sideSheet>
      <PerformanceTempo />
      {!track || shown === 'empty' ? (
        <div className="grid min-w-0 content-start gap-3">
          <p>No track cued.</p>
          <Button onClick={() => media.setSheet({ kind: 'list' })}>
            Choose track
          </Button>
        </div>
      ) : (
        <div
          className="grid min-w-0 content-start gap-3"
          data-slow={slow || undefined}
        >
          <div>
            <p className="m-0 text-lg font-semibold break-words">
              {track.title}
            </p>
            <Caption>
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
            </Caption>
          </div>
          <Banner />
          {slow ? (
            <p className="media-slow-position">
              <strong>{stateWord[shown].toUpperCase()}</strong> · Position{' '}
              <span className="font-mono text-sm whitespace-nowrap tabular-nums">
                {formatTime(at)}
              </span>{' '}
              of {formatTime(length)}{' '}
              <Caption as="span">(updates every second)</Caption>
            </p>
          ) : (
            <PositionBar
              key={`position-${track.id}`}
              disabled={shown === 'unavailable'}
            />
          )}
          <FullTransport />
          <Button
            variant="outline"
            className="w-full"
            aria-busy={pending || undefined}
            disabled={shown === 'ready'}
            onClick={() => void send({ kind: 'stop' })}
          >
            <Stop aria-hidden="true" weight="fill" />
            Stop track
          </Button>
          <PlayerLevel />
          <LiveStemsPanel />
          <PracticeControls key={`practice-${track.id}`} />
          <div
            className="flex min-w-0 flex-wrap items-center gap-1"
            role="group"
            aria-label="Repeat"
          >
            <strong aria-hidden="true">Repeat</strong>
            <div className="flex flex-wrap gap-1.5">
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
          <div className="flex min-w-0 flex-wrap items-center gap-2">
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
          <Caption>
            Plays over your guitar from the device, so it keeps going if you
            close this page. Preset changes don&apos;t affect it.
          </Caption>
        </div>
      )}
    </AdjustmentDialog>
  );
}

function BackingList({ onClose }: { onClose: () => void }) {
  const media = useSessionMedia();
  const { player, tracks, send } = media;
  return (
    <AdjustmentDialog title="Backing list" onCancel={onClose} sideSheet>
      <div className="grid min-w-0 content-start gap-3">
        {tracks.length ? (
          <ol
            className="m-0 grid min-w-0 list-none divide-y divide-border border-y border-border p-0"
            aria-label="Backing list"
          >
            {tracks.map((track, index) => {
              const cued = player?.track?.id === track.id;
              return (
                <li
                  key={track.id}
                  className="group relative grid min-w-0 grid-cols-[1.5rem_minmax(0,1fr)] items-center gap-x-2 gap-y-1 px-2 py-3 data-[cued]:bg-secondary min-[600px]:grid-cols-[2rem_minmax(0,1fr)_auto] [&>:last-child]:max-[599px]:col-start-2"
                  data-cued={cued || undefined}
                >
                  <span className="self-start pt-0.5 text-center font-mono text-xs text-muted-foreground tabular-nums">
                    {index + 1}
                  </span>
                  <div className="grid min-w-0 gap-0.5">
                    <span className="text-sm font-semibold break-words">
                      {track.title}
                    </span>
                    <span className="min-w-0 text-xs break-words text-muted-foreground">
                      {formatTime(durationOf(track))}
                    </span>
                  </div>
                  <div className="flex min-w-0 flex-wrap items-center gap-1 min-[600px]:justify-end">
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
        <Caption>
          Cue fades out the current track and cues the one you pick, stopped.
        </Caption>
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
      sideSheet
    >
      <div className="grid min-w-0 content-start gap-3">
        <dl className="m-0 grid min-w-0 grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm [&>dd]:m-0 [&>dd]:break-words [&>dt]:text-muted-foreground">
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
        <div className="grid min-w-0 grid-cols-[minmax(0,9rem)_auto] items-end gap-2 [&_[data-slot=caption]]:col-span-full">
          <FormField>
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
          </FormField>
          <Button
            variant="outline"
            disabled={protect || saving || !valid || value === saved}
            onClick={() => void saveTrim()}
          >
            Save trim
          </Button>
          <Caption id="media-trim-help">
            Set at import to match −18 LUFS. −24 to +6 dB.
          </Caption>
        </div>
        {protect && <Caption>{PROTECT_REASON}</Caption>}
        {error && <p role="alert">{error}</p>}
        <div className="flex min-w-0 flex-wrap items-center gap-2">
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
