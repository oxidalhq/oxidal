import { Play } from '@phosphor-icons/react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { Button } from '@oxidal/design-system/components/button';
import { DialogFooter } from '@oxidal/design-system/components/dialog';
import { FormField } from '@oxidal/design-system/components/form-layout';
import { Caption } from '@oxidal/design-system/components/text';
import { RecordDiToggle } from '@oxidal/design-system/patterns/device-flows';

import { AdjustmentDialog } from '../../AdjustmentDialog';
import {
  type CaptureJob,
  type CaptureState,
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
import type { MenuItem } from '../RowMenu';
import { MediaRow } from './MediaRow';
import {
  channelsLabel,
  durationOf,
  PROTECT_REASON,
  useProtect,
  useSessionMedia,
} from './sessionMedia';
import { DeleteDialog, RenameDialog } from './TrackDialogs';

/** Keeps the current or last job in view; jobs outlive a closed page. */
function useCaptureJob() {
  const [job, setJob] = useState<CaptureJob | null>(null);
  const generation = useRef(0);
  const [ready, setReady] = useState(false);
  const apply = useCallback((next: CaptureState) => {
    ++generation.current;
    setReady(true);
    setJob(next.job ?? null);
  }, []);
  useEffect(() => {
    let mounted = true;
    let pending = false;
    const refresh = async () => {
      if (pending) return;
      pending = true;
      const sequence = ++generation.current;
      try {
        const next = await captureState();
        if (mounted && sequence === generation.current) apply(next);
      } catch {
        // Keep the most recent confirmed job until the device responds.
      } finally {
        pending = false;
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 1000);
    return () => {
      mounted = false;
      window.clearInterval(timer);
    };
  }, [apply]);
  return { job, apply, ready };
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
  const { job, apply, ready } = useCaptureJob();
  const [busy, setBusy] = useState(false);
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
  const locked = protect || !connected || running || busy;
  const space = library?.space;
  const minutes = space
    ? Math.max(0, space.availableBytes - space.reserveBytes) / (48_000 * 4 * 60)
    : null;

  const finished = job && !running ? job.id + job.phase : null;
  useEffect(() => {
    if (finished) refreshLibrary();
  }, [finished, refreshLibrary]);

  async function act(work: () => Promise<CaptureState>, what: string) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      apply(await work());
    } catch (cause) {
      setError(deviceSentence(cause, what));
    } finally {
      setBusy(false);
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
    <section className="grid min-w-0 gap-3" aria-label="DI and reamps">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-2 [&>h2]:m-0 [&>h3]:m-0 [&>h3]:text-base [&>h3]:font-semibold">
        <div>
          <Caption>
            Record the raw guitar, then reamp it through any sound later.
          </Caption>
        </div>
      </div>
      {protect && <Caption>{PROTECT_REASON}</Caption>}
      <div
        className="grid min-w-0 gap-3 rounded-lg border border-border bg-card p-3"
        aria-label="Record DI"
      >
        {(!running || job?.kind === 'di') && (
          <RecordDiToggle
            recording={running}
            disabled={
              !ready ||
              busy ||
              !connected ||
              (protect && !running) ||
              job?.phase === 'finishing'
            }
            onRecording={(on) =>
              void act(
                on ? recordDi : () => stopCapture(true),
                on ? 'start recording' : 'stop the recording',
              )
            }
          />
        )}
        {job && running ? (
          <JobRunning
            job={job}
            onStop={(keep) =>
              void act(() => stopCapture(keep), 'stop the recording')
            }
          />
        ) : (
          <>
            <Caption>
              Records the raw guitar before trim, gate and effects. You’ll hear
              your current rig while recording.
              {minutes !== null &&
                ` Space for about ${Math.floor(minutes / 60)} h ${Math.floor(minutes % 60)} min.`}
            </Caption>
          </>
        )}
        {job && !running && <JobResult job={job} />}
      </div>
      {error && (
        <p
          role="alert"
          className="flex min-w-0 flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-3 text-sm [&>svg]:size-4 [&>svg]:shrink-0"
        >
          {error}
        </p>
      )}
      {library && !assets.length ? (
        <Caption>No DI recordings or reamps yet.</Caption>
      ) : (
        <ol
          className="m-0 grid min-w-0 list-none divide-y divide-border border-y border-border p-0"
          aria-label="DI and reamps"
        >
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
            apply(await startReamp(request));
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
      <div
        className="flex min-w-0 flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-3 text-sm [&>svg]:size-4 [&>svg]:shrink-0"
        role="status"
      >
        <span>
          ● Recording {elapsed} · input peak {Math.round(job.peakDbfs)} dBFS
        </span>
      </div>
    );
  const total = formatTime((job.totalFrames ?? job.frames) / job.rate);
  return (
    <div
      className="flex min-w-0 flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-3 text-sm [&>svg]:size-4 [&>svg]:shrink-0"
      role="status"
    >
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
    return <Caption>Cancelled. Nothing was saved.</Caption>;
  if (job.phase === 'failed')
    return (
      <p
        role="alert"
        className="flex min-w-0 flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-3 text-sm [&>svg]:size-4 [&>svg]:shrink-0"
      >
        {job.reason ?? 'The job failed.'}
        {job.asset ? ' Partial result kept.' : ''}
      </p>
    );
  return (
    <Caption role="status">
      “{job.title}” saved ({length}
      {job.kind === 'di' ? ', mono' : ''}){job.incomplete ? ', incomplete' : ''}
      .{job.kind === 'reamp' ? ' Your live guitar is back.' : ''}
      {job.reason ? ` ${job.reason}.` : ''}
    </Caption>
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
        className="grid min-w-0 gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (ready) void start();
        }}
      >
        <Caption>
          {channelsLabel(channels)} · {formatTime(durationOf(asset))}
          {lossy && ` · ${lossy}`}
        </Caption>
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
        <FormField>
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
        </FormField>
        <label>
          <input
            type="checkbox"
            checked={monitoring}
            onChange={(event) => setMonitoring(event.target.checked)}
          />{' '}
          Hear it while it runs
        </label>
        <Caption>
          Runs through the preset and scene playing now. Live guitar is replaced
          while this runs; your rig comes back after.
        </Caption>
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
