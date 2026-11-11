import { UploadSimple, Warning } from '@phosphor-icons/react';
import { Button } from '../ui/button';
import type { UploadItem } from '../../lib/mediaUpload';
import { fileSize, useSessionMedia } from './sessionMedia';

function percent(value: number) {
  return Math.floor(Math.min(1, Math.max(0, value)) * 100);
}

function line(item: UploadItem): string {
  const sent = item.size ? item.sent / item.size : 0;
  switch (item.stage) {
    case 'uploading':
      return `Uploading ${percent(sent)} % · ${fileSize(item.sent)} of ${fileSize(item.size)} · Keep this screen open`;
    case 'paused':
      return `Paused at ${percent(sent)} %: connection lost. It resumes from here when you're back online.`;
    case 'preparing':
      return `Preparing… ${percent(item.progress)} % · Safe to close this page`;
    case 'duplicate':
      return `Already in Library as “${item.duplicate?.title ?? item.name}”.`;
    case 'failed':
      return item.error ?? 'The import failed.';
  }
}

/**
 * Files on their way into Library: uploading, paused (resumes on its own),
 * preparing on the device, a duplicate waiting for a choice, or failed with
 * the cause and the fix.
 * @see docs/media.md
 */
export function UploadQueue() {
  const { uploads, queue } = useSessionMedia();
  if (!uploads.length || !queue) return null;
  return (
    <section className="media-uploads" aria-label="Importing">
      <span className="eyebrow">Importing</span>
      <ul className="media-rows">
        {uploads.map((item) => {
          const fraction =
            item.stage === 'preparing'
              ? item.progress
              : item.size
                ? item.sent / item.size
                : 0;
          const bar =
            item.stage === 'uploading' ||
            item.stage === 'paused' ||
            item.stage === 'preparing';
          return (
            <li
              key={item.key}
              className="media-row"
              data-stage={item.stage}
              aria-label={item.name}
            >
              <span className="media-row-num" aria-hidden="true">
                {item.stage === 'failed' ? (
                  <Warning weight="bold" />
                ) : (
                  <UploadSimple />
                )}
              </span>
              <div className="media-row-main">
                <span className="media-row-name">{item.name}</span>
                <span
                  className="media-row-sub"
                  role={item.stage === 'failed' ? 'alert' : undefined}
                >
                  {line(item)}
                </span>
                {bar && (
                  <span className="media-bar" aria-hidden="true">
                    <i style={{ width: `${percent(fraction)}%` }} />
                  </span>
                )}
              </div>
              <div className="media-row-actions">
                {item.stage === 'paused' && (
                  <Button
                    variant="outline"
                    onClick={() => queue.resume(item.key)}
                  >
                    Resume
                  </Button>
                )}
                {item.stage === 'duplicate' && (
                  <Button
                    variant="outline"
                    onClick={() => void queue.importCopy(item.key)}
                  >
                    Import a copy
                  </Button>
                )}
                {item.stage === 'failed' ? (
                  <Button
                    variant="outline"
                    onClick={() => queue.dismiss(item.key)}
                  >
                    Dismiss
                  </Button>
                ) : (
                  item.stage !== 'preparing' && (
                    <Button
                      variant="outline"
                      aria-label={`Cancel ${item.name}`}
                      onClick={() => void queue.cancel(item.key)}
                    >
                      Cancel
                    </Button>
                  )
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
