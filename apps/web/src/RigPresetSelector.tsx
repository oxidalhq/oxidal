import { useEffect, useState } from 'react';
import {
  CaretLeft,
  CaretRight,
  ArrowsClockwise,
  Stack,
} from '@phosphor-icons/react';
import { nativeState, presetLibrary, type AudioState } from './api';
import { Button } from './components/ui/button';

type Choice = { id: string; name: string; owned: boolean };
const key = (item: { id: string; owned: boolean }) =>
  `${item.owned ? 'copy' : 'original'}:${item.id}`;

/** Immediate native recall uses the same authoritative owner as Library.
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
  useEffect(() => {
    let active = true;
    void Promise.all([presetLibrary(), nativeState()])
      .then(([originals, native]) => {
        if (!active) return;
        setItems([
          ...native.owned.map((p) => ({
            id: p.id,
            name: p.preset.name,
            owned: true,
          })),
          ...originals.map((p) => ({
            id: p.sha256,
            name: p.name,
            owned: false,
          })),
        ]);
        setError('');
      })
      .catch(() => {
        if (active) setError('Preset list unavailable');
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
  if (pads)
    return (
      <div className="space-y-3" aria-label="Preset pads">
        <div className="performance-now">
          <span className="eyebrow">Playing</span>
          <h2>{state.preset_name ?? 'Current rig'}</h2>
          <span>
            {disabled
              ? 'Please wait…'
              : state.modified
                ? 'Unsaved edits'
                : 'Saved'}
          </span>
        </div>
        <div className="preset-pad-grid">
          {items
            .slice(currentBank * 8, currentBank * 8 + 8)
            .map((item, index) => (
              <Button
                key={key(item)}
                variant={key(item) === selected ? 'secondary' : 'outline'}
                aria-pressed={key(item) === selected}
                disabled={
                  disabled || loading || !!error || key(item) === selected
                }
                onClick={() => choose(item)}
              >
                <span className="preset-pad-number">
                  {String(currentBank * 8 + index + 1).padStart(2, '0')}
                </span>
                <strong>{item.name}</strong>
                <span className="preset-pad-origin">
                  {key(item) === selected
                    ? 'Playing'
                    : item.owned
                      ? 'Saved copy'
                      : 'Original'}
                </span>
              </Button>
            ))}
        </div>
        <div className="action-row">
          <Button
            variant="ghost"
            disabled={currentBank === 0 || disabled}
            onClick={() => setBank(currentBank - 1)}
          >
            <CaretLeft aria-hidden="true" />
            Previous bank
          </Button>
          <span className="caption">
            {currentBank + 1} / {Math.max(1, Math.ceil(items.length / 8))}
          </span>
          <Button
            variant="ghost"
            disabled={(currentBank + 1) * 8 >= items.length || disabled}
            onClick={() => setBank(currentBank + 1)}
          >
            Next bank
            <CaretRight aria-hidden="true" />
          </Button>
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
          Tap to play. Whole-preset recall briefly interrupts audio; this is not
          scene switching.
        </p>
      </div>
    );
  return (
    <div className="rig-preset-selector" aria-label="Preset navigation">
      <Button
        variant="outline"
        aria-label="Previous preset"
        disabled={disabled || loading || index <= 0}
        onClick={() => choose(items[index - 1])}
      >
        <CaretLeft aria-hidden="true" />
      </Button>
      <label className="rig-preset-field">
        <span>
          <Stack aria-hidden="true" /> Preset
        </span>
        <select
          aria-label="Playing preset"
          value={index < 0 ? '' : selected}
          disabled={disabled || loading || !!error}
          onChange={(e) => choose(items.find((p) => key(p) === e.target.value))}
        >
          {index < 0 && (
            <option value="">
              {state.preset_name ??
                (loading ? 'Loading presets…' : 'Current rig')}
            </option>
          )}
          {['Saved copies', 'Originals'].map((label, group) => (
            <optgroup key={label} label={label}>
              {items
                .filter((p) => p.owned === (group === 0))
                .map((p) => (
                  <option key={key(p)} value={key(p)}>
                    {p.name}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
      </label>
      <Button
        variant="outline"
        aria-label="Next preset"
        disabled={disabled || loading || index < 0 || index >= items.length - 1}
        onClick={() => choose(items[index + 1])}
      >
        <CaretRight aria-hidden="true" />
      </Button>
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
    </div>
  );
}
