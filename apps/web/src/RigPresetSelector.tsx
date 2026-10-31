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
  loadPresetChoices,
  scenesLabel,
  type PresetChoice as Choice,
} from './presetChoices';

const originLabel = (item: Choice) =>
  item.origin === 'mine'
    ? item.kind === 'scenes'
      ? scenesLabel(item.scenes) || 'With effects'
      : 'My copy'
    : item.origin === 'oxidal_example'
      ? 'Oxidal example'
      : 'TONE3000';

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
                          : originLabel(item)}
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
  const found = query.trim().toLowerCase();
  const foundItems = items.filter((item) =>
    detailsMatch(item.name, item.details, found),
  );
  const groups = (
    [
      ['mine', 'Mine'],
      ['oxidal_example', 'Oxidal examples'],
      ['tone3000', 'TONE3000'],
    ] as const
  ).map(([origin, label]) => ({
    origin,
    label,
    items: foundItems.filter((item) => item.origin === origin),
  }));
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
            {current ? originLabel(current) : 'not in the list'}
            {index >= 0 && ` · ${index + 1} of ${pickerItems.length}`}
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
          entry={{
            kind:
              preview.kind === 'scenes'
                ? 'rig'
                : preview.owned
                  ? 'owned'
                  : 'original',
            id: preview.kind === 'scenes' ? preview.revision : preview.id,
            name: preview.name,
          }}
          onCancel={() => setPreview(null)}
        />
      )}
      {open && !preview && (
        <AdjustmentDialog
          title="Switch preset"
          className="preset-picker-dialog"
          onCancel={() => setOpen(false)}
        >
          {current && (
            <PresetManagement
              entry={{
                kind:
                  current.kind === 'scenes'
                    ? 'rig'
                    : current.owned
                      ? 'owned'
                      : 'original',
                id: current.kind === 'scenes' ? current.revision : current.id,
                name: current.name,
              }}
              disabled={disabled}
              label="Manage current preset"
              onChanged={() => setRefresh((v) => v + 1)}
            />
          )}
          <input
            type="search"
            className="preset-picker-search"
            aria-label="Find a preset"
            placeholder="Find a preset"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <p className="caption">
            Mine is your set list. Editing a TONE3000 preset or Oxidal example
            makes a copy in Mine; the original stays unchanged.
          </p>
          {groups.map(
            (group) =>
              group.items.length > 0 && (
                <section
                  key={group.origin}
                  className="preset-picker-group"
                  aria-label={group.label}
                >
                  <h3>{group.label}</h3>
                  {group.items.map((p) => (
                    <div key={key(p)} className="preset-picker-entry">
                      <button
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
                        <span
                          className={
                            key(p) === selected
                              ? 'preset-picker-playing'
                              : 'preset-picker-scenes'
                          }
                        >
                          {key(p) === selected ? 'Playing' : originLabel(p)}
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
                    </div>
                  ))}
                </section>
              ),
          )}
          {!loading && !foundItems.length && (
            <p role="status">No presets match.</p>
          )}
        </AdjustmentDialog>
      )}
    </div>
  );
}
