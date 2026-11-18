import { useMemo, useState } from 'react';
import { flushSync } from 'react-dom';

import { Button } from '@oxidal/design-system/components/button';
import {
  Segment,
  SegmentedControl,
} from '@oxidal/design-system/components/segmented';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@oxidal/design-system/components/select';
import {
  Loading,
  StateNotice,
  StepProgress,
} from '@oxidal/design-system/components/states';

import './oxidal.css';
import { factoryEngineLabels, factoryGenres } from '../../../factoryMetadata';
import {
  setReturnTarget,
  useScrollMemory,
  useSessionState,
} from '../../../lib/sessionState';
import type { CardHandlers } from './cardActions';
import { DetailsSheet } from './DetailsSheet';
import { GetTonesDialog } from './GetTonesDialog';
import {
  cardState,
  complexityLabels,
  filterItems,
  type Filters,
  groupItems,
  noFilters,
  type SoundItem,
  summaryLine,
} from './oxidalSounds.model';
import { SoundCard } from './SoundCard';
import { useOxidalSounds } from './useOxidalSounds';

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: [string, string][];
  onChange: (value: string) => void;
}) {
  return (
    <label className="oxidal-filter">
      <span>{label}</span>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All</SelectItem>
          {options.map(([id, text]) => (
            <SelectItem key={id} value={id}>
              {text}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}

/**
 * Oxidal sounds: every sound in the collection, finished, in one
 * browser. Each card has exactly one primary action; Details opens one sheet.
 * @see docs/factory-collection.md
 */
export function OxidalSounds({
  connected,
  onChanged,
  onOpenRig,
}: {
  connected: boolean;
  onChanged: () => void;
  onOpenRig?: () => void;
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
  const [filtersOpen, setFiltersOpen] = useState(false);
  useScrollMemory('oxidal-sounds', unit.items.length > 0);

  const states = useMemo(
    () => new Map(unit.items.map((i) => [i.key, cardState(i, unit.facts)])),
    [unit.items, unit.facts],
  );
  const shown = filterItems(unit.items, filters);
  const groups = groupItems(shown, filters.groupBy);
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
  const active = (['genre', 'engine', 'complexity'] as const).filter(
    (k) => filters[k] !== 'all',
  ).length;
  const set = (patch: Partial<Filters>) =>
    setFilters((f) => ({ ...f, ...patch }));
  const detailItem = byKey(details);
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
      onDetails={() => setDetails(item.key)}
    />
  );

  return (
    <section className="oxidal-sounds" aria-label="Oxidal sounds">
      <div className="oxidal-filters">
        <input
          type="search"
          value={filters.query}
          onChange={(event) => set({ query: event.target.value })}
          placeholder="Search Oxidal sounds"
          aria-label="Search Oxidal sounds"
          className="h-11 w-full min-w-0 rounded-md border border-input bg-card px-3"
        />
        <Button
          variant="outline"
          className="oxidal-filters-toggle"
          aria-expanded={filtersOpen}
          onClick={() => setFiltersOpen((open) => !open)}
        >
          Filters{active ? ` ${active}` : ''}
        </Button>
        <div className="oxidal-filter-set" data-open={filtersOpen || undefined}>
          <FilterSelect
            label="Genre"
            value={filters.genre}
            options={factoryGenres.map((g) => [g, g])}
            onChange={(genre) => set({ genre })}
          />
          <FilterSelect
            label="Engine"
            value={filters.engine}
            options={Object.entries(factoryEngineLabels)}
            onChange={(engine) => set({ engine })}
          />
          <FilterSelect
            label="Complexity"
            value={filters.complexity}
            options={Object.entries(complexityLabels)}
            onChange={(complexity) => set({ complexity })}
          />
        </div>
      </div>
      <div className="oxidal-summary">
        <p role="status">{summaryLine(shown.length, [...states.values()])}</p>
        <div className="oxidal-summary-actions">
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
          {(active > 0 || filters.query) && (
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
      {unit.loadError && (
        <StateNotice kind="error" title="Oxidal sounds unavailable">
          Oxidal could not read the installed effects and library. You can still
          browse these sounds, but they cannot be played from here.{' '}
          {unit.loadError}
        </StateNotice>
      )}
      {!unit.facts.ready && !unit.loadError && (
        <Loading label="Checking this unit…" />
      )}
      {shown.length === 0 && (
        <p role="status" className="py-4 text-muted-foreground">
          No Oxidal sounds match these filters.
        </p>
      )}
      {groups.map((group) => (
        <section
          key={group.label}
          aria-label={group.label}
          className="oxidal-group"
        >
          <div className="oxidal-group-head">
            <h3>{group.label}</h3>
            <span className="caption">{group.items.length}</span>
          </div>
          <div className="oxidal-cards">{group.items.map(card)}</div>
        </section>
      ))}
      {detailItem && (
        <DetailsSheet
          item={detailItem}
          state={states.get(detailItem.key)!}
          unit={unit}
          handlers={handlers}
          onClose={() => setDetails(null)}
        />
      )}
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
