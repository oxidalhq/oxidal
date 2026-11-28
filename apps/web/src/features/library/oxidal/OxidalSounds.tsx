import { type ReactNode, useMemo, useState } from 'react';
import { flushSync } from 'react-dom';

import { Button } from '@oxidal/design-system/components/button';
import { FilterSelect } from '@oxidal/design-system/components/filter-select';
import {
  Segment,
  SegmentedControl,
} from '@oxidal/design-system/components/segmented';
import { StepProgress } from '@oxidal/design-system/components/states';
import { Caption } from '@oxidal/design-system/components/text';
import { useMedia } from '@oxidal/design-system/lib/use-media';
import {
  ReadySoundsFilter,
  SoundBrowserStatus,
  SoundSearch,
} from '@oxidal/design-system/patterns/sound-browser';

import { factoryEngineLabels, factoryGenres } from '../../../factoryMetadata';
import {
  setReturnTarget,
  useScrollMemory,
  useSessionState,
} from '../../../lib/sessionState';
import type { CardHandlers } from './cardActions';
import { SoundDetails } from './DetailsSheet';
import { GetTonesDialog } from './GetTonesDialog';
import {
  cardState,
  complexityLabels,
  filterItems,
  type Filters,
  groupItems,
  isPlayable,
  noFilters,
  soundEffects,
  type SoundItem,
  summaryLine,
} from './oxidalSounds.model';
import { SoundCard } from './SoundCard';
import { useOxidalSounds } from './useOxidalSounds';

/**
 * Oxidal sounds: every sound in the collection, finished, in one
 * browser. Each card has exactly one primary action; Details opens one sheet.
 * @see docs/factory-collection.md
 */
/** Sounds per page before Load more. */
const PAGE = 24;

export function OxidalSounds({
  connected,
  onChanged,
  onOpenRig,
  starterOffer,
}: {
  connected: boolean;
  onChanged: () => void;
  onOpenRig?: () => void;
  starterOffer?: ReactNode;
}) {
  const unit = useOxidalSounds({ connected, onChanged, onOpenRig });
  const [filters, setFilters] = useSessionState<Filters>(
    'oxidal-sounds-filters',
    noFilters,
  );
  const [pending, setPending] = useSessionState<string | null>(
    'oxidal-sounds-signin',
    null,
  );
  const [details, setDetails] = useState<string | null>(null);
  const [tones, setTones] = useState<string | null>(null);
  const wide = useMedia('(min-width: 64rem)');
  const offline = Boolean(unit.loadError || (!connected && unit.facts.ready));
  useScrollMemory('oxidal-sounds', unit.items.length > 0);

  const states = useMemo(
    () =>
      new Map(
        unit.items.map((i) => [
          i.key,
          cardState(i, offline ? { ...unit.facts, ready: false } : unit.facts),
        ]),
      ),
    [unit.items, unit.facts, offline],
  );
  const effects = useMemo(
    () => [...new Set(unit.items.flatMap(soundEffects))].sort(),
    [unit.items],
  );
  const shown = filterItems(unit.items, filters).filter(
    (item) => !filters.readyOnly || isPlayable(states.get(item.key)!),
  );
  // A page at a time, as Mine does: 185 sounds were one 18,000 px page.
  // The count belongs to these filters: changing them starts a page again.
  const filterKey = JSON.stringify(filters);
  const [page, setPage] = useState({ key: filterKey, limit: PAGE });
  const limit = page.key === filterKey ? page.limit : PAGE;
  const groups = groupItems(shown.slice(0, limit), filters.groupBy);
  const byKey = (key: string | null) =>
    unit.items.find((item) => item.key === key) ?? null;

  const handlers: CardHandlers = {
    getTones: (item) => setTones(item.key),
    signIn: (item) => {
      // Stored before the page changes, so the dialog can return.
      flushSync(() => setPending(item.key));
      setReturnTarget({
        hash: window.location.hash || '#library',
        label: 'Oxidal sounds',
      });
      window.location.hash = 'settings/accounts';
    },
  };
  const active = (['genre', 'engine', 'complexity', 'effect'] as const).filter(
    (k) => !!filters[k] && filters[k] !== 'all',
  ).length;
  const set = (patch: Partial<Filters>) =>
    setFilters((f) => ({ ...f, ...patch }));
  const detailItem =
    shown.find((item) => item.key === details) ??
    (wide ? groups[0]?.items[0] : undefined);
  const detail = detailItem && (
    <SoundDetails
      key={detailItem.key}
      item={detailItem}
      state={states.get(detailItem.key)!}
      unit={unit}
      handlers={handlers}
      inline={wide}
      onClose={() => setDetails(null)}
    />
  );
  // After TONE3000 sign-in the same Get tones dialog returns.
  const tonesItem =
    byKey(tones) ??
    (unit.facts.ready && unit.facts.signedIn === true ? byKey(pending) : null);

  const card = (item: SoundItem) => (
    <SoundCard
      key={item.key}
      item={item}
      state={states.get(item.key)!}
      unit={unit}
      handlers={handlers}
      active={detailItem?.key === item.key}
      onDetails={() => setDetails(item.key)}
    />
  );

  return (
    <section className="grid min-w-0 gap-3" aria-label="Oxidal sounds">
      {connected && starterOffer}
      <SoundBrowserStatus
        status={
          offline
            ? { state: 'offline' }
            : unit.facts.ready
              ? { state: 'ready' }
              : { state: 'checking', checked: 0 }
        }
        total={unit.items.length}
        onRetry={unit.retryRead}
      />
      <div className="grid gap-2">
        <SoundSearch
          query={filters.query}
          onQuery={(query) => set({ query })}
        />
        <div className="flex flex-wrap items-center gap-2">
          <FilterSelect
            label="Genre"
            value={filters.genre}
            options={factoryGenres.map((g) => [g, g])}
            onValue={(genre) => set({ genre })}
          />
          <FilterSelect
            label="Engine"
            value={filters.engine}
            options={Object.entries(factoryEngineLabels)}
            onValue={(engine) => set({ engine })}
          />
          <FilterSelect
            label="Effect"
            value={filters.effect ?? 'all'}
            options={effects.map((effect) => [effect, effect])}
            onValue={(effect) => set({ effect })}
          />
          <FilterSelect
            label="Complexity"
            value={filters.complexity}
            options={Object.entries(complexityLabels)}
            onValue={(complexity) => set({ complexity })}
          />
          <ReadySoundsFilter
            checked={!!filters.readyOnly}
            onChange={(readyOnly) => set({ readyOnly })}
          />
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p role="status">
          {offline
            ? shown.length === unit.items.length
              ? `${unit.items.length} sounds`
              : `${shown.length} of ${unit.items.length} sounds`
            : summaryLine(shown.length, [...states.values()])}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <SegmentedControl
            value={filters.groupBy}
            aria-label="Group by"
            onValueChange={(value) => {
              if (value === 'genre' || value === 'engine')
                set({ groupBy: value });
            }}
          >
            <Segment value="genre">Genre</Segment>
            <Segment value="engine">Engine</Segment>
          </SegmentedControl>
          {(active > 0 || filters.query || filters.readyOnly) && (
            <Button
              variant="ghost"
              onClick={() =>
                setFilters({ ...noFilters, groupBy: filters.groupBy })
              }
            >
              Clear filters
            </Button>
          )}
        </div>
      </div>
      {unit.progress && (
        <StepProgress
          {...unit.progress}
          cancelling={unit.cancelling}
          onCancel={unit.cancelBuild}
        />
      )}
      {unit.notice && <p role="status">{unit.notice}</p>}
      {unit.error && <p role="alert">{unit.error}</p>}
      {shown.length === 0 && (
        <p role="status" className="py-4 text-muted-foreground">
          No Oxidal sounds match these filters.
        </p>
      )}
      <div
        className={
          wide && detail
            ? 'grid grid-cols-[minmax(0,1fr)_minmax(0,24rem)] items-start gap-4'
            : 'grid gap-4'
        }
      >
        <div className="grid min-w-0 gap-3">
          {groups.map((group) => (
            <section
              key={group.label}
              aria-label={group.label}
              className="grid gap-2"
            >
              <div className="flex items-baseline justify-between border-b border-border pb-1">
                <h3>{group.label}</h3>
                <Caption as="span">{group.items.length}</Caption>
              </div>
              <div className="grid gap-2">{group.items.map(card)}</div>
            </section>
          ))}
          {shown.length > limit && (
            <div className="flex flex-wrap items-center gap-3">
              <Button
                variant="outline"
                onClick={() => setPage({ key: filterKey, limit: limit + PAGE })}
              >
                Load more
              </Button>
              <Caption as="span">
                {limit} of {shown.length} shown
              </Caption>
            </div>
          )}
        </div>
        {detail}
      </div>
      {tonesItem && (
        <GetTonesDialog
          item={tonesItem}
          unit={unit}
          onClose={() => {
            setPending(null);
            setTones(null);
          }}
        />
      )}
    </section>
  );
}
