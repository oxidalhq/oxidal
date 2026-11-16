import * as React from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { MagnifyingGlass, X } from '@phosphor-icons/react';
import { cn } from '../../lib/cn';
import { Caption } from './text';

export type ComboboxOption = {
  value: string;
  label: string;
  caption?: string;
  disabled?: boolean;
};

/**
 * Find one of many by typing: a model among thousands, a preset, an effect
 * to add. A search field with the matches beneath; arrows move, Enter
 * picks, Escape closes, the clear button empties the search. When there
 * are fewer than about ten choices use a Select instead.
 */
export function Combobox({
  options,
  value,
  onChange,
  placeholder = 'Search…',
  label,
  empty = 'No matches',
  filter = defaultFilter,
  className,
  id,
}: {
  options: ComboboxOption[];
  value: string | null;
  onChange: (value: string | null) => void;
  placeholder?: string;
  label: string;
  empty?: string;
  filter?: (option: ComboboxOption, query: string) => boolean;
  className?: string;
  id?: string;
}) {
  const reactId = React.useId();
  const listId = `${id ?? reactId}-list`;
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [active, setActive] = React.useState(0);
  const selected = options.find((option) => option.value === value) ?? null;
  const matches = React.useMemo(
    () => options.filter((option) => filter(option, query)),
    [options, query, filter],
  );

  const pick = (option: ComboboxOption) => {
    if (option.disabled) return;
    onChange(option.value);
    setQuery('');
    setOpen(false);
  };

  const keys = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setOpen(true);
      setActive((index) => Math.min(matches.length - 1, index + 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((index) => Math.max(0, index - 1));
    } else if (event.key === 'Enter') {
      const option = matches[active];
      if (open && option) {
        event.preventDefault();
        pick(option);
      }
    } else if (event.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Anchor asChild>
        <div
          data-slot="combobox"
          className={cn(
            'flex min-h-touch items-center gap-2 rounded-lg border border-input bg-background px-3 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring',
            className,
          )}
        >
          <MagnifyingGlass aria-hidden="true" className="size-4 shrink-0" />
          <input
            id={id}
            role="combobox"
            aria-label={label}
            aria-expanded={open}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={
              open && matches[active] ? `${listId}-${active}` : undefined
            }
            autoComplete="off"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            placeholder={selected ? selected.label : placeholder}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={keys}
          />
          {(query || selected) && (
            <button
              type="button"
              aria-label="Clear"
              className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
              onClick={() => {
                setQuery('');
                onChange(null);
              }}
            >
              <X className="size-4" />
            </button>
          )}
        </div>
      </PopoverPrimitive.Anchor>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="start"
          sideOffset={4}
          onOpenAutoFocus={(event) => event.preventDefault()}
          onInteractOutside={(event) => {
            const target = event.target as HTMLElement;
            if (target.closest('[data-slot=combobox]')) event.preventDefault();
          }}
          className="z-popover w-[var(--radix-popover-trigger-width)] overflow-hidden rounded-lg border border-border bg-raised shadow-raised outline-none"
        >
          <ul
            id={listId}
            role="listbox"
            aria-label={label}
            className="m-0 max-h-72 list-none overflow-y-auto p-1"
          >
            {matches.length === 0 && (
              <li className="px-3 py-3">
                <Caption>{empty}</Caption>
              </li>
            )}
            {matches.map((option, index) => (
              <li
                key={option.value}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={option.value === value}
                aria-disabled={option.disabled || undefined}
                data-active={index === active || undefined}
                className={cn(
                  'grid min-h-touch cursor-default content-center gap-0.5 rounded-md px-3 py-1.5 text-sm select-none aria-disabled:opacity-40 aria-selected:font-semibold data-[active]:bg-accent',
                )}
                onMouseEnter={() => setActive(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => pick(option)}
              >
                <span className="truncate">{option.label}</span>
                {option.caption && (
                  <span className="truncate text-xs text-muted-foreground">
                    {option.caption}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

function defaultFilter(option: ComboboxOption, query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return `${option.label} ${option.caption ?? ''}`.toLowerCase().includes(q);
}
