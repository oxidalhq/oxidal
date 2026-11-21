import { useState } from 'react';

import { Button } from '@oxidal/design-system/components/button';
import { RehearsalSet } from '@oxidal/design-system/patterns/rehearsal-set';

import { recallOccurrence, rehearsalReport } from '../../api';
import { friendlyError } from '../../lib/friendlyError';

export function RehearsalReport({
  revision,
  stage,
  playing,
  disabled,
}: {
  revision?: string;
  stage?: boolean;
  playing?: string;
  disabled?: boolean;
}) {
  const [report, setReport] =
    useState<Awaited<ReturnType<typeof rehearsalReport>>>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function check() {
    setBusy(true);
    setError('');
    try {
      setReport(await rehearsalReport());
    } catch (cause) {
      setError(friendlyError(cause, 'check the set for rehearsal'));
    } finally {
      setBusy(false);
    }
  }
  const [pending, setPending] = useState('');
  async function recall(id: string) {
    if (!report || pending || disabled) return;
    const entry = report.entries.find((e) => e.id === id);
    if (!entry) return;
    setPending(entry.name);
    setError('');
    try {
      await recallOccurrence(id, report.revision);
    } catch (cause) {
      setError(friendlyError(cause, 'recall the set entry'));
    } finally {
      setPending('');
    }
  }
  return (
    <section aria-label="Rehearsal check" className="space-y-2">
      <Button
        variant="outline"
        disabled={busy || !!pending || disabled}
        onClick={() => void check()}
      >
        {busy
          ? 'Checking the set…'
          : stage
            ? 'Jump to song…'
            : 'Check set for rehearsal'}
      </Button>
      {error && !report && <p role="alert">{error}</p>}
      {report &&
        (revision !== undefined && report.revision !== revision ? (
          <p role="status">The set list changed. Run the check again.</p>
        ) : (
          <>
            <RehearsalSet
              entries={report.entries}
              playing={playing}
              pending={pending}
              refusal={error}
              disabled={disabled}
              onRecall={stage ? (id) => void recall(id) : undefined}
            />
            <Button variant="outline" onClick={() => setReport(undefined)}>
              Close report
            </Button>
          </>
        ))}
    </section>
  );
}
