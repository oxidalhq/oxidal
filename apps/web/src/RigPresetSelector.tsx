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
}: {
  state: AudioState;
  disabled: boolean;
  onSelect: (id: string, owned: boolean) => void;
}) {
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
  function choose(item: Choice | undefined) {
    if (item && !disabled && !loading) onSelect(item.id, item.owned);
  }
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
              {loading
                ? 'Loading presets…'
                : (state.preset_name ?? 'Current rig')}
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
        <Button
          variant="ghost"
          onClick={() => {
            setLoading(true);
            setRefresh((v) => v + 1);
          }}
        >
          <ArrowsClockwise aria-hidden="true" />
          Retry presets
        </Button>
      )}
      {error && <span role="status">{error}</span>}
    </div>
  );
}
