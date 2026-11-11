import {
  OffsetConflict,
  cancelUpload,
  importCopy,
  sendChunk,
  startUpload,
  uploadStatus,
  type UploadState,
} from '../api';
import { DeviceError, deviceSentence } from './friendlyError';

/** The device refuses chunks above 8 MiB. */
export const CHUNK_BYTES = 8 * 1024 * 1024;

type UploadStage =
  'uploading' | 'paused' | 'preparing' | 'duplicate' | 'failed';

/** One file in the import queue, as the Library shows it. */
export interface UploadItem {
  key: string;
  name: string;
  size: number;
  /** Bytes the device has confirmed. */
  sent: number;
  stage: UploadStage;
  /** Preparation progress, 0–1. */
  progress: number;
  duplicate?: { existing: string; title: string };
  error?: string;
}

/** What the queue calls on the device; tests pass their own. */
export interface UploadTransport {
  startUpload: typeof startUpload;
  sendChunk: typeof sendChunk;
  uploadStatus: typeof uploadStatus;
  cancelUpload: typeof cancelUpload;
  importCopy: typeof importCopy;
}

interface Job {
  item: UploadItem;
  file: Blob;
  id?: string;
  abort: AbortController;
  /** Wakes a paused upload early (Resume or back online). */
  wake?: () => void;
  cancelled: boolean;
}

const defaults: UploadTransport = {
  startUpload,
  sendChunk,
  uploadStatus,
  cancelUpload,
  importCopy,
};

/** A failure worth waiting out: the network, not the device's answer. */
function transient(error: unknown) {
  if (error instanceof DeviceError)
    return ['busy', 'timeout', 'unavailable'].includes(error.code);
  return error instanceof TypeError;
}

/**
 * Chunked, resumable import of WAV and MP3 files (8 MiB chunks). A chunk
 * refused at the wrong offset resumes from the offset the device confirmed;
 * a lost connection pauses the file and resumes from the confirmed offset when
 * the browser is back online, on Resume, or on the next retry. After the last
 * chunk the device prepares the file on its own; the queue only follows it.
 * @see docs/media.md
 */
export class UploadQueue {
  private jobs: Job[] = [];
  private items: UploadItem[] = [];
  private listeners = new Set<() => void>();
  private seq = 0;

  private readyListeners = new Set<(asset: string, title: string) => void>();

  constructor(
    private readonly api: UploadTransport = defaults,
    private readonly delays = { retry: 3000, poll: 500 },
  ) {}

  /** Called with the new asset each time an import becomes ready. */
  whenReady(listener: (asset: string, title: string) => void) {
    this.readyListeners.add(listener);
    return () => {
      this.readyListeners.delete(listener);
    };
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  snapshot = () => this.items;

  private publish() {
    this.items = this.jobs.map((job) => ({ ...job.item }));
    for (const listener of this.listeners) listener();
  }
  private update(job: Job, change: Partial<UploadItem>) {
    if (job.cancelled) return;
    Object.assign(job.item, change);
    this.publish();
  }
  private remove(job: Job) {
    this.jobs = this.jobs.filter((other) => other !== job);
    this.publish();
  }
  private find(key: string) {
    return this.jobs.find((job) => job.item.key === key);
  }

  /** Queue a file and start sending it at once. */
  add(file: File) {
    const job: Job = {
      file,
      abort: new AbortController(),
      cancelled: false,
      item: {
        key: `upload-${++this.seq}`,
        name: file.name,
        size: file.size,
        sent: 0,
        stage: 'uploading',
        progress: 0,
      },
    };
    this.jobs = [...this.jobs, job];
    this.publish();
    void this.run(job);
    return job.item.key;
  }

  /** Try a paused upload now instead of waiting for the next retry. */
  resume(key: string) {
    this.find(key)?.wake?.();
  }

  /** Stop sending and remove the partial file from the device. */
  async cancel(key: string) {
    const job = this.find(key);
    if (!job) return;
    job.cancelled = true;
    job.abort.abort();
    job.wake?.();
    this.remove(job);
    if (job.id) await this.api.cancelUpload(job.id).catch(() => undefined);
  }

  /** Clear a failed row. */
  dismiss(key: string) {
    const job = this.find(key);
    if (job) this.remove(job);
  }

  /** A duplicate goes ahead as a second copy. */
  async importCopy(key: string) {
    const job = this.find(key);
    if (!job?.id || job.item.stage !== 'duplicate') return;
    try {
      const state = await this.api.importCopy(job.id);
      this.update(job, {
        stage: 'preparing',
        progress: 0,
        duplicate: undefined,
      });
      await this.follow(job, state);
    } catch (error) {
      this.update(job, {
        stage: 'failed',
        error: deviceSentence(error, 'import a copy'),
      });
    }
  }

  private wait(job: Job, ms: number) {
    return new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        window.removeEventListener('online', done);
        job.wake = undefined;
        resolve();
      };
      const timer = setTimeout(done, ms);
      job.wake = done;
      window.addEventListener('online', done);
    });
  }

  private async run(job: Job) {
    try {
      while (!job.id && !job.cancelled) {
        try {
          const state = await this.api.startUpload(
            job.item.name,
            job.item.size,
          );
          job.id = state.id;
        } catch (error) {
          if (!transient(error)) throw error;
          this.update(job, { stage: 'paused' });
          await this.wait(job, this.delays.retry);
          this.update(job, { stage: 'uploading' });
        }
      }
      let state: UploadState | null = null;
      while (!job.cancelled && job.id && job.item.sent < job.item.size) {
        const offset = job.item.sent;
        const chunk = job.file.slice(offset, offset + CHUNK_BYTES);
        try {
          state = await this.api.sendChunk(
            job.id,
            offset,
            chunk,
            job.abort.signal,
          );
          this.update(job, { sent: state.offset, stage: 'uploading' });
        } catch (error) {
          if (job.cancelled) return;
          if (error instanceof OffsetConflict) {
            // A response was lost: carry on from what the device has.
            state = error.state;
            this.update(job, { sent: error.state.offset });
            continue;
          }
          if (
            !transient(error) &&
            !(error instanceof DeviceError && error.status === 409)
          )
            throw error;
          this.update(job, { stage: 'paused' });
          await this.wait(job, this.delays.retry);
          if (job.cancelled) return;
          // Learn the confirmed offset before sending again.
          try {
            state = await this.api.uploadStatus(job.id);
            this.update(job, { sent: state.offset, stage: 'uploading' });
          } catch (statusError) {
            if (!transient(statusError)) throw statusError;
          }
        }
      }
      if (job.cancelled || !job.id) return;
      this.update(job, { stage: 'preparing', progress: 0 });
      await this.follow(job, state);
    } catch (error) {
      if (job.cancelled) return;
      this.update(job, {
        stage: 'failed',
        error: deviceSentence(error, `import ${job.item.name}`),
      });
    }
  }

  /** Follow the device's import until it is ready, a duplicate or failed. */
  private async follow(job: Job, first: UploadState | null) {
    let state = first;
    while (!job.cancelled && job.id) {
      const phase = state?.import;
      if (phase?.state === 'ready') {
        this.remove(job);
        for (const listener of this.readyListeners)
          listener(phase.asset, state?.title ?? job.item.name);
        return;
      }
      if (phase?.state === 'duplicate') {
        this.update(job, {
          stage: 'duplicate',
          duplicate: { existing: phase.existing, title: phase.title },
        });
        return;
      }
      if (phase?.state === 'failed') {
        this.update(job, { stage: 'failed', error: phase.reason });
        return;
      }
      if (phase?.state === 'preparing')
        this.update(job, { stage: 'preparing', progress: phase.progress });
      await this.wait(job, this.delays.poll);
      if (job.cancelled) return;
      try {
        state = await this.api.uploadStatus(job.id);
      } catch (error) {
        if (!transient(error)) throw error;
        state = null;
      }
    }
  }
}
