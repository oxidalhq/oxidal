import { Play, Record, Stop } from '@phosphor-icons/react';
import { useCallback, useEffect, useState } from 'react';

import { Button } from '@oxidal/design-system/components/button';
import { DialogFooter } from '@oxidal/design-system/components/dialog';

import { AdjustmentDialog } from '../../AdjustmentDialog';
import {
  type CaptureJob,
  captureState,
  type MediaAsset,
  type ReampRequest,
  recordDi,
  startReamp,
  stopCapture,
  wavPath,
} from '../../api';
import { deviceSentence } from '../../lib/friendlyError';
import { formatTime } from '../../lib/playerClock';
import { MediaRow, type MenuItem } from './MediaRow';
import {
  channelsLabel,
  durationOf,
  PROTECT_REASON,
  useProtect,
  useSessionMedia,
} from './sessionMedia';
import { DeleteDialog, RenameDialog } from './TrackDialogs';

/** Keeps the current or last job in view; jobs outlive a closed page. */
function useCaptureJob(): [CaptureJob | null, () => void] {
  const [job, setJob] = useState<CaptureJob | null>(null);
  const refresh = useCallback(() => {
    captureState()
      .then((state) => setJob(state.job ?? null))
      .catch(() => {});
  }, []);
  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, 1000);
    return () => window.clearInterval(timer);
  }, [refresh]);
  return [job, refresh];
}

const active = (job: CaptureJob | null) =>
  !!job && ['starting', 'running', 'finishing'].includes(job.phase);

/**
 * Library ▸ DI and reamps: record the raw guitar on the device, reamp a DI
 * through the rig that is playing now, and play or download the results.
 * @see docs/media.md
 */
export function DiReamps({ connected }: { connected: boolean }) {
  const media = useSessionMedia();
  const { library, player, send, refreshLibrary } = media;
  const protect = useProtect();
  const [job, refresh] = useCaptureJob();
  const [error, setError] = useState('');
  const [reamp, setReamp] = useState<MediaAsset | null>(null);
  const [dialog, setDialog] = useState<{
    kind: 'rename' | 'delete';
    asset: MediaAsset;
  } | null>(null);
  const assets = (library?.assets ?? []).filter(
    (asset) => asset.kind !== 'backing',
  );
  const running = active(job);
  const locked = protect || !connected || running;
  const space = library?.space;
  const minutes = space
    ? Math.max(0, space.availableBytes - space.reserveBytes) / (48_000 * 4 * 60)
    : null;

  useEffect(() => {
    if (job && !active(job)) refreshLibrary();
  }, [job?.phase, job, refreshLibrary]);

  async function act(work: () => Promise<unknown>, what: string) {
    setError('');
    try {
      await work();
      refresh();
    } catch (cause) {
      setError(deviceSentence(cause, what));
    }
  }
  async function play(asset: MediaAsset) {
    setError('');
    if (player?.track?.id !== asset.id) {
      const cued = await send({ kind: 'cue', asset: asset.id });
      if (!cued) return;
    }
    await send({ kind: 'play' });
  }

  return (
    <section className="media-backing" aria-label="DI and reamps">
      <div className="media-section-head">
        <div>
          <h2>DI and reamps</h2>
          <p className="caption">
            Record the raw guitar, then reamp it through any sound later.
          </p>
        </div>
      </div>
      {protect && <p className="caption">{PROTECT_REASON}</p>}
      <div className="media-card" aria-label="Record DI">
        {job && running ? (
          <JobRunning
            job={job}
            onStop={(keep) =>
              void act(() => stopCapture(keep), 'stop the recording')
            }
          />
        ) : (
          <>
            <p className="caption">
              Records the raw guitar before trim, gate and effects. You’ll hear
              your current rig while recording.
              {minutes !== null &&
                ` Space for about ${Math.floor(minutes / 60)} h ${Math.floor(minutes % 60)} min.`}
            </p>
            <Button
              disabled={protect || !connected}
              onClick={() => void act(recordDi, 'start recording')}
            >
              <Record aria-hidden="true" weight="fill" />
              Record DI
            </Button>
          </>
        )}
        {job && !running && <JobResult job={job} />}
      </div>
      {error && (
        <p role="alert" className="media-note">
          {error}
        </p>
      )}
      {library && !assets.length ? (
        <p className="caption">No DI recordings or reamps yet.</p>
      ) : (
        <ol className="media-rows" aria-label="DI and reamps">
          {assets.map((asset, index) => {
            const cued = player?.track?.id === asset.id;
            const playing = cued && player?.state === 'playing';
            const menu: MenuItem[] = [
              {
                label: 'Reamp…',
                disabled: locked,
                onSelect: () => setReamp(asset),
              },
              {
                label: 'Rename',
                disabled: locked,
                onSelect: () => setDialog({ kind: 'rename', asset }),
              },
              'separator',
              {
                label: 'Download WAV',
                href: wavPath(asset.id),
                download: true,
              },
              {
                label: 'Delete…',
                disabled: locked,
                onSelect: () => setDialog({ kind: 'delete', asset }),
              },
            ];
            const incomplete = asset.provenance?.complete === false;
            return (
              <MediaRow
                key={asset.id}
                num={index + 1}
                name={asset.title}
                cued={cued}
                sub={[
                  asset.kind === 'di' ? 'DI' : 'Reamp',
                  formatTime(durationOf(asset)),
                  channelsLabel(asset.renders[0]?.channels ?? 1),
                  incomplete ? 'Incomplete' : '',
                ]
                  .filter(Boolean)
                  .join(' · ')}
                actions={
                  playing ? (
                    <Button
                      variant="outline"
                      aria-label={`Pause ${asset.title}`}
                      onClick={() => void send({ kind: 'pause' })}
                    >
                      Pause
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      aria-label={`Play ${asset.title}`}
                      disabled={!connected || running}
                      onClick={() => void play(asset)}
                    >
                      <Play aria-hidden="true" weight="fill" />
                      Play
                    </Button>
                  )
                }
                menu={menu}
              />
            );
          })}
        </ol>
      )}
      {reamp && (
        <ReampDialog
          asset={reamp}
          onClose={() => setReamp(null)}
          onStart={async (request) => {
            await startReamp(request);
            refresh();
          }}
        />
      )}
      {dialog?.kind === 'rename' && (
        <RenameDialog asset={dialog.asset} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === 'delete' && (
        <DeleteDialog asset={dialog.asset} onClose={() => setDialog(null)} />
      )}
    </section>
  );
}

function JobRunning({
  job,
  onStop,
}: {
  job: CaptureJob;
  onStop: (keep: boolean) => void;
}) {
  const elapsed = formatTime(job.frames / job.rate);
  if (job.kind === 'di')
    return (
      <div className="media-job" role="status">
        <span>
          ● Recording {elapsed} · input peak {Math.round(job.peakDbfs)} dBFS
        </span>
        <Button onClick={() => onStop(true)}>
          <Stop aria-hidden="true" weight="fill" />
          Stop recording
        </Button>
      </div>
    );
  const total = formatTime((job.totalFrames ?? job.frames) / job.rate);
  return (
    <div className="media-job" role="status">
      <span>
        Reamping {elapsed} / {total}
        {job.monitoring ? '' : ' · outputs muted'}
      </span>
      <Button onClick={() => onStop(true)}>Stop and keep</Button>
      <Button variant="outline" onClick={() => onStop(false)}>
        Cancel
      </Button>
    </div>
  );
}

function JobResult({ job }: { job: CaptureJob }) {
  const length = formatTime(job.frames / job.rate);
  if (job.phase === 'cancelled')
    return <p className="caption">Cancelled. Nothing was saved.</p>;
  if (job.phase === 'failed')
    return (
      <p role="alert" className="media-note">
        {job.reason ?? 'The job failed.'}
        {job.asset ? ' Partial result kept.' : ''}
      </p>
    );
  return (
    <p className="caption" role="status">
      “{job.title}” saved ({length}
      {job.kind === 'di' ? ', mono' : ''}){job.incomplete ? ', incomplete' : ''}
      .{job.kind === 'reamp' ? ' Your live guitar is back.' : ''}
      {job.reason ? ` ${job.reason}.` : ''}
    </p>
  );
}

/** Review before a reamp: input processing has no default (applied once). */
export function ReampDialog({
  asset,
  onClose,
  onStart,
}: {
  asset: MediaAsset;
  onClose: () => void;
  onStart: (request: ReampRequest) => Promise<void>;
}) {
  const channels = asset.renders[0]?.channels ?? 1;
  const [channel, setChannel] = useState<number | null>(
    channels === 1 ? 0 : null,
  );
  const [processing, setProcessing] = useState<
    ReampRequest['processing'] | null
  >(null);
  const [tail, setTail] = useState(2);
  const [monitoring, setMonitoring] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const lossy =
    asset.provenance === null && asset.source?.lossy
      ? 'Lossy DI; results may differ from the original performance.'
      : '';
  const ready = processing !== null && channel !== null && !busy;
  async function start() {
    if (processing === null || channel === null) return;
    setBusy(true);
    setError('');
    try {
      await onStart({
        source: asset.id,
        channel,
        processing,
        tailSeconds: tail,
        monitoring,
      });
      onClose();
    } catch (cause) {
      setError(deviceSentence(cause, 'start the reamp'));
      setBusy(false);
    }
  }
  return (
    <AdjustmentDialog title={`Reamp “${asset.title}”`} onCancel={onClose}>
      <form
        className="media-dialog-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (ready) void start();
        }}
      >
        <p className="caption">
          {channelsLabel(channels)} · {formatTime(durationOf(asset))}
          {lossy && ` · ${lossy}`}
        </p>
        {channels > 1 && (
          <fieldset>
            <legend>Channel</legend>
            {['Left', 'Right'].map((label, index) => (
              <label key={label}>
                <input
                  type="radio"
                  name="channel"
                  checked={channel === index}
                  onChange={() => setChannel(index)}
                />{' '}
                {label}
              </label>
            ))}
          </fieldset>
        )}
        <fieldset>
          <legend>Input processing</legend>
          <label>
            <input
              type="radio"
              name="processing"
              checked={processing === 'current'}
              onChange={() => setProcessing('current')}
            />{' '}
            Current input trim and gate
          </label>
          <label>
            <input
              type="radio"
              name="processing"
              checked={processing === 'none'}
              onChange={() => setProcessing('none')}
            />{' '}
            None (already level-matched)
          </label>
        </fieldset>
        <label className="field">
          Tail
          <select
            value={tail}
            onChange={(event) => setTail(Number(event.target.value))}
          >
            {[0, 1, 2, 5, 10].map((seconds) => (
              <option key={seconds} value={seconds}>
                {seconds} s
              </option>
            ))}
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            checked={monitoring}
            onChange={(event) => setMonitoring(event.target.checked)}
          />{' '}
          Hear it while it runs
        </label>
        <p className="caption">
          Runs through the preset and scene playing now. Live guitar is replaced
          while this runs; your rig comes back after.
        </p>
        {error && <p role="alert">{error}</p>}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={!ready}>
            Start reamp
          </Button>
        </DialogFooter>
      </form>
    </AdjustmentDialog>
  );
}
