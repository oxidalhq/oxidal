import * as React from 'react';
import {
  ArrowsDownUp,
  DotsThree,
  Info,
  MagnifyingGlass,
  Play,
  Star,
  X,
} from '@phosphor-icons/react';
import { cn } from '../lib/cn';
import { Badge, Led } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu';
import { List, ListRow } from '../components/ui/list-row';
import { Segment, SegmentedControl } from '../components/ui/segmented';
import { EmptyState } from '../components/ui/states';
import { Caption } from '../components/ui/text';
import { Toggle } from '../components/ui/toggle';
import type { BlockKind } from '../widgets/chain';
import { BlockGlyph } from '../widgets/block-glyph';
import { glyphForBlock } from '../lib/block-glyphs';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetHeader,
} from '../components/ui/sheet';
import {
  SourceCard,
  SourceLine,
  type BlockSource,
} from '../widgets/block-source';

export type LibraryItem = {
  id: string;
  title: string;
  caption?: string;
  kind?: BlockKind;
  artwork?: string;
  badge?: { text: string; tone?: 'neutral' | 'live' | 'warning' | 'selected' };
  playable?: boolean;
  favourite?: boolean;
  /** Where it comes from: shown on the row, and in full from About. */
  origin?: BlockSource;
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
  destructive?: boolean;
  run: (id: string) => void;
};

/**
 * A Library section: search, a filter row, List or Artwork, and the items
 * as rows (or cards) that open on tap, play from their leading button and
 * carry their actions in one menu. The empty state names the way in.
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
  actions = [],
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
  actions?: RowAction[];
  empty: { title: string; text?: string };
  /** The one action for this section: New preset, Import…, Split a track… */
  primary?: React.ReactNode;
  /** Offer the Sort menu (off for lists the player orders by hand). */
  sortable?: boolean;
  /** Offer the favourite star and the Favourites filter. */
  onFavourite?: (id: string, on: boolean) => void;
  className?: string;
}) {
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
  const [about, setAbout] = React.useState<LibraryItem | null>(null);
  const menu = (item: LibraryItem) =>
    (actions.length > 0 || item.origin) && (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={`Actions for ${item.title}`}
          >
            <DotsThree weight="bold" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          {item.origin && (
            <DropdownMenuItem onSelect={() => setAbout(item)}>
              <Info /> About {item.title}
            </DropdownMenuItem>
          )}
          {actions
            .filter((a) => !a.destructive)
            .map((action) => (
              <DropdownMenuItem
                key={action.label}
                onSelect={() => action.run(item.id)}
              >
                {action.label}
              </DropdownMenuItem>
            ))}
          {actions.some((a) => a.destructive) && <DropdownMenuSeparator />}
          {actions
            .filter((a) => a.destructive)
            .map((action) => (
              <DropdownMenuItem
                key={action.label}
                destructive
                onSelect={() => action.run(item.id)}
              >
                {action.label}
              </DropdownMenuItem>
            ))}
        </DropdownMenuContent>
      </DropdownMenu>
    );
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
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
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
        {primary}
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
            <li key={item.id} className="relative grid gap-1.5">
              <button
                type="button"
                aria-pressed={item.id === selected}
                onClick={() => onOpen(item.id)}
                className={cn(
                  'grid gap-1.5 rounded-pad text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                  item.id === selected &&
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
                {item.origin && <SourceLine source={item.origin} plain />}
              </button>
              <span className="absolute top-1 right-1 flex gap-1">
                {menu(item)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <List>
          {shown.map((item) => (
            <ListRow
              key={item.id}
              title={item.title}
              caption={
                item.origin ? (
                  <>
                    {item.caption && (
                      <span className="block truncate">{item.caption}</span>
                    )}
                    <SourceLine
                      source={item.origin}
                      plain
                      className={cn(
                        item.id === selected && 'text-background/80',
                      )}
                    />
                  </>
                ) : (
                  item.caption
                )
              }
              selected={item.id === selected}
              onClick={() => onOpen(item.id)}
              leading={
                item.playable && onPlay ? (
                  <Button
                    size="icon-sm"
                    variant="outline"
                    aria-label={`Play ${item.title}`}
                    onClick={() => onPlay(item.id)}
                    className={cn(
                      item.id === selected &&
                        'border-background text-background',
                    )}
                  >
                    <Play weight="fill" />
                  </Button>
                ) : item.kind ? (
                  <span className="relative ml-1 grid size-9 place-items-center rounded-md border border-border">
                    <BlockGlyph
                      glyph={glyphForBlock({
                        kind: item.kind,
                        label: item.title,
                        caption: item.caption,
                        origin: item.origin,
                      })}
                    />
                    <Led
                      kind={item.kind}
                      className="absolute -top-1 -right-1 size-2"
                    />
                  </span>
                ) : item.artwork ? (
                  <img
                    src={item.artwork}
                    alt=""
                    className="size-9 rounded-md border border-border object-cover"
                  />
                ) : undefined
              }
              trailing={
                <>
                  {item.badge && (
                    <Badge
                      tone={item.badge.tone}
                      size="sm"
                      className={cn(
                        item.id === selected &&
                          'border-background/60 text-background',
                      )}
                    >
                      {item.badge.text}
                    </Badge>
                  )}
                  {onFavourite && (
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-pressed={!!item.favourite}
                      aria-label={`Favourite ${item.title}`}
                      onClick={() => onFavourite(item.id, !item.favourite)}
                      className={cn(
                        item.id === selected &&
                          'text-background hover:text-foreground',
                      )}
                    >
                      <Star weight={item.favourite ? 'fill' : 'regular'} />
                    </Button>
                  )}
                  {menu(item)}
                </>
              }
            />
          ))}
        </List>
      )}
      <Sheet open={Boolean(about)} onOpenChange={(o) => !o && setAbout(null)}>
        <SheetContent
          onOpenChange={(o) => !o && setAbout(null)}
          className="md:w-[min(28rem,100vw)]"
        >
          <SheetHeader
            title={about?.title ?? ''}
            description="Where it comes from"
          />
          <SheetBody>
            {about?.origin && <SourceCard source={about.origin} />}
          </SheetBody>
        </SheetContent>
      </Sheet>
    </div>
  );
}
