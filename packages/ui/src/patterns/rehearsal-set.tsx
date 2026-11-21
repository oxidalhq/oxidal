import { Button } from '../components/ui/button';

export interface RehearsalEntry {
  id: string;
  name: string;
  status: 'prepared' | 'loads_on_recall' | 'blocked';
  sound: string[];
  accompaniment: string[];
  sheet: string[];
}

const statusText = {
  prepared: 'Prepared',
  loads_on_recall: 'Loads on recall',
  blocked: 'Blocked',
};

/** A checked set list can be inspected in Library or used for deliberate Stage recall. */
export function RehearsalSet({
  entries,
  playing,
  pending,
  refusal,
  onRecall,
  disabled,
}: {
  entries: RehearsalEntry[];
  playing?: string;
  pending?: string;
  refusal?: string;
  onRecall?: (id: string) => void;
  disabled?: boolean;
}) {
  return (
    <section aria-label="Checked set list" className="grid gap-2">
      {playing && (
        <p>
          Playing · <strong>{playing}</strong>
        </p>
      )}
      {pending && <p role="status">Preparing {pending}…</p>}
      {refusal && <p role="alert">{refusal}</p>}
      {!entries.length && <p>The set list is empty.</p>}
      <ol className="grid gap-2">
        {entries.map((entry, index) => (
          <li key={entry.id} className="rounded-lg border border-border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <strong>
                {index + 1}. {entry.name}
              </strong>
              <span>{statusText[entry.status]}</span>
            </div>
            {(
              [
                ['Sound', entry.sound],
                ['Backing', entry.accompaniment],
                ['Chord sheet', entry.sheet],
              ] as const
            ).map(([label, issues]) =>
              issues.map((issue) => (
                <p key={label + issue}>
                  {label} · {issue}
                </p>
              )),
            )}
            {onRecall && (
              <Button
                variant="outline"
                disabled={disabled || !!pending || entry.status === 'blocked'}
                aria-label={`Recall ${entry.name}, position ${index + 1}`}
                onClick={() => onRecall(entry.id)}
              >
                Recall
              </Button>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
