import {
  ArrowClockwise,
  CircleNotch,
  DownloadSimple,
  MagnifyingGlass,
  Play,
} from '@phosphor-icons/react';
import * as React from 'react';

import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { FilterSelect } from '../components/ui/filter-select';
import { List, ListRow } from '../components/ui/list-row';
import { Segment, SegmentedControl } from '../components/ui/segmented';
import { Progress } from '../components/ui/states';
import { Caption, Eyebrow } from '../components/ui/text';
import { glyphFor } from '../lib/block-glyphs';
import { cn } from '../lib/cn';
import { useMedia } from '../lib/use-media';
import {
  type BlockSource,
  SourceCard,
  SourcePicture,
} from '../widgets/block-source';
import { PoweredByTone3000 } from './credits';

/** The kinds of gear TONE3000 sorts its tones into. */
export type ToneGear =
  'amp' | 'amp-cab' | 'pedal' | 'outboard' | 'cab' | 'space' | 'experimental';
/** The lists TONE3000 offers to browse. */
export type ToneCollection =
  'trending' | 'latest' | 'favorites' | 'downloaded' | 'created';

/** A model or IR the block can load: one already on the device, or one from TONE3000. */
export type ModelChoice = {
  id: string;
  label: string;
  /** Model type and size, sample rate, mic. */
  caption: string;
  kind: 'amp' | 'cab' | 'pedal';
  from: 'mine' | 'tone3000';
  creator?: string;
  licence?: string;
  /** For TONE3000 choices: already downloaded to the device. */
  downloaded?: boolean;
  /**
   * How loud the model plays with its level at zero, in dB, measured once
   * when it is added to the device. Used to match loudness while trying.
   */
  loudness?: number;
  /** Its full source record (picture, creator, links), when the device has one. */
  origin?: BlockSource;
  gear?: ToneGear;
  /** Such as "Standard", "Lite" or "Feather". */
  size?: string;
  /** The models inside one TONE3000 tone, when it holds several. */
  variants?: { id: string; label: string }[];
};

export type ToneSearch = {
  query: string;
  collection: ToneCollection;
  gear: ToneGear | null;
};

export type ToneCatalogueStatus =
  | { state: 'ready'; page: number; totalPages: number }
  | { state: 'searching' }
  | { state: 'offline' }
  | { state: 'signed-out' }
  | { state: 'failed'; message: string };

/** TONE3000's catalogue as the device reports it. */
export type ToneCatalogue = {
  status: ToneCatalogueStatus;
  /** The tones found so far, across the pages loaded. */
  results: ModelChoice[];
  onSearch: (search: ToneSearch) => void;
  onMore: () => void;
  onSignIn: () => void;
  onRetry: () => void;
};

const GEAR: Record<ToneGear, string> = {
  amp: 'Amp',
  'amp-cab': 'Amp and cab',
  pedal: 'Pedal',
  outboard: 'Outboard',
  cab: 'Cab',
  space: 'Room or space',
  experimental: 'Experimental',
};
const GEAR_FOR: Record<ModelChoice['kind'], ToneGear[]> = {
  amp: ['amp', 'amp-cab', 'outboard', 'experimental'],
  cab: ['cab', 'space', 'experimental'],
  pedal: ['pedal', 'outboard', 'experimental'],
};
const COLLECTIONS: [ToneCollection, string][] = [
  ['trending', 'Trending'],
  ['latest', 'Latest'],
  ['favorites', 'My favourites'],
  ['downloaded', 'My downloads'],
  ['created', 'My tones'],
];

type Where = 'all' | 'mine' | 'tone3000';

/**
 * Find the next tone without leaving the rig: search and filter what is on
 * the device and everything on TONE3000 in one list. Try plays a model
 * through the rig at once; Get keeps a TONE3000 tone on the device. A row
 * opens in place to show its picture, creator, licence and the models the
 * tone holds, so the list never goes away.
 */
export function ModelBrowser({
  models,
  kind,
  only,
  beside = false,
  playing,
  downloads = {},
  catalogue,
  onTry,
  onGet,
}: {
  /** Models on the device; TONE3000 ones too when there is no `catalogue`. */
  models: ModelChoice[];
  /** The kind of block they are for; every kind when not given. */
  kind?: ModelChoice['kind'];
  /** Look in TONE3000 only, as Library › TONE3000 does. */
  only?: 'tone3000';
  /** On a wide screen, show the open tone beside the list. */
  beside?: boolean;
  /** The model playing now. */
  playing?: string | null;
  /** TONE3000 downloads in progress: model id → percent. */
  downloads?: Record<string, number>;
  catalogue?: ToneCatalogue;
  /** Hear it through the rig now; `variant` is one model inside the tone. */
  onTry: (choice: ModelChoice, variant?: string) => void;
  /** Keep a TONE3000 tone on the device. */
  onGet?: (choice: ModelChoice) => void;
}) {
  const [where, setWhere] = React.useState<Where>(only ?? 'all');
  const wide = useMedia('(min-width: 72rem)') && beside;
  const [query, setQuery] = React.useState('');
  const [collection, setCollection] =
    React.useState<ToneCollection>('trending');
  const [gear, setGear] = React.useState('all');
  const [size, setSize] = React.useState('all');
  const [opened, setOpened] = React.useState<string | null>(null);
  const [variants, setVariants] = React.useState<Record<string, string>>({});

  // Ask TONE3000 again a moment after the search changes.
  const search = catalogue?.onSearch;
  const asked = React.useRef(false);
  React.useEffect(() => {
    if (!search) return;
    if (!asked.current) {
      asked.current = true;
      return;
    }
    const timer = setTimeout(
      () =>
        search({
          query,
          collection,
          gear: gear === 'all' ? null : (gear as ToneGear),
        }),
      250,
    );
    return () => clearTimeout(timer);
  }, [search, query, collection, gear]);

  const words = (m: ModelChoice) =>
    `${m.label} ${m.caption} ${m.creator ?? ''}`
      .toLowerCase()
      .includes(query.toLowerCase());
  const fits = (m: ModelChoice) =>
    (!kind || m.kind === kind) && (size === 'all' || m.size === size);
  const everyTone =
    catalogue?.results ?? models.filter((m) => m.from === 'tone3000');
  const mine = models.filter((m) => m.from === 'mine' && fits(m) && words(m));
  const tones = everyTone.filter(
    (m) =>
      fits(m) &&
      // The catalogue has already searched; a plain list is searched here.
      (catalogue || (words(m) && (gear === 'all' || m.gear === gear))),
  );
  const sizes = [
    ...new Set(
      [...models, ...everyTone]
        .filter((m) => (!kind || m.kind === kind) && m.size)
        .map((m) => m.size!),
    ),
  ];
  const narrowed =
    query !== '' ||
    gear !== 'all' ||
    size !== 'all' ||
    collection !== 'trending';
  const clear = () => {
    setQuery('');
    setGear('all');
    setSize('all');
    setCollection('trending');
  };
  const status = catalogue?.status ?? {
    state: 'ready' as const,
    page: 1,
    totalPages: 1,
  };
  const showMine = where !== 'tone3000';
  const showTones = where !== 'mine';
  const listed = [...(showMine ? mine : []), ...(showTones ? tones : [])];
  const shownDetail = listed.find((m) => m.id === opened) ?? listed[0];

  const detailOf = (m: ModelChoice) => {
    const ready = m.from === 'mine' || m.downloaded;
    const busy = downloads[m.id] !== undefined;
    const variant = variants[m.id] ?? m.variants?.[0]?.id;
    return (
      <div className="grid gap-3">
        {m.origin ? (
          <SourceCard
            source={m.origin}
            className={cn(wide && 'border-0 bg-transparent p-0')}
          />
        ) : (
          <Caption className="text-sm">{m.caption}</Caption>
        )}
        {m.variants && m.variants.length > 1 && (
          <FilterSelect
            label={`Model in ${m.label}`}
            value={variant ?? ''}
            base={variant ?? ''}
            all={null}
            onValue={(v) => setVariants((all) => ({ ...all, [m.id]: v }))}
            options={m.variants.map((v) => [v.id, v.label])}
            className="w-full"
          />
        )}
        {wide && playing !== m.id && (
          <Button onClick={() => onTry(m, variant)}>Try through my rig</Button>
        )}
        {!ready && onGet && !busy && (
          <Button variant="outline" onClick={() => onGet(m)}>
            <DownloadSimple /> Keep on this device
          </Button>
        )}
      </div>
    );
  };

  const row = (m: ModelChoice) => {
    const ready = m.from === 'mine' || m.downloaded;
    const isPlaying = playing === m.id;
    const busy = downloads[m.id] !== undefined;
    const open = opened === m.id;
    const variant = variants[m.id] ?? m.variants?.[0]?.id;
    return (
      <React.Fragment key={m.id}>
        <ListRow
          title={
            beside ? (
              <span className="font-display text-lg leading-tight font-semibold">
                {m.label}
              </span>
            ) : (
              m.label
            )
          }
          className={cn(
            beside &&
              'mb-2 rounded-lg !border border-border bg-card px-3 py-2.5 last:mb-0',
            beside &&
              wide &&
              shownDetail?.id === m.id &&
              'border-foreground shadow-raised',
          )}
          selected={isPlaying}
          expanded={open}
          onClick={() => setOpened(open ? null : m.id)}
          leading={
            <SourcePicture
              source={m.origin}
              glyph={glyphFor('', `${m.kind} ${m.label}`)}
              className="ml-1 size-10"
            />
          }
          caption={[
            m.from === 'tone3000' && m.downloaded && 'Downloaded',
            m.size ?? m.caption,
            m.creator && `by ${m.creator}`,
          ]
            .filter(Boolean)
            .join(' · ')}
          trailing={
            busy ? (
              <Progress
                value={downloads[m.id] ?? 0}
                label={`Downloading ${m.label}`}
                className="w-20"
              />
            ) : isPlaying ? (
              <Badge tone="live" size="sm">
                Playing
              </Badge>
            ) : (
              <>
                {!ready && onGet && (
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Get ${m.label}`}
                    onClick={() => onGet(m)}
                  >
                    <DownloadSimple />
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  aria-label={`Try ${m.label}`}
                  onClick={() => onTry(m, variant)}
                >
                  <Play />
                  <span className="max-sm:sr-only">Try</span>
                </Button>
              </>
            )
          }
        />
        {open && !wide && (
          <div className="border-b border-border px-2 py-3">{detailOf(m)}</div>
        )}
      </React.Fragment>
    );
  };

  return (
    <div data-slot="model-browser" className="grid gap-3">
      {!only && (
        <SegmentedControl
          size="sm"
          aria-label="Where to look"
          value={where}
          onValueChange={(v) => v && setWhere(v as Where)}
          className="w-full"
        >
          <Segment value="all">All</Segment>
          <Segment value="mine">On device</Segment>
          <Segment value="tone3000">TONE3000</Segment>
        </SegmentedControl>
      )}

      <label className="flex h-10 items-center gap-2 rounded-md border border-input bg-background px-3 focus-within:outline-2 focus-within:outline-ring">
        <MagnifyingGlass
          aria-hidden="true"
          className="size-4 shrink-0 text-muted-foreground"
        />
        <span className="sr-only">Search models</span>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name, gear or creator"
          style={{ outline: 'none' }}
          className="min-w-0 flex-1 bg-transparent text-sm"
        />
      </label>

      <div className="flex flex-wrap items-center gap-2">
        {showTones && catalogue && (
          <FilterSelect
            label="TONE3000 list"
            value={collection}
            base="trending"
            all={null}
            onValue={(v) => setCollection(v as ToneCollection)}
            options={COLLECTIONS}
            className={cn(
              'min-w-0 flex-1 basis-32',
              beside && 'lg:w-48 lg:flex-none',
            )}
          />
        )}
        {showTones && (
          <FilterSelect
            label="Gear"
            value={gear}
            all="Any gear"
            onValue={setGear}
            options={(kind
              ? GEAR_FOR[kind]
              : (Object.keys(GEAR) as ToneGear[])
            ).map((g) => [g, GEAR[g]])}
            className={cn(
              'min-w-0 flex-1 basis-32',
              beside && 'lg:w-48 lg:flex-none',
            )}
          />
        )}
        {sizes.length > 1 && (
          <FilterSelect
            label="Size"
            value={size}
            all="Any size"
            onValue={setSize}
            options={sizes.map((s) => [s, s])}
            className={cn(
              'min-w-0 flex-1 basis-32',
              beside && 'lg:w-48 lg:flex-none',
            )}
          />
        )}
      </div>

      <div className="flex min-h-9 items-center justify-between gap-2">
        <Caption as="span" role="status" className="text-xs">
          {[
            showMine && `${mine.length} on this device`,
            showTones && `${tones.length} from TONE3000`,
          ]
            .filter(Boolean)
            .join(' · ')}
        </Caption>
        {narrowed && (
          <Button size="sm" variant="ghost" onClick={clear}>
            Clear filters
          </Button>
        )}
      </div>

      <div
        className={cn(
          'grid gap-4',
          wide && 'grid-cols-[minmax(0,1fr)_minmax(0,24rem)] items-start',
        )}
      >
        <div className="grid min-w-0 gap-3">
          {showMine && (
            <section aria-label="On this device" className="grid gap-1">
              <Eyebrow>On this device</Eyebrow>
              {mine.length ? (
                <List>{mine.map(row)}</List>
              ) : (
                <Caption>Nothing on this device matches.</Caption>
              )}
            </section>
          )}

          {showTones && (
            <section aria-label="From TONE3000" className="grid gap-2">
              {!only && <Eyebrow>From TONE3000</Eyebrow>}
              {status.state === 'signed-out' ? (
                <Notice
                  title="Sign in to search TONE3000"
                  about="Your favourites and downloads come with you. Models on this device still work."
                  action="Sign in"
                  onAction={catalogue?.onSignIn}
                />
              ) : status.state === 'offline' ? (
                <Notice
                  title="TONE3000 needs the internet"
                  about="Models on this device still work. Connect Oxidal to Wi-Fi in Settings › Network to search."
                  action="Try again"
                  onAction={catalogue?.onRetry}
                />
              ) : status.state === 'failed' ? (
                <Notice
                  title="TONE3000 did not answer"
                  about={status.message}
                  action="Try again"
                  onAction={catalogue?.onRetry}
                />
              ) : (
                <>
                  {tones.length > 0 && <List>{tones.map(row)}</List>}
                  {status.state === 'searching' ? (
                    <p
                      role="status"
                      className="m-0 flex items-center gap-2 text-sm text-muted-foreground"
                    >
                      <CircleNotch
                        aria-hidden="true"
                        className="size-4 animate-spin"
                      />
                      Searching TONE3000…
                    </p>
                  ) : (
                    <>
                      {tones.length === 0 && (
                        <Caption>Nothing on TONE3000 matches.</Caption>
                      )}
                      {status.page < status.totalPages && (
                        <Button
                          variant="outline"
                          className="justify-self-center"
                          onClick={catalogue?.onMore}
                        >
                          Show more
                        </Button>
                      )}
                    </>
                  )}
                </>
              )}
              <PoweredByTone3000 />
            </section>
          )}
        </div>
        {wide && shownDetail && (
          <div className="sticky top-4 rounded-lg border border-border bg-card p-4">
            {detailOf(shownDetail)}
          </div>
        )}
      </div>
    </div>
  );
}

/** One notice for a failure, with the way out. */
function Notice({
  title,
  about,
  action,
  onAction,
}: {
  title: string;
  about: string;
  action: string;
  onAction?: () => void;
}) {
  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-foreground bg-card px-3 py-2"
    >
      <span className="grid min-w-0 flex-1 basis-48 gap-0.5">
        <span className="text-sm font-semibold">{title}</span>
        <Caption as="span" className="text-xs">
          {about}
        </Caption>
      </span>
      <Button size="sm" variant="outline" onClick={onAction}>
        {action === 'Try again' && <ArrowClockwise />} {action}
      </Button>
    </div>
  );
}
