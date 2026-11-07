import { Loading } from './components/ui/loading';
import { useEffect, useState } from 'react';
import {
  CaretDown,
  CaretLeft,
  CaretRight,
  ArrowsClockwise,
} from '@phosphor-icons/react';
import { AdjustmentDialog } from './AdjustmentDialog';
import { PresetDetailsDialog } from './PresetDetails';
import { detailsMatch } from './presetMetadata';
import { PresetManagement } from './PresetManagement';
import './PresetPicker.css';
import { Button } from './components/ui/button';
import {
  choiceKey as key,
  choiceSource,
  choiceSummary,
  loadPresetChoices,
  type PresetChoice as Choice,
} from './presetChoices';
import { useSessionState } from './lib/sessionState';

type Source = Choice['origin'];
const SOURCES: [Source, string][] = [
  ['mine', 'Set list'],
  ['oxidal_example', 'Oxidal'],
  ['tone3000', 'TONE3000'],
];

/** One preset picker for every engine: the playing name opens a searchable list
 * of all presets, those with scenes first; a row plays it. Scenes are switched
 * by the pads under it, never from this list.
 * Edits stay with each preset (verified B4), so recall needs no guard prompt.
 * @see docs/audio.md
 */
export function RigPresetSelector({
  current: playing,
  disabled,
  onSelect,
  pads = false,
  all = false,
}: {
  pads?: boolean;
  /** With pads: every preset on one scrolling page, with the steps first. */
  all?: boolean;
  /** The playing preset: its list key ('' for a draft), name and edit state. */
  current: {
    key: string;
    name: string | null | undefined;
    modified: boolean;
    /** Changes when the list may have changed, such as after a save. */
    refresh?: unknown;
  };
  disabled: boolean;
  onSelect: (choice: Choice) => void;
}) {
  const [bank, setBank] = useState<number | null>(null);
  const [items, setItems] = useState<Choice[]>([]);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [preview, setPreview] = useState<Choice | null>(null);
  // The chooser's source tab, kept for this browser tab (7.27).
  const [source, setSource] = useSessionState<Source | null>(
    'preset-chooser-source',
    null,
  );
  useEffect(() => {
    let active = true;
    void loadPresetChoices()
      .then((loaded) => {
        if (!active) return;
        setItems(loaded.items);
        setError(loaded.error);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [refresh, playing.refresh]);
  const selected = playing.key;
  const pickerItems = pads
    ? items.filter((item) => item.origin === 'mine')
    : items;
  const index = pickerItems.findIndex((p) => key(p) === selected);
  const size = all ? Math.max(pickerItems.length, 8) : 8;
  const currentBank = Math.min(
    Math.max(0, Math.ceil(pickerItems.length / size) - 1),
    bank ?? Math.max(0, Math.floor(index / size)),
  );
  function choose(item: Choice | undefined) {
    if (item && !disabled && !loading) onSelect(item);
  }
  if (pads) {
    const previous = index > 0 ? pickerItems[index - 1] : undefined;
    const next = index >= 0 ? pickerItems[index + 1] : undefined;
    const steps = (
      <div className="preset-step">
        <button
          type="button"
          aria-label={
            previous ? `Previous preset: ${previous.name}` : 'Previous preset'
          }
          disabled={disabled || loading || !previous}
          onClick={() => choose(previous)}
        >
          <span>‹ Previous</span>
          <strong>{previous?.name ?? '—'}</strong>
        </button>
        <button
          type="button"
          aria-label={next ? `Next preset: ${next.name}` : 'Next preset'}
          disabled={disabled || loading || !next}
          onClick={() => choose(next)}
        >
          <span>Next ›</span>
          <strong>{next?.name ?? '—'}</strong>
        </button>
      </div>
    );
    return (
      <div className="preset-pads" aria-label="Preset pads">
        <h3>
          Presets
          <span>
            {pickerItems.length
              ? `${currentBank * size + 1}–${Math.min(pickerItems.length, currentBank * size + size)} of ${pickerItems.length}`
              : ''}
          </span>
        </h3>
        {all && steps}
        <div className="preset-pad-grid">
          {pickerItems
            .slice(currentBank * size, currentBank * size + size)
            .map((item, offset) => {
              const sounding = key(item) === selected;
              const upcoming = !!next && key(item) === key(next);
              return (
                <button
                  type="button"
                  key={key(item)}
                  className="preset-pad"
                  data-next={upcoming || undefined}
                  aria-pressed={sounding}
                  disabled={disabled || loading || sounding}
                  onClick={() => choose(item)}
                >
                  <span className="preset-pad-number">
                    {currentBank * size + offset + 1}
                  </span>
                  <span className="preset-pad-text">
                    <strong>{item.name}</strong>
                    <span className="preset-pad-origin">
                      {sounding
                        ? 'Playing'
                        : upcoming
                          ? 'Next'
                          : choiceSummary(item)}
                    </span>
                  </span>
                </button>
              );
            })}
        </div>
        {pickerItems.length > size && (
          <div className="preset-bank">
            <button
              type="button"
              aria-label="Previous bank"
              disabled={currentBank === 0 || disabled}
              onClick={() => setBank(currentBank - 1)}
            >
              <CaretLeft aria-hidden="true" />
            </button>
            <span>
              {currentBank + 1} / {Math.ceil(pickerItems.length / size)}
            </span>
            <button
              type="button"
              aria-label="Next bank"
              disabled={
                (currentBank + 1) * size >= pickerItems.length || disabled
              }
              onClick={() => setBank(currentBank + 1)}
            >
              <CaretRight aria-hidden="true" />
            </button>
          </div>
        )}
        {!all && steps}
        {loading && <Loading label="Loading presets…" />}
        {error && (
          <div role="status">
            {error}
            <Button
              variant="ghost"
              onClick={() => {
                setLoading(true);
                setRefresh((v) => v + 1);
              }}
            >
              Retry presets
            </Button>
          </div>
        )}
        {!loading && !error && !pickerItems.length && (
          <p>
            No presets in Mine yet. Edit an original or add one from Library.
          </p>
        )}
        <p className="caption">
          Changing preset briefly interrupts audio; changing scene never does.
        </p>
      </div>
    );
  }
  const current = pickerItems[index];
  const name =
    current?.name ??
    playing.name ??
    (loading ? 'Loading presets…' : 'Unsaved preset');
  const setList = items.filter((item) => item.origin === 'mine');
  /** Set-list number (1-based) of a preset, or 0 when it is not in the set list. */
  const number = (item: Choice | undefined) =>
    item ? setList.findIndex((p) => key(p) === key(item)) + 1 : 0;
  const playingNumber = number(current);
  const found = query.trim().toLowerCase();
  const foundItems = items.filter((item) =>
    detailsMatch(item.name, item.details, found),
  );
  const shownSource: Source = source ?? current?.origin ?? 'mine';
  const shown = found
    ? foundItems
    : items.filter((item) => item.origin === shownSource);
  const entryOf = (item: Choice) => ({
    kind:
      item.kind === 'scenes'
        ? ('rig' as const)
        : item.owned
          ? ('owned' as const)
          : ('original' as const),
    id: item.kind === 'scenes' ? item.revision : item.id,
    name: item.name,
  });
  return (
    <div className="preset-picker" aria-label="Preset navigation">
      <button
        type="button"
        className="preset-picker-name"
        aria-label={`Playing preset: ${name}`}
        aria-haspopup="dialog"
        title={name}
        disabled={disabled || (loading && !items.length)}
        onClick={() => {
          setQuery('');
          setOpen(true);
        }}
      >
        {playingNumber > 0 && (
          <span className="preset-picker-number" aria-hidden="true">
            {playingNumber}
          </span>
        )}
        <span className="preset-picker-text">
          <span className="preset-picker-title">
            <span className="preset-picker-label">{name}</span>
            {playing.modified && (
              <span className="preset-picker-edited">
                <span
                  className="preset-modified"
                  role="img"
                  aria-label="Modified preset"
                  title="This playing sound has unsaved edits"
                />
                edited
              </span>
            )}
          </span>
          <span className="preset-picker-meta">
            {current ? choiceSummary(current) : 'Not saved yet'}
            {playingNumber > 0
              ? ` · Set list ${playingNumber} of ${setList.length}`
              : current
                ? ` · ${choiceSource(current)}`
                : ''}
          </span>
        </span>
        <CaretDown aria-hidden="true" />
      </button>
      {error && (
        <div className="rig-preset-error" role="status">
          <span>{error}</span>
          <Button
            variant="ghost"
            onClick={() => {
              setLoading(true);
              setRefresh((v) => v + 1);
            }}
          >
            <ArrowsClockwise aria-hidden="true" /> Retry presets
          </Button>
        </div>
      )}
      {preview && (
        <PresetDetailsDialog
          entry={entryOf(preview)}
          onCancel={() => setPreview(null)}
        >
          {current && key(preview) === key(current) && (
            <PresetManagement
              entry={entryOf(current)}
              disabled={disabled}
              label="Manage preset"
              onChanged={() => setRefresh((v) => v + 1)}
            />
          )}
        </PresetDetailsDialog>
      )}
      {open && !preview && (
        <AdjustmentDialog
          title="Choose a preset"
          className="preset-picker-dialog"
          onCancel={() => setOpen(false)}
        >
          <input
            type="search"
            className="preset-picker-search"
            aria-label="Find a preset"
            placeholder="Find a preset or sound…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {!found && (
            <div
              className="preset-picker-sources"
              role="tablist"
              aria-label="Preset source"
            >
              {SOURCES.map(([origin, label]) => (
                <button
                  key={origin}
                  type="button"
                  role="tab"
                  aria-selected={shownSource === origin}
                  onClick={() => setSource(origin)}
                >
                  {label}{' '}
                  <span className="preset-picker-count">
                    {items.filter((item) => item.origin === origin).length}
                  </span>
                </button>
              ))}
            </div>
          )}
          <ul
            className="preset-picker-group"
            aria-label={
              found
                ? 'Matching presets'
                : (SOURCES.find(([o]) => o === shownSource)?.[1] ?? '')
            }
          >
            {shown.map((p) => {
              const playingRow = key(p) === selected;
              const n = number(p);
              return (
                <li key={key(p)} className="preset-picker-entry">
                  <span className="preset-picker-number" aria-hidden="true">
                    {n || ''}
                  </span>
                  <button
                    type="button"
                    className="preset-picker-row"
                    data-preset={key(p)}
                    aria-pressed={playingRow}
                    disabled={disabled || loading}
                    ref={(element) => {
                      if (playingRow && element)
                        element.scrollIntoView({ block: 'center' });
                    }}
                    onClick={() => {
                      setOpen(false);
                      if (!playingRow) choose(p);
                    }}
                  >
                    <span>{p.name}</span>
                    <span
                      className={
                        playingRow
                          ? 'preset-picker-playing'
                          : 'preset-picker-scenes'
                      }
                    >
                      {playingRow ? 'Playing · ' : ''}
                      {choiceSummary(p)}
                      {found && ` · ${choiceSource(p)}`}
                    </span>
                  </button>
                  <Button
                    variant="ghost"
                    className="shrink-0 px-2"
                    aria-label={`Details: ${p.name}`}
                    onClick={() => setPreview(p)}
                  >
                    Details
                  </Button>
                </li>
              );
            })}
          </ul>
          {!loading && !shown.length && (
            <p role="status">
              {found ? 'No presets match.' : 'Nothing here yet.'}
            </p>
          )}
          <p className="caption">
            Oxidal and TONE3000 presets open as they are; editing one saves a
            copy to your set list.
          </p>
        </AdjustmentDialog>
      )}
    </div>
  );
}
