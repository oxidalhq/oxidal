import {
  ArrowsDownUp,
  MagnifyingGlass,
  Play,
  Star,
  X,
} from '@phosphor-icons/react';
import * as React from 'react';

import { Badge, Led } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu';
import { Segment, SegmentedControl } from '../components/ui/segmented';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetHeader,
} from '../components/ui/sheet';
import { EmptyState } from '../components/ui/states';
import { Caption } from '../components/ui/text';
import { Toggle } from '../components/ui/toggle';
import { glyphForBlock } from '../lib/block-glyphs';
import { cn } from '../lib/cn';
import { useMedia } from '../lib/use-media';
import { BlockGlyph } from '../widgets/block-glyph';
import {
  type BlockSource,
  SourceCard,
  SourceLine,
  SourcePicture,
} from '../widgets/block-source';
import type { BlockKind } from '../widgets/chain';

export type LibraryItem = {
  id: string;
  title: string;
  caption?: string;
  kind?: BlockKind;
  artwork?: string;
  badge?: { text: string; tone?: 'neutral' | 'live' | 'warning' | 'selected' };
  playable?: boolean;
  favourite?: boolean;
  /** Where it comes from: shown on the row, and in full in the details. */
  origin?: BlockSource;
  /** What it is for, in one sentence. */
  about?: string;
  /** What is inside it, in order. */
  chain?: { kind: BlockKind; label: string }[];
  /** Plain facts for the details: label and value. */
  facts?: [string, string][];
  /** For sorting: when it was last used, how often, when it was added (any increasing numbers). */
  lastUsed?: number;
  plays?: number;
  added?: number;
};

const SORTS = [
  { id: 'recent', label: 'Recently used' },
  { id: 'name', label: 'Name' },
  { id: 'plays', label: 'Most played' },
  { id: 'added', label: 'Newest' },
] as const;
type SortId = (typeof SORTS)[number]['id'];

function sortItems(items: LibraryItem[], sort: SortId) {
  const by = (pick: (i: LibraryItem) => number) =>
    [...items].sort(
      (a, b) => pick(b) - pick(a) || a.title.localeCompare(b.title),
    );
  if (sort === 'name')
    return [...items].sort((a, b) => a.title.localeCompare(b.title));
  if (sort === 'recent') return by((i) => i.lastUsed ?? 0);
  if (sort === 'plays') return by((i) => i.plays ?? 0);
  return by((i) => i.added ?? 0);
}

export type RowAction = {
  label: string;
  icon?: React.ReactNode;
  destructive?: boolean;
  run: (id: string) => void;
};

function MiniChain({ chain }: { chain: NonNullable<LibraryItem['chain']> }) {
  const shown = chain.slice(0, 6);
  return (
    <span aria-hidden="true" className="inline-flex items-center">
      {shown.map((b, i) => (
        <span key={`${b.label}-${i}`} className="inline-flex items-center">
          {i > 0 && <span className="h-px w-2 bg-wire" />}
          <span className="rounded inline-flex items-center gap-1 border border-border bg-background px-1 py-0.5">
            <Led kind={b.kind} className="size-1.5" />
            <BlockGlyph glyph={glyphForBlock(b)} className="size-3.5" />
          </span>
        </span>
      ))}
      {chain.length > shown.length && (
        <span className="ml-1 text-2xs text-muted-foreground">
          +{chain.length - shown.length}
        </span>
      )}
    </span>
  );
}

const pictureOf = (item: LibraryItem, tile?: React.ReactNode) =>
  tile && !item.kind && !item.origin ? (
    <span
      aria-hidden="true"
      className="grid size-11 place-items-center rounded-md border border-border bg-background text-muted-foreground [&_svg]:size-5"
    >
      {tile}
    </span>
  ) : (
    <SourcePicture
      source={item.origin}
      glyph={glyphForBlock({
        kind: item.kind ?? 'amp',
        label: item.title,
        caption: item.caption,
        origin: item.origin,
      })}
      className="size-11"
    />
  );

/** The same selectable row is used for saved rigs, native preset files and the library stories. */
export function LibraryRow({
  item,
  active,
  leading,
  actions,
  onOpen,
  openPrefix,
  testId,
}: {
  item: LibraryItem;
  active: boolean;
  leading: React.ReactNode;
  actions: React.ReactNode;
  onOpen?: () => void;
  openPrefix?: string;
  testId?: string;
}) {
  return (
    <li
      data-testid={testId}
      data-slot="library-row"
      data-active={active || undefined}
      className={cn(
        'relative grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-lg border border-border bg-card px-3 py-2.5 hover:border-foreground/40',
        active && 'border-foreground shadow-raised',
      )}
    >
      <span className="relative z-10">{leading}</span>
      <button
        type="button"
        aria-pressed={active}
        onClick={onOpen}
        disabled={!onOpen}
        className="grid min-w-0 gap-1 text-left outline-none after:absolute after:inset-0 after:rounded-lg focus-visible:after:outline-2 focus-visible:after:outline-ring"
      >
        <span className="truncate font-display text-lg leading-tight font-semibold">
          {openPrefix && <span className="sr-only">{openPrefix} </span>}
          {item.title}
        </span>
        {item.caption && (
          <span className="truncate text-sm text-muted-foreground">
            {item.caption}
          </span>
        )}
        {(item.chain || item.origin || item.badge) && (
          <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 pt-0.5">
            {item.chain && <MiniChain chain={item.chain} />}
            {item.origin && <SourceLine source={item.origin} plain />}
            {item.badge && (
              <Badge tone={item.badge.tone} size="sm">
                {item.badge.text}
              </Badge>
            )}
          </span>
        )}
      </button>
      <span className="relative z-10 flex flex-wrap items-center justify-end gap-1">
        {actions}
      </span>
    </li>
  );
}

/** Everything about one item, with every action one tap away. */
function ItemDetail({
  item,
  main,
  actions,
  extra,
  tile,
  showTitle,
}: {
  item: LibraryItem;
  tile?: React.ReactNode;
  main?: RowAction | null;
  actions: RowAction[];
  extra?: React.ReactNode;
  showTitle: boolean;
}) {
  const others = actions.filter(
    (a) => !a.destructive && a.label !== main?.label,
  );
  const dangerous = actions.filter((a) => a.destructive);
  return (
    <div data-slot="library-detail" className="grid gap-3">
      {showTitle && (
        <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3">
          {item.artwork ? (
            <img
              src={item.artwork}
              alt=""
              className="size-11 rounded-md border border-border object-cover"
            />
          ) : (
            pictureOf(item, tile)
          )}
          <div className="grid min-w-0 gap-0.5">
            <h2 className="m-0 truncate font-display text-xl leading-tight font-semibold">
              {item.title}
            </h2>
            {item.caption && (
              <Caption as="span" className="text-xs">
                {item.caption}
              </Caption>
            )}
          </div>
        </div>
      )}
      {item.about && <Caption className="text-sm">{item.about}</Caption>}
      {item.chain && <MiniChain chain={item.chain} />}
      {main && (
        <Button className="w-full" onClick={() => main.run(item.id)}>
          {main.icon} {main.label}
        </Button>
      )}
      {others.length > 0 && (
        <div className="grid grid-cols-2 gap-2">
          {others.map((action) => (
            <Button
              key={action.label}
              size="sm"
              variant="outline"
              className="min-w-0"
              onClick={() => action.run(item.id)}
            >
              {action.icon} <span className="truncate">{action.label}</span>
            </Button>
          ))}
        </div>
      )}
      {extra}
      {item.facts && (
        <dl className="m-0 grid gap-1 border-t border-border pt-2">
          {item.facts.map(([label, value]) => (
            <div
              key={label}
              className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-2 text-sm"
            >
              <dt className="small-caps text-xs text-muted-foreground">
                {label}
              </dt>
              <dd className="m-0 min-w-0 break-words">{value}</dd>
            </div>
          ))}
        </dl>
      )}
      {item.origin && <SourceCard source={item.origin} />}
      {dangerous.map((action) => (
        <Button
          key={action.label}
          size="sm"
          variant="destructive"
          className="justify-self-start"
          onClick={() => action.run(item.id)}
        >
          {action.icon} {action.label}
        </Button>
      ))}
    </div>
  );
}

/**
 * A Library section, built the way Oxidal sounds is: a list you can scan,
 * one word of status and one labelled action on every row, and the details
 * beside the list (a sheet on phones) with every other action in plain sight.
 * Nothing hides behind a menu.
 *
 * Sorted libraries (everything but the set list) are not dragged: the Sort
 * menu orders them by Recently used, Name, Most played or Newest, and the
 * star keeps favourites one tap away with the Favourites filter.
 */
export function LibraryList({
  items,
  query,
  onQuery,
  filters,
  filter,
  onFilter,
  view = 'list',
  onView,
  selected,
  onOpen,
  onPlay,
  mainAction,
  actions = [],
  detail,
  layout = 'detail',
  tile,
  noun = ['item', 'items'],
  empty,
  primary,
  sortable = true,
  onFavourite,
  className,
}: {
  items: LibraryItem[];
  query: string;
  onQuery: (query: string) => void;
  filters?: { id: string; label: string }[];
  filter?: string;
  onFilter?: (id: string) => void;
  view?: 'list' | 'artwork';
  onView?: (view: 'list' | 'artwork') => void;
  selected?: string | null;
  onOpen: (id: string) => void;
  onPlay?: (id: string) => void;
  /** The one thing people come here to do, labelled on every row. */
  mainAction?: (item: LibraryItem) => RowAction | null;
  /** Everything else, in plain sight in the details. */
  actions?: RowAction[];
  /** More for the details of one item, such as its stems. */
  detail?: (item: LibraryItem) => React.ReactNode;
  /** `list` when the page shows the open item itself, as the Songbook does. */
  layout?: 'detail' | 'list';
  /** The picture for rows that have none of their own. */
  tile?: React.ReactNode;
  /** What the rows are: one and many. */
  noun?: [string, string];
  empty: { title: string; text?: string };
  /** The one action for this section: New preset, Import…, Split a track… */
  primary?: React.ReactNode;
  /** Offer the Sort menu (off for lists the player orders by hand). */
  sortable?: boolean;
  /** Offer the favourite star and the Favourites filter. */
  onFavourite?: (id: string, on: boolean) => void;
  className?: string;
}) {
  const wide = useMedia('(min-width: 72rem)');
  const [sheet, setSheet] = React.useState(false);
  const [sort, setSort] = React.useState<SortId>(
    items.some((i) => i.lastUsed) ? 'recent' : 'name',
  );
  const [favouritesOnly, setFavouritesOnly] = React.useState(false);
  const filtered = items.filter(
    (item) =>
      (!favouritesOnly || item.favourite) &&
      (!query ||
        `${item.title} ${item.caption ?? ''}`
          .toLowerCase()
          .includes(query.toLowerCase())),
  );
  const shown = sortable ? sortItems(filtered, sort) : filtered;
  const sortLabel = SORTS.find((s) => s.id === sort)!.label;
  const beside = layout === 'detail';
  const current = beside
    ? (shown.find((i) => i.id === selected) ?? (wide ? shown[0] : undefined))
    : undefined;
  const open = (id: string) => {
    onOpen(id);
    setSheet(true);
  };
  const details = (item: LibraryItem, showTitle: boolean) => (
    <ItemDetail
      item={item}
      main={mainAction?.(item)}
      actions={actions}
      extra={detail?.(item)}
      tile={tile}
      showTitle={showTitle}
    />
  );
  const count =
    shown.length === items.length
      ? `${items.length} ${items.length === 1 ? noun[0] : noun[1]}`
      : `${shown.length} of ${items.length} ${noun[1]}`;
  return (
    <div
      data-slot="library-list"
      className={cn('grid content-start gap-3', className)}
    >
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex min-h-touch min-w-48 flex-1 items-center gap-2 rounded-lg border border-input bg-background px-3 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring">
          <MagnifyingGlass
            aria-hidden="true"
            className="size-4 shrink-0 text-muted-foreground"
          />
          <input
            type="search"
            aria-label="Search"
            placeholder="Find…"
            value={query}
            onChange={(event) => onQuery(event.target.value)}
            // The field's own frame shows focus; the input inside must not add a second ring.
            style={{ outline: 'none' }}
            className="min-w-0 flex-1 bg-transparent text-sm placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
          />
          {query && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => onQuery('')}
              className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          )}
        </label>
        {primary && (
          <span
            className={cn(
              'flex flex-wrap gap-2',
              layout === 'list' && 'w-full [&>*]:flex-1',
            )}
          >
            {primary}
          </span>
        )}
      </div>
      {(filters || onView || sortable || onFavourite) && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          {filters && onFilter && (
            <SegmentedControl
              size="sm"
              value={filter}
              onValueChange={onFilter}
              aria-label="Filter"
            >
              {filters.map((f) => (
                <Segment key={f.id} value={f.id}>
                  {f.label}
                </Segment>
              ))}
            </SegmentedControl>
          )}
          <span className="flex flex-wrap items-center gap-2">
            {onFavourite && (
              <Toggle
                size="sm"
                pressed={favouritesOnly}
                onPressedChange={setFavouritesOnly}
              >
                <Star weight={favouritesOnly ? 'fill' : 'regular'} /> Favourites
              </Toggle>
            )}
            {sortable && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="outline">
                    <ArrowsDownUp /> {sortLabel}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuLabel>Sort by</DropdownMenuLabel>
                  {SORTS.map((s) => (
                    <DropdownMenuCheckboxItem
                      key={s.id}
                      checked={sort === s.id}
                      onSelect={() => setSort(s.id)}
                    >
                      {s.label}
                    </DropdownMenuCheckboxItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {onView && (
              <SegmentedControl
                size="sm"
                value={view}
                onValueChange={(v) => onView(v as 'list' | 'artwork')}
                aria-label="View"
              >
                <Segment value="list">List</Segment>
                <Segment value="artwork">Artwork</Segment>
              </SegmentedControl>
            )}
          </span>
        </div>
      )}
      <Caption as="span" role="status" className="text-sm">
        {count}
      </Caption>
      <div
        className={cn(
          'grid gap-4',
          beside &&
            wide &&
            'grid-cols-[minmax(0,1fr)_minmax(0,24rem)] items-start',
        )}
      >
        {shown.length === 0 ? (
          <EmptyState
            title={
              query
                ? `Nothing matches “${query}”`
                : favouritesOnly
                  ? 'No favourites here yet'
                  : empty.title
            }
          >
            {query
              ? 'Try fewer letters.'
              : favouritesOnly
                ? 'Tap the star on anything you reach for often.'
                : empty.text}
          </EmptyState>
        ) : view === 'artwork' ? (
          <ul
            aria-label="Items"
            className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-3 p-0"
          >
            {shown.map((item) => (
              <li key={item.id} className="grid gap-1.5">
                <button
                  type="button"
                  aria-pressed={item.id === current?.id}
                  onClick={() => open(item.id)}
                  className={cn(
                    'grid gap-1.5 rounded-pad text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                    item.id === current?.id &&
                      '[&>span:first-child]:border-foreground [&>span:first-child]:shadow-raised',
                  )}
                >
                  <span className="grid aspect-square w-full place-items-center overflow-hidden rounded-pad border border-border bg-card">
                    {item.artwork ? (
                      <img
                        src={item.artwork}
                        alt=""
                        className="size-full object-cover"
                      />
                    ) : (
                      <span className="font-display text-3xl font-semibold text-muted-foreground">
                        {item.title.slice(0, 1)}
                      </span>
                    )}
                  </span>
                  <span className="truncate text-sm font-medium">
                    {item.title}
                  </span>
                  {item.caption && (
                    <Caption as="span" className="truncate text-xs">
                      {item.caption}
                    </Caption>
                  )}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <ul aria-label={noun[1]} className="m-0 grid list-none gap-2 p-0">
            {shown.map((item) => {
              const active = item.id === (current?.id ?? selected);
              const main = mainAction?.(item);
              return (
                <LibraryRow
                  key={item.id}
                  item={item}
                  active={active}
                  onOpen={() => open(item.id)}
                  leading={
                    item.playable && onPlay ? (
                      <Button
                        size="icon"
                        variant="outline"
                        aria-label={`Play ${item.title}`}
                        onClick={() => onPlay(item.id)}
                        className="rounded-full"
                      >
                        <Play weight="fill" />
                      </Button>
                    ) : item.artwork ? (
                      <img
                        src={item.artwork}
                        alt=""
                        className="size-11 rounded-md border border-border object-cover"
                      />
                    ) : (
                      pictureOf(item, tile)
                    )
                  }
                  actions={
                    <>
                      {onFavourite && (
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          aria-pressed={!!item.favourite}
                          aria-label={`Favourite ${item.title}`}
                          onClick={() => onFavourite(item.id, !item.favourite)}
                        >
                          <Star weight={item.favourite ? 'fill' : 'regular'} />
                        </Button>
                      )}
                      {main && (
                        <Button
                          size="sm"
                          variant="outline"
                          aria-label={`${main.label}: ${item.title}`}
                          onClick={() => main.run(item.id)}
                        >
                          {main.icon}
                          <span className="max-sm:sr-only">{main.label}</span>
                        </Button>
                      )}
                    </>
                  }
                />
              );
            })}
          </ul>
        )}
        {beside && wide && current && (
          <div className="sticky top-4 rounded-lg border border-border bg-card p-4">
            {details(current, true)}
          </div>
        )}
      </div>
      {beside && !wide && (
        <Sheet open={sheet && Boolean(current)} onOpenChange={setSheet}>
          <SheetContent onOpenChange={setSheet}>
            <SheetHeader
              title={current?.title ?? ''}
              description={current?.caption}
            />
            <SheetBody>{current && details(current, false)}</SheetBody>
          </SheetContent>
        </Sheet>
      )}
    </div>
  );
}
