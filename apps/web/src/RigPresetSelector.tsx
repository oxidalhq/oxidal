import { useEffect, useState } from 'react';
import {
  CaretDown,
  CaretLeft,
  CaretRight,
  ArrowsClockwise,
} from '@phosphor-icons/react';
import { AdjustmentDialog } from './AdjustmentDialog';
import './PresetPicker.css';
import { nativeState, presetLibrary, type AudioState } from './api';
import { Button } from './components/ui/button';

type Choice = { id: string; name: string; owned: boolean };
const key = (item: { id: string; owned: boolean }) =>
  `${item.owned ? 'copy' : 'original'}:${item.id}`;

/** One preset picker: the playing name opens a searchable list; a row recalls it.
 * Edits stay with each preset (verified B4), so recall needs no guard prompt.
 * Immediate native recall uses the same authoritative owner as Library.
 * @see docs/audio.md
 */
export function RigPresetSelector({
  state,
  disabled,
  onSelect,
  pads = false,
}: {
  pads?: boolean;
  state: AudioState;
  disabled: boolean;
  onSelect: (id: string, owned: boolean) => void;
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
    void Promise.allSettled([presetLibrary(), nativeState()])
      .then(([originals, native]) => {
        if (!active) return;
        setItems([
          ...(native.status === 'fulfilled' ? native.value.owned : []).map(
            (p) => ({
              id: p.id,
              name: p.preset.name,
              owned: true,
            }),
          ),
          ...(originals.status === 'fulfilled' ? originals.value : []).map(
            (p) => ({
              id: p.sha256,
              name: p.name,
              owned: false,
            }),
          ),
        ]);
        setError(
          originals.status === 'rejected' && native.status === 'rejected'
            ? 'Preset list unavailable'
            : originals.status === 'rejected'
              ? 'Original presets unavailable'
              : native.status === 'rejected'
                ? 'Saved copies unavailable'
                : '',
        );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [refresh, state.saved_copy]);
  const selected =
    state.configured && !state.configured.draft
      ? key({ id: state.configured.preset_id, owned: state.configured.owned })
      : '';
  const index = items.findIndex((p) => key(p) === selected);
  const currentBank = Math.min(
    Math.max(0, Math.ceil(items.length / 8) - 1),
    bank ?? Math.max(0, Math.floor(index / 8)),
  );
  function choose(item: Choice | undefined) {
    if (item && !disabled && !loading) onSelect(item.id, item.owned);
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
              const playing = key(item) === selected;
              const upcoming = !!next && key(item) === key(next);
              return (
                <button
                  type="button"
                  key={key(item)}
                  className="preset-pad"
                  data-next={upcoming || undefined}
                  aria-pressed={playing}
                  disabled={disabled || loading || playing}
                  onClick={() => choose(item)}
                >
                  <span className="preset-pad-number">
                    {currentBank * 8 + offset + 1}
                  </span>
                  <span className="preset-pad-text">
                    <strong>{item.name}</strong>
                    <span className="preset-pad-origin">
                      {playing
                        ? 'Playing'
                        : upcoming
                          ? 'Next'
                          : item.owned
                            ? 'My copy'
                            : 'Original'}
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
          Recalling a whole preset briefly interrupts audio.
        </p>
      </div>
    );
  }
  const current = items[index];
  const name =
    state.preset_name ?? (loading ? 'Loading presets…' : 'Current rig');
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
            {state.modified && (
              <span
                className="preset-modified"
                role="img"
                aria-label="Modified preset"
                title="This playing sound has unsaved edits"
              />
            )}
          </span>
          <span className="preset-picker-meta">
            {state.modified ? (
              <span className="preset-picker-edited">edited, not saved</span>
            ) : (
              'saved'
            )}
            {' · '}
            {current ? (current.owned ? 'My copy' : 'Original') : 'Current rig'}
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
            Unsaved edits stay with each preset. Reload saved discards them.
          </p>
          {['Saved copies', 'Originals'].map((label, group) => {
            const rows = items.filter(
              (p) =>
                p.owned === (group === 0) &&
                p.name.toLowerCase().includes(found),
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
                      {key(p) === selected && (
                        <span className="preset-picker-playing">Playing</span>
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
