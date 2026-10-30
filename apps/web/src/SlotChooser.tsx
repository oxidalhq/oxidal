import { useEffect, useState } from 'react';
import { AdjustmentDialog } from './AdjustmentDialog';
import { installedLv2, type Lv2Plugin } from './api';
import { Button } from './components/ui/button';
import { GearIcon } from './GearIcon';
import type { Placement } from './slotEffects';

/**
 * What goes in an empty slot: an amp/pedal capture or a cab/room straight into
 * the chain, or an effect. Effects cannot enter a TONE3000 chain, so for one
 * the player chooses before it, after it, or a split beside it; that makes a
 * new preset with effects and leaves the original as it is.
 * @see docs/interface.md
 */
export function SlotChooser({
  sampleRate,
  presetName,
  modified,
  allowEffects,
  onModel,
  onEffect,
  onCancel,
}: {
  sampleRate: number;
  presetName: string;
  /** Unsaved edits are not carried into a new preset with effects. */
  modified: boolean;
  allowEffects: boolean;
  onModel: (format: 'nam' | 'ir') => void;
  onEffect: (plugin: Lv2Plugin, placement: Placement) => void;
  onCancel: () => void;
}) {
  const [step, setStep] = useState<'kind' | 'effect' | 'place'>('kind');
  const [plugins, setPlugins] = useState<Lv2Plugin[] | null>(null);
  const [plugin, setPlugin] = useState<Lv2Plugin | null>(null);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    if (step !== 'effect' || plugins) return;
    const abort = new AbortController();
    installedLv2(sampleRate, abort.signal)
      .then((all) =>
        setPlugins(
          // Our own effects first, then the rest by name.
          [...all].sort(
            (a, b) =>
              Number(!a.uri.startsWith('urn:oxidal:')) -
                Number(!b.uri.startsWith('urn:oxidal:')) ||
              a.name.localeCompare(b.name),
          ),
        ),
      )
      .catch((cause) => {
        if (!abort.signal.aborted) setError(String(cause));
      });
    return () => abort.abort();
  }, [step, plugins, sampleRate]);
  const found = query.trim().toLowerCase();
  return (
    <AdjustmentDialog
      title={
        step === 'kind'
          ? 'Add to this slot'
          : step === 'effect'
            ? 'Add an effect'
            : `Where does ${plugin?.name ?? 'it'} go?`
      }
      onCancel={onCancel}
    >
      {step === 'kind' && (
        <div className="add-block-list">
          <button
            type="button"
            className="add-block-option"
            aria-label="Add NAM"
            onClick={() => onModel('nam')}
          >
            <GearIcon gear="amp" />
            <span>
              <strong>Amp, pedal or rig capture</strong>
              <span>A NAM model, straight into this slot.</span>
            </span>
          </button>
          <button
            type="button"
            className="add-block-option"
            aria-label="Add IR"
            onClick={() => onModel('ir')}
          >
            <GearIcon gear="ir" />
            <span>
              <strong>Cabinet or room</strong>
              <span>An impulse response, straight into this slot.</span>
            </span>
          </button>
          {allowEffects && (
            <button
              type="button"
              className="add-block-option"
              aria-label="Add effect"
              onClick={() => setStep('effect')}
            >
              <GearIcon gear="" name="Effect" />
              <span>
                <strong>Effect</strong>
                <span>
                  Pitch, Hold, delay and other effects, before, after or beside
                  this chain.
                </span>
              </span>
            </button>
          )}
        </div>
      )}
      {step === 'effect' && (
        <div className="control-stack">
          <input
            type="search"
            className="preset-picker-search"
            aria-label="Find an effect"
            placeholder="Find an effect"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {!plugins && !error && <p role="status">Reading effects…</p>}
          <div className="menu-list" aria-label="Effects">
            {plugins
              ?.filter((p) => p.name.toLowerCase().includes(found))
              .map((p) => (
                <button
                  key={p.uri}
                  type="button"
                  disabled={!!p.unsupported}
                  onClick={() => {
                    setPlugin(p);
                    setStep('place');
                  }}
                >
                  {p.name}
                  {p.unsupported && (
                    <span className="caption">{p.unsupported}</span>
                  )}
                </button>
              ))}
          </div>
        </div>
      )}
      {step === 'place' && plugin && (
        <div className="control-stack">
          <div className="menu-list" aria-label="Placement">
            {(
              [
                ['before', 'Straight, before', `Into ${presetName}.`],
                ['after', 'Straight, after', `Out of ${presetName}.`],
                [
                  'split',
                  'Split',
                  `Beside ${presetName}, the two mixed together.`,
                ],
              ] as const
            ).map(([placement, title, detail]) => (
              <button
                key={placement}
                type="button"
                onClick={() => onEffect(plugin, placement)}
              >
                {title}
                <span className="caption">{detail}</span>
              </button>
            ))}
          </div>
          <p className="caption">
            Effects cannot go inside a TONE3000 chain, so this makes a new
            preset with effects; {presetName} stays as it is.
            {modified &&
              ' It starts from the saved version: save your edits first to keep them.'}
          </p>
          <Button variant="ghost" onClick={() => setStep('effect')}>
            Back
          </Button>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
    </AdjustmentDialog>
  );
}
