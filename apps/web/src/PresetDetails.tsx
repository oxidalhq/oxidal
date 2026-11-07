import { Loading } from './components/ui/loading';
import { friendlyError } from './lib/friendlyError';
import { useEffect, useState } from 'react';
import {
  presetDetails,
  type DetailsCatalog,
  type LibraryCatalog,
  type PresetDetails,
} from './api';
import { detailsKey } from './presetMetadata';
import { AdjustmentDialog } from './AdjustmentDialog';
import { Button } from './components/ui/button';

type Entry = Pick<LibraryCatalog['items'][number], 'kind' | 'id' | 'name'>;
const emptyDetails: PresetDetails = {
  description: '',
  categories: [],
  copied_from: null,
};
/** Opening details reads metadata only; it never recalls a preset or starts audio. */
export function PresetDetailsDialog({
  entry,
  onCancel,
  onChanged,
  editable = false,
}: {
  entry: Entry;
  onCancel: () => void;
  onChanged?: () => void;
  editable?: boolean;
}) {
  const [catalog, setCatalog] = useState<DetailsCatalog | null>(null);
  const [details, setDetails] = useState<PresetDetails>(emptyDetails);
  const [description, setDescription] = useState('');
  const [categories, setCategories] = useState('');
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const identity = detailsKey(entry);
  useEffect(() => {
    let active = true;
    void presetDetails()
      .then((c) => {
        if (!active) return;
        const d =
          c.entries.find((e) => detailsKey(e.entry) === identity)?.details ??
          emptyDetails;
        setCatalog(c);
        setDetails(d);
        setDescription(d.description);
        setCategories(d.categories.join(', '));
        setEditing(false);
      })
      .catch((e: unknown) => {
        if (active) setError(friendlyError(e, 'read the preset details'));
      });
    return () => {
      active = false;
    };
  }, [identity, refresh]);
  async function save() {
    if (!catalog || busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await presetDetails({
        expected_revision: catalog.revision,
        entry_kind: entry.kind,
        id: entry.id,
        description,
        categories: categories
          .split(',')
          .map((c) => c.trim())
          .filter(Boolean),
      });
      const d =
        result.entries.find((e) => detailsKey(e.entry) === identity)?.details ??
        emptyDetails;
      setCatalog(result);
      setDetails(d);
      setEditing(false);
      onChanged?.();
    } catch (e) {
      setError(friendlyError(e, 'update the preset details'));
      setCatalog(null);
    } finally {
      setBusy(false);
    }
  }
  return (
    <AdjustmentDialog
      title="Preset details"
      onCancel={() => {
        if (!busy) onCancel();
      }}
    >
      <div className="min-w-0 space-y-4">
        <p className="font-semibold wrap-anywhere">{entry.name}</p>
        {error && (
          <div className="space-y-2">
            <p role="alert">{error}</p>
            <Button
              variant="outline"
              onClick={() => {
                setCatalog(null);
                setError('');
                setRefresh((v) => v + 1);
              }}
            >
              Reload saved details
            </Button>
          </div>
        )}
        {!catalog && !error && <Loading label="Loading details…" />}
        {editing ? (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <label className="field">
              Description
              <textarea
                className="min-h-32 w-full resize-y rounded-md border border-input bg-card p-3"
                maxLength={4000}
                value={description}
                disabled={busy}
                onChange={(e) => setDescription(e.target.value)}
              />
            </label>
            <label className="field">
              Categories
              <input
                value={categories}
                disabled={busy}
                maxLength={800}
                onChange={(e) => setCategories(e.target.value)}
                placeholder="Clean, Ambient, Lead"
              />
            </label>
            <p className="caption">
              Separate categories with commas. Up to 16 categories, 48
              characters each.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={busy || !catalog}>
                {busy ? 'Saving…' : 'Save details'}
              </Button>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => {
                  setDescription(details.description);
                  setCategories(details.categories.join(', '));
                  setEditing(false);
                }}
              >
                Cancel edit
              </Button>
            </div>
          </form>
        ) : (
          catalog && (
            <>
              <div className="space-y-2">
                <h3>Description</h3>
                <p className="wrap-anywhere whitespace-pre-wrap">
                  {details.description || 'No description yet.'}
                </p>
              </div>
              <div className="space-y-2">
                <h3>Categories</h3>
                {details.categories.length ? (
                  <div className="flex flex-wrap gap-2">
                    {details.categories.map((c) => (
                      <span
                        key={c}
                        className="rounded-md border border-border px-2 py-1 text-sm wrap-anywhere"
                      >
                        {c}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="caption">No categories yet.</p>
                )}
              </div>
              {details.copied_from && (
                <p className="caption wrap-anywhere">
                  Copied from {details.copied_from.name}
                </p>
              )}
              {editable && (
                <Button variant="outline" onClick={() => setEditing(true)}>
                  Edit details
                </Button>
              )}
            </>
          )
        )}
      </div>
    </AdjustmentDialog>
  );
}
