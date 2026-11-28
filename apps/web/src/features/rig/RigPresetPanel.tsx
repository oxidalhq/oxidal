import { useEffect, useMemo, useState } from 'react';

import { Eyebrow } from '@oxidal/design-system/components/text';
import { cn } from '@oxidal/design-system/lib/cn';

import {
  choiceKey,
  choiceSource,
  choiceSummary,
  loadPresetChoices,
  type PresetChoice,
} from '../../presetChoices';
import { LibrarySearch } from '../library/LibrarySearch';

const keyOf = (c: PresetChoice) =>
  c.kind === 'scenes'
    ? choiceKey({ kind: 'scenes', revision: c.revision })
    : choiceKey({ kind: 'tone3000', id: c.id, owned: c.owned });

/**
 * The presets and the set list in the Rig's left panel: the same list the
 * Library shows and the preset picker chooses from, in the same order. A row
 * plays that preset through the same unsaved-edit checks as the picker.
 * @see docs/interface.md
 */
export function RigPresetPanel({
  playingKey,
  refresh,
  disabled,
  onSelect,
}: {
  /** The list key of the preset sounding now ('' for a draft). */
  playingKey: string;
  /** Changes when the list may have changed, such as after a save. */
  refresh?: unknown;
  disabled: boolean;
  onSelect: (choice: PresetChoice) => void;
}) {
  const [items, setItems] = useState<PresetChoice[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  useEffect(() => {
    let live = true;
    void loadPresetChoices()
      .then((loaded) => {
        if (!live) return;
        setItems(loaded.items);
        setError(loaded.error);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [refresh]);

  const needle = query.trim().toLowerCase();
  const setList = useMemo(() => items.filter((c) => c.inSetList), [items]);
  const all = useMemo(
    () =>
      items.filter(
        (c) =>
          !needle ||
          `${c.name} ${choiceSource(c)} ${choiceSummary(c)}`
            .toLowerCase()
            .includes(needle),
      ),
    [items, needle],
  );

  const row = (c: PresetChoice, number?: number) => {
    const playing = keyOf(c) === playingKey;
    return (
      <li key={`${number ?? 'all'}:${keyOf(c)}`}>
        <button
          type="button"
          disabled={disabled || loading}
          aria-current={playing ? 'true' : undefined}
          onClick={() => onSelect(c)}
          className={cn(
            // Set list rows keep their numbers in one right-aligned column;
            // other rows start flush with their heading, as in Layout A.
            'grid w-full items-baseline gap-x-2 rounded-md px-2 py-1.5 text-left hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-60',
            number === undefined
              ? 'grid-cols-[minmax(0,1fr)]'
              : 'grid-cols-[1.25rem_minmax(0,1fr)]',
            playing && 'bg-accent font-semibold',
          )}
        >
          {number !== undefined && (
            <span className="text-right font-mono text-xs text-muted-foreground tabular-nums">
              {number}
            </span>
          )}
          <span className="min-w-0">
            <span className="block truncate text-sm">{c.name}</span>
            <span className="block truncate text-xs font-normal text-muted-foreground">
              {choiceSource(c)} · {choiceSummary(c)}
            </span>
          </span>
        </button>
      </li>
    );
  };

  return (
    <div className="grid content-start gap-4 p-3">
      <LibrarySearch
        label="Find a preset"
        clearLabel="Clear preset search"
        placeholder="Find a preset or sound…"
        value={query}
        onChange={setQuery}
      />
      {error && (
        <p role="status" className="text-sm text-muted-foreground">
          {error}
        </p>
      )}
      {!needle && setList.length > 0 && (
        <section className="grid gap-1" aria-label="Set list">
          <Eyebrow>
            Set list ·{' '}
            {setList.findIndex((c) => keyOf(c) === playingKey) >= 0
              ? `${setList.findIndex((c) => keyOf(c) === playingKey) + 1} of ${setList.length}`
              : setList.length}
          </Eyebrow>
          <ul className="m-0 grid list-none gap-0.5 p-0">
            {setList.map((c, i) => row(c, i + 1))}
          </ul>
        </section>
      )}
      <section className="grid gap-1" aria-label="All presets">
        <Eyebrow>
          {needle ? 'Matches' : 'All presets'} · {all.length}
        </Eyebrow>
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading presets…</p>
        ) : all.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {needle ? 'No preset matches.' : 'No saved presets yet.'}
          </p>
        ) : (
          <ul className="m-0 grid list-none gap-0.5 p-0">
            {all.map((c) => row(c))}
          </ul>
        )}
      </section>
    </div>
  );
}
