import { MagnifyingGlass } from '@phosphor-icons/react';
import { type ReactNode, useEffect, useId, useMemo, useState } from 'react';

import { Eyebrow } from '../components/ui/text';
import { cn } from '../lib/cn';

/**
 * One search for presets, songs, scenes, screens and actions, opened with ⌘K
 * or Ctrl+K and by a button for touch. Arrow keys move, Enter acts, Escape
 * closes. It only lists and reports the choice; the product decides what
 * choosing does, so a preset still goes through its unsaved-edit checks.
 * @see docs/interface.md
 */

export type SearchItem = {
  id: string;
  label: string;
  /** Said smaller, at the right of the label. */
  hint?: string;
  icon?: ReactNode;
  /** Extra words that should find this item. */
  keywords?: string;
  onChoose: () => void;
};
export type SearchGroup = { title: string; items: SearchItem[] };

function SearchPanel({
  onOpenChange,
  groups,
  placeholder = 'Search presets, songs, scenes, screens and actions…',
  empty = 'Nothing matches.',
}: {
  onOpenChange: (open: boolean) => void;
  groups: SearchGroup[];
  placeholder?: string;
  empty?: string;
}) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listId = useId();

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return groups
      .map((g) => ({
        ...g,
        items: g.items.filter(
          (i) =>
            !needle ||
            `${i.label} ${i.hint ?? ''} ${i.keywords ?? ''}`
              .toLowerCase()
              .includes(needle),
        ),
      }))
      .filter((g) => g.items.length > 0);
  }, [groups, query]);
  const flat = shown.flatMap((g) => g.items);

  useEffect(() => {
    document
      .getElementById(`${listId}-${active}`)
      ?.scrollIntoView?.({ block: 'nearest' });
  }, [active, listId]);

  const choose = (item: SearchItem | undefined) => {
    if (!item) return;
    onOpenChange(false);
    item.onChoose();
  };
  return (
    <div
      className="bg-black/30 fixed inset-0 z-50 grid place-items-start justify-center pt-[12vh]"
      onPointerDown={() => onOpenChange(false)}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search"
        onPointerDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            onOpenChange(false);
          } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((a) => Math.min(flat.length - 1, a + 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(0, a - 1));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            choose(flat[active]);
          }
        }}
        className="shadow-xl w-[620px] max-w-[92vw] overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground"
      >
        <div className="flex items-center gap-2 border-b border-border px-4">
          <MagnifyingGlass
            aria-hidden="true"
            className="size-4 shrink-0 text-muted-foreground"
          />
          <input
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={
              flat.length ? `${listId}-${active}` : undefined
            }
            aria-label="Search"
            autoFocus
            autoComplete="off"
            spellCheck={false}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            placeholder={placeholder}
            className="min-h-touch w-full bg-transparent text-base outline-none"
          />
        </div>
        <div
          id={listId}
          role="listbox"
          aria-label="Results"
          className="max-h-[50vh] overflow-y-auto p-2"
        >
          {flat.length === 0 && (
            <p className="p-4 text-sm text-muted-foreground">{empty}</p>
          )}
          {shown.map((g, gi) => (
            <div
              key={g.title}
              role="group"
              aria-label={g.title}
              className="mb-1"
            >
              <Eyebrow className="block px-2 py-1">{g.title}</Eyebrow>
              {g.items.map((item, ii) => {
                const mine =
                  shown.slice(0, gi).reduce((n, x) => n + x.items.length, 0) +
                  ii;
                return (
                  <div
                    key={item.id}
                    id={`${listId}-${mine}`}
                    role="option"
                    aria-selected={mine === active}
                    onPointerMove={() => setActive(mine)}
                    onClick={() => choose(item)}
                    className={cn(
                      'flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2',
                      mine === active && 'bg-accent',
                    )}
                  >
                    {item.icon && (
                      <span className="grid size-7 shrink-0 place-items-center rounded-md bg-secondary [&_svg]:size-4">
                        {item.icon}
                      </span>
                    )}
                    <span className="min-w-0 truncate text-sm font-medium">
                      {item.label}
                    </span>
                    {item.hint && (
                      <span className="ml-auto shrink-0 truncate text-xs text-muted-foreground">
                        {item.hint}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        <p className="flex gap-4 border-t border-border px-4 py-2 text-xs text-muted-foreground">
          <span>↑↓ move</span>
          <span>↵ open</span>
          <span>esc close</span>
        </p>
      </div>
    </div>
  );
}

/** The search, drawn only while open so each opening starts a fresh search. */
export function CommandSearch(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groups: SearchGroup[];
  placeholder?: string;
  empty?: string;
}) {
  const { open, ...rest } = props;
  return open ? <SearchPanel {...rest} /> : null;
}
