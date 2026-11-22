import { UploadSimple, Warning } from '@phosphor-icons/react';

import { Button } from '@oxidal/design-system/components/button';
import { Eyebrow } from '@oxidal/design-system/components/text';

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
    <section className="grid min-w-0 gap-3" aria-label="Importing">
      <Eyebrow>Importing</Eyebrow>
      <ul className="m-0 grid min-w-0 list-none divide-y divide-border border-y border-border p-0">
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
              className="group relative grid min-w-0 grid-cols-[1.5rem_minmax(0,1fr)] items-center gap-x-2 gap-y-1 px-2 py-3 data-[cued]:bg-secondary min-[600px]:grid-cols-[2rem_minmax(0,1fr)_auto] [&>:last-child]:max-[599px]:col-start-2"
              data-stage={item.stage}
              aria-label={item.name}
            >
              <span
                className="self-start pt-0.5 text-center font-mono text-xs text-muted-foreground tabular-nums"
                aria-hidden="true"
              >
                {item.stage === 'failed' ? (
                  <Warning weight="bold" />
                ) : (
                  <UploadSimple />
                )}
              </span>
              <div className="grid min-w-0 gap-0.5">
                <span className="text-sm font-semibold break-words">
                  {item.name}
                </span>
                <span
                  className="min-w-0 text-xs break-words text-muted-foreground"
                  role={item.stage === 'failed' ? 'alert' : undefined}
                >
                  {line(item)}
                </span>
                {bar && (
                  <span
                    className="block h-1.5 w-full max-w-sm overflow-hidden rounded-full bg-muted [&>i]:block [&>i]:h-full [&>i]:bg-foreground"
                    aria-hidden="true"
                  >
                    <i style={{ width: `${percent(fraction)}%` }} />
                  </span>
                )}
              </div>
              <div className="flex min-w-0 flex-wrap items-center gap-1 min-[600px]:justify-end">
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
