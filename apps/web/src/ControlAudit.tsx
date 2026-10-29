import { useEffect, useState } from 'react';
import {
  ArrowClockwise,
  DownloadSimple,
  ListChecks,
} from '@phosphor-icons/react';
import { controlAudit, type ControlAudit as History } from './api';
import { Button } from './components/ui/button';

const labels: Record<History['records'][number]['operation'], string> = {
  native_audio: 'Native audio',
  mixed_audio: 'Hybrid audio',
  effects_audio: 'Effects audio',
  network: 'Wi-Fi / device',
  account: 'TONE3000 account',
  native_editor: 'Draft authoring',
  native_defaults: 'Native defaults',
  preset_import: 'Preset import',
  preset_library: 'Library',
  rig_save: 'Rig save',
  model_import: 'Model import',
  model_collection: 'Model collection',
  model_download: 'Model download',
  controls: 'Controls',
};
export function ControlAudit() {
  const [open, setOpen] = useState(false);
  const [generation, setGeneration] = useState(0);
  const [history, setHistory] = useState<History | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [category, setCategory] = useState('all');
  const [outcome, setOutcome] = useState('all');
  const [since, setSince] = useState('');
  const [until, setUntil] = useState('');
  const [limit, setLimit] = useState(50);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    void controlAudit(controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setHistory(data);
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setError(String(cause));
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => controller.abort();
  }, [open, generation]);
  const records =
    history?.records.filter(
      (r) =>
        (category === 'all' || r.operation === category) &&
        (outcome === 'all' || r.outcome === outcome) &&
        (!since || r.requested_at_ms >= new Date(since).getTime()) &&
        (!until || r.requested_at_ms <= new Date(until).getTime()),
    ) ?? [];
  return (
    <details
      className="control-help"
      onToggle={(event) => {
        setOpen(event.currentTarget.open);
        if (event.currentTarget.open) {
          setBusy(true);
          setError('');
        }
      }}
    >
      <summary>
        <ListChecks aria-hidden="true" className="inline size-4" /> Control
        audit
      </summary>
      {open && (
        <section
          aria-label="Control request history"
          className="grid min-w-0 gap-3 pt-3"
        >
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                setError('');
                setGeneration((n) => n + 1);
              }}
            >
              <ArrowClockwise aria-hidden="true" />
              {busy ? 'Reading…' : 'Refresh audit'}
            </Button>
            <Button variant="outline" asChild>
              <a href="/api/v1/audit/export" download>
                <DownloadSimple aria-hidden="true" />
                Export all
              </a>
            </Button>
          </div>
          <p className="caption">
            Accepted means the API accepted a request, not that audio has
            applied it.
          </p>
          <div
            className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2"
            onChange={() => setLimit(50)}
          >
            <label className="grid min-w-0 gap-1 text-sm">
              Operation
              <select
                className="min-h-11 w-full min-w-0"
                aria-label="Operation"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                <option value="all">All operations</option>
                {Object.entries(labels).map(([key, value]) => (
                  <option key={key} value={key}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid min-w-0 gap-1 text-sm">
              Outcome
              <select
                className="min-h-11 w-full min-w-0"
                aria-label="Outcome"
                value={outcome}
                onChange={(e) => setOutcome(e.target.value)}
              >
                <option value="all">All outcomes</option>
                <option value="accepted">Accepted</option>
                <option value="rejected">Rejected</option>
                <option value="failed">Failed</option>
              </select>
            </label>
            <label className="grid min-w-0 gap-1 text-sm">
              From
              <input
                className="min-h-11 w-full min-w-0"
                type="datetime-local"
                value={since}
                onChange={(e) => setSince(e.target.value)}
              />
            </label>
            <label className="grid min-w-0 gap-1 text-sm">
              Until
              <input
                className="min-h-11 w-full min-w-0"
                type="datetime-local"
                value={until}
                onChange={(e) => setUntil(e.target.value)}
              />
            </label>
          </div>
          {error && <p role="alert">{error}</p>}
          {history &&
            (history.storage_error ||
              history.dropped_records > 0 ||
              history.skipped_records > 0) && (
              <p role="status">
                {history.storage_error ? 'Audit storage failed. ' : ''}
                {history.dropped_records} records dropped this run ·{' '}
                {history.skipped_records} unreadable records skipped.
              </p>
            )}
          {history && (
            <p className="caption">
              {records.length} matching requests · newest first
            </p>
          )}
          {history && records.length === 0 && <p>No matching requests.</p>}
          <ol className="grid min-w-0 gap-2" aria-label="Audit entries">
            {records.slice(0, limit).map((r, index) => (
              <li
                key={`${r.requested_at_ms}-${index}`}
                className="grid min-w-0 gap-1 rounded-md border border-border p-3 text-sm"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <strong>{labels[r.operation]}</strong>
                  <span
                    className={
                      r.outcome === 'accepted'
                        ? 'text-muted-foreground'
                        : 'text-destructive'
                    }
                  >
                    {r.outcome === 'accepted'
                      ? 'Accepted'
                      : r.outcome === 'rejected'
                        ? 'Rejected'
                        : 'Failed'}{' '}
                    · {r.http_status}
                  </span>
                </div>
                <time
                  className="text-xs text-muted-foreground"
                  dateTime={new Date(r.requested_at_ms).toISOString()}
                >
                  {new Date(r.requested_at_ms).toLocaleString()}
                </time>
              </li>
            ))}
          </ol>
          {records.length > limit && (
            <Button variant="outline" onClick={() => setLimit((n) => n + 50)}>
              Show 50 more
            </Button>
          )}
          <details className="control-help">
            <summary>Audit scope</summary>
            <p className="caption">
              Completed control API requests, retained across restarts up to 2
              MiB. Request bodies, credentials, terminal commands and audio are
              excluded. Repeated adjustments are separate requests. Worker
              application events and interrupted requests are not yet recorded.
              Export includes all retained records, regardless of filters.
            </p>
          </details>
        </section>
      )}
    </details>
  );
}
