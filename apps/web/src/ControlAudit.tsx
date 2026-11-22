import { ArrowClockwise, DownloadSimple, FunnelX } from '@phosphor-icons/react';
import { useEffect, useMemo, useState } from 'react';

import { Button } from '@oxidal/design-system/components/button';
import { ActionRow } from '@oxidal/design-system/components/form-layout';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@oxidal/design-system/components/select';
import { Caption } from '@oxidal/design-system/components/text';
import { AuditLog } from '@oxidal/design-system/widgets/audit-log';

import { type ControlAudit as History, controlAudit } from './api';
import { friendlyError } from './lib/friendlyError';

const labels: Record<History['records'][number]['operation'], string> = {
  native_audio: 'TONE3000 audio',
  mixed_audio: 'Hybrid audio',
  effects_audio: 'Effects audio',
  effect_packs: 'Effects',
  storage: 'Storage mode',
  network: 'Wi-Fi / device',
  account: 'TONE3000 account',
  native_editor: 'Draft authoring',
  native_defaults: 'TONE3000 defaults',
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
    const controller = new AbortController();
    void controlAudit(controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setHistory(data);
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setError(friendlyError(cause, 'read the controls'));
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => controller.abort();
  }, [generation]);
  const summary = useMemo(() => {
    // The shared filters show the newest 50 entries for each outcome group.
    // Keep the full retained history for the detailed filters and export.
    const entries = history?.records ?? [];
    const recent = entries.slice(0, 50);
    const refused = entries
      .filter((r) => r.outcome !== 'accepted')
      .slice(0, 50);
    const outcomes = {
      accepted: 'Accepted',
      rejected: 'Refused',
      failed: 'Failed',
    } as const;
    return [...new Set([...recent, ...refused])].map((r) => ({
      at: new Date(r.requested_at_ms).toLocaleTimeString(),
      operation: labels[r.operation],
      outcome: outcomes[r.outcome],
      status: r.http_status,
      ms: r.completed_at_ms - r.requested_at_ms,
    }));
  }, [history]);
  const records =
    history?.records.filter(
      (r) =>
        (category === 'all' || r.operation === category) &&
        (outcome === 'all' || r.outcome === outcome) &&
        (!since || r.requested_at_ms >= new Date(since).getTime()) &&
        (!until || r.requested_at_ms <= new Date(until).getTime()),
    ) ?? [];
  const invalidRange =
    !!since && !!until && new Date(since).getTime() > new Date(until).getTime();
  function exportFiltered() {
    if (!history || invalidRange) return;
    const url = URL.createObjectURL(
      new Blob(
        [
          JSON.stringify(
            {
              ...history,
              records,
              export_scope: 'filtered',
              filters: { operation: category, outcome, from: since, until },
            },
            null,
            2,
          ),
        ],
        { type: 'application/json' },
      ),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = 'oxidal-audit-filtered.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <>
      <AuditLog records={summary} limit={50} />
      {error && !open && <p role="alert">{error}</p>}
      <details
        className="border-y border-border py-1 text-sm [&>p]:mb-3 [&>p]:text-muted-foreground [&>summary]:flex [&>summary]:min-h-touch [&>summary]:cursor-pointer [&>summary]:items-center [&>summary]:justify-between [&>summary]:gap-3 [&>summary]:font-medium [&>summary]:after:text-lg [&>summary]:after:text-muted-foreground [&>summary]:after:content-['›'] open:[&>summary]:after:content-['−']"
        onToggle={(event) => {
          setOpen(event.currentTarget.open);
          if (event.currentTarget.open) {
            setBusy(true);
            setError('');
            setGeneration((n) => n + 1);
          }
        }}
      >
        <summary>Control audit</summary>
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
            <Caption>
              Accepted means the API accepted a request, not that audio has
              applied it.
            </Caption>
            <div
              className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2"
              onChange={() => setLimit(50)}
            >
              <label className="grid min-w-0 gap-1 text-sm">
                Operation
                <Select value={category} onValueChange={setCategory}>
                  <SelectTrigger aria-label="Operation">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All operations</SelectItem>
                    {Object.entries(labels).map(([key, value]) => (
                      <SelectItem key={key} value={key}>
                        {value}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
              <label className="grid min-w-0 gap-1 text-sm">
                Outcome
                <Select value={outcome} onValueChange={setOutcome}>
                  <SelectTrigger aria-label="Outcome">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All outcomes</SelectItem>
                    <SelectItem value="accepted">Accepted</SelectItem>
                    <SelectItem value="rejected">Rejected</SelectItem>
                    <SelectItem value="failed">Failed</SelectItem>
                  </SelectContent>
                </Select>
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
            <ActionRow>
              <Button
                variant="outline"
                disabled={busy || !history || invalidRange || !records.length}
                onClick={exportFiltered}
              >
                <DownloadSimple aria-hidden="true" /> Export filtered
              </Button>
              <Button
                variant="ghost"
                disabled={
                  category === 'all' && outcome === 'all' && !since && !until
                }
                onClick={() => {
                  setCategory('all');
                  setOutcome('all');
                  setSince('');
                  setUntil('');
                  setLimit(50);
                }}
              >
                <FunnelX aria-hidden="true" /> Clear filters
              </Button>
            </ActionRow>
            {invalidRange && <p role="alert">From must be before Until.</p>}
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
              <Caption>
                {records.length} matching requests · newest first
              </Caption>
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
            <details className="border-y border-border py-1 text-sm [&>p]:mb-3 [&>p]:text-muted-foreground [&>summary]:flex [&>summary]:min-h-touch [&>summary]:cursor-pointer [&>summary]:items-center [&>summary]:justify-between [&>summary]:gap-3 [&>summary]:font-medium [&>summary]:after:text-lg [&>summary]:after:text-muted-foreground [&>summary]:after:content-['›'] open:[&>summary]:after:content-['−']">
              <summary>Audit scope</summary>
              <Caption>
                Completed control API requests, retained across restarts up to 2
                MiB. Request bodies, credentials, terminal commands and audio
                are excluded. Repeated adjustments are separate requests. Worker
                application events and interrupted requests are not yet
                recorded. Export all includes every retained record. Export
                filtered includes every matching record, including entries
                beyond Show more.
              </Caption>
            </details>
          </section>
        )}
      </details>
    </>
  );
}
