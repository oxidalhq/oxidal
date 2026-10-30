import { useEffect, useState } from 'react';
import {
  CaretDown,
  CaretLeft,
  CaretRight,
  ArrowsClockwise,
} from '@phosphor-icons/react';
import { AdjustmentDialog } from './AdjustmentDialog';
import './PresetPicker.css';
import { Button } from './components/ui/button';
import {
  choiceKey as key,
  loadPresetChoices,
  scenesLabel,
  type PresetChoice as Choice,
} from './presetChoices';

const origin = (item: Choice) =>
  item.kind === 'scenes'
    ? scenesLabel(item.scenes) || 'With effects'
    : item.owned
      ? 'My copy'
      : 'Original';

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
}: {
  pads?: boolean;
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
  const index = items.findIndex((p) => key(p) === selected);
  const currentBank = Math.min(
    Math.max(0, Math.ceil(items.length / 8) - 1),
    bank ?? Math.max(0, Math.floor(index / 8)),
  );
  function choose(item: Choice | undefined) {
    if (item && !disabled && !loading) onSelect(item);
  }
  if (pads) {
    const previous = index > 0 ? items[index - 1] : undefined;
    const next = index >= 0 ? items[index + 1] : undefined;
    return (
      <div className="preset-pads" aria-label="Preset pads">
        <h3>
          Presets
          <span>
            {items.length
              ? `${currentBank * 8 + 1}–${Math.min(items.length, currentBank * 8 + 8)} of ${items.length}`
              : ''}
          </span>
        </h3>
        <div className="preset-pad-grid">
          {items
            .slice(currentBank * 8, currentBank * 8 + 8)
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
                    {currentBank * 8 + offset + 1}
                  </span>
                  <span className="preset-pad-text">
                    <strong>{item.name}</strong>
                    <span className="preset-pad-origin">
                      {sounding ? 'Playing' : upcoming ? 'Next' : origin(item)}
                    </span>
                  </span>
                </button>
              );
            })}
        </div>
        {items.length > 8 && (
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
              {currentBank + 1} / {Math.ceil(items.length / 8)}
            </span>
            <button
              type="button"
              aria-label="Next bank"
              disabled={(currentBank + 1) * 8 >= items.length || disabled}
              onClick={() => setBank(currentBank + 1)}
            >
              <CaretRight aria-hidden="true" />
            </button>
          </div>
        )}
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
        {loading && <p role="status">Loading presets…</p>}
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
        {!loading && !error && !items.length && (
          <p>No saved presets. Add one from Library.</p>
        )}
        <p className="caption">
          Changing preset briefly interrupts audio; changing scene never does.
        </p>
      </div>
    );
  }
  const current = items[index];
  const name =
    playing.name ??
    current?.name ??
    (loading ? 'Loading presets…' : 'Unsaved preset');
  const found = query.trim().toLowerCase();
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
        <span className="preset-picker-text">
          <span className="preset-picker-title">
            <span className="preset-picker-label">{name}</span>
            {playing.modified && (
              <span
                className="preset-modified"
                role="img"
                aria-label="Modified preset"
                title="This playing sound has unsaved edits"
              />
            )}
          </span>
          <span className="preset-picker-meta">
            {playing.modified ? (
              <span className="preset-picker-edited">edited, not saved</span>
            ) : (
              'saved'
            )}
            {' · '}
            {current ? origin(current) : 'not in the list'}
            {index >= 0 && ` · ${index + 1} of ${items.length}`}
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
      {open && (
        <AdjustmentDialog
          title="Switch preset"
          className="preset-picker-dialog"
          onCancel={() => setOpen(false)}
        >
          <input
            type="search"
            className="preset-picker-search"
            aria-label="Find a preset"
            placeholder="Find a preset"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <p className="caption">
            Unsaved edits stay with each preset. Presets with scenes keep them
            until you open another preset with scenes.
          </p>
          {(
            [
              ['Scenes and effects', (p: Choice) => p.kind === 'scenes'],
              ['My copies', (p: Choice) => p.kind === 'tone3000' && p.owned],
              ['Originals', (p: Choice) => p.kind === 'tone3000' && !p.owned],
            ] as const
          ).map(([label, inGroup]) => {
            const rows = items.filter(
              (p) => inGroup(p) && p.name.toLowerCase().includes(found),
            );
            return (
              rows.length > 0 && (
                <section
                  key={label}
                  className="preset-picker-group"
                  aria-label={label}
                >
                  <h3>{label}</h3>
                  {rows.map((p) => (
                    <button
                      key={key(p)}
                      type="button"
                      className="preset-picker-row"
                      data-preset={key(p)}
                      aria-pressed={key(p) === selected}
                      disabled={disabled || loading}
                      onClick={() => {
                        setOpen(false);
                        if (key(p) !== selected) choose(p);
                      }}
                    >
                      <span>{p.name}</span>
                      {key(p) === selected ? (
                        <span className="preset-picker-playing">Playing</span>
                      ) : (
                        p.kind === 'scenes' && (
                          <span className="preset-picker-scenes">
                            {scenesLabel(p.scenes) || 'Effects'}
                          </span>
                        )
                      )}
                    </button>
                  ))}
                </section>
              )
            );
          })}
          {!loading &&
            !items.some((p) => p.name.toLowerCase().includes(found)) && (
              <p role="status">No presets match.</p>
            )}
        </AdjustmentDialog>
      )}
    </div>
  );
}
