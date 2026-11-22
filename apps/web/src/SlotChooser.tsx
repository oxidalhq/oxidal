import { ArrowLeft, MagnifyingGlass } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';

import { Button } from '@oxidal/design-system/components/button';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetHeader,
} from '@oxidal/design-system/components/sheet';
import { Loading } from '@oxidal/design-system/components/states';
import {
  EffectChoices,
  type EffectOption,
  EffectPlacement,
} from '@oxidal/design-system/patterns/block-chooser';

import {
  type EffectPacks,
  effectPacks,
  installedLv2,
  type Lv2Plugin,
} from './api';
import {
  EFFECT_TYPES,
  effectGlyph,
  effectSource,
  type EffectType,
  effectType,
} from './effectCatalog';
import { GearIcon } from './GearIcon';
import { friendlyError } from './lib/friendlyError';
import { lv2Source } from './lv2Source';
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
  modelsAllowed = true,
  placement,
  effectTitle = 'Add an effect',
  onModel,
  onEffect,
  onCancel,
}: {
  sampleRate: number;
  presetName: string;
  /** Unsaved edits are not carried into a new preset with effects. */
  modified: boolean;
  allowEffects: boolean;
  /** False at the end of a lane: only an effect fits there. */
  modelsAllowed?: boolean;
  /** 'here' adds an effect at this slot, with no before/after/split step. */
  placement?: 'here';
  /** The effect step's title, such as "Replace with…" for Replace…. */
  effectTitle?: string;
  onModel: (format: 'nam' | 'ir') => void;
  onEffect: (plugin: Lv2Plugin, placement: Placement) => void;
  onCancel: () => void;
}) {
  const [step, setStep] = useState<'kind' | 'effect' | 'place'>(
    modelsAllowed ? 'kind' : 'effect',
  );
  const [returnFocus] = useState(
    () => document.activeElement as HTMLElement | null,
  );
  const [packs, setPacks] = useState<EffectPacks['packs']>([]);
  const [plugins, setPlugins] = useState<Lv2Plugin[] | null>(null);
  const [plugin, setPlugin] = useState<Lv2Plugin | null>(null);
  const [query, setQuery] = useState('');
  const [type, setType] = useState<EffectType | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (step !== 'effect' || plugins) return;
    const abort = new AbortController();
    installedLv2(sampleRate)
      .then((all) => {
        if (abort.signal.aborted) return;
        setPlugins(
          // Our own effects first, then the rest by name.
          [...all].sort(
            (a, b) =>
              Number(!a.uri.startsWith('urn:oxidal:')) -
                Number(!b.uri.startsWith('urn:oxidal:')) ||
              a.name.localeCompare(b.name),
          ),
        );
      })
      .catch((cause) => {
        if (!abort.signal.aborted)
          setError(friendlyError(cause, 'read the available blocks'));
      });
    return () => abort.abort();
  }, [step, plugins, sampleRate]);
  useEffect(() => {
    if (step !== 'effect') return;
    const abort = new AbortController();
    void effectPacks().then(
      (state) => {
        if (!abort.signal.aborted) setPacks(state.packs);
      },
      () => {},
    );
    return () => abort.abort();
  }, [step]);
  const found = query.trim().toLowerCase();
  const usable = (p: Lv2Plugin) => !p.unsupported;
  // Only the types and sources that have effects here are offered.
  const types = EFFECT_TYPES.filter((t) =>
    plugins?.some((p) => usable(p) && effectType(p) === t),
  );
  const sources = [
    ...new Set(plugins?.filter(usable).map(effectSource) ?? []),
  ].sort(
    (a, b) =>
      Number(a !== 'Oxidal') - Number(b !== 'Oxidal') || a.localeCompare(b),
  );
  const shown = (plugins ?? [])
    .filter(
      (p) =>
        (!type || effectType(p) === type) &&
        (!source || effectSource(p) === source) &&
        (p.name.toLowerCase().includes(found) ||
          effectSource(p).toLowerCase().includes(found) ||
          effectType(p).toLowerCase().includes(found)),
    )
    // Effects that cannot run here go last.
    .sort((a, b) => Number(!usable(a)) - Number(!usable(b)));
  const options: EffectOption[] = shown.map((effect) => ({
    id: effect.uri,
    label: effect.name,
    from: effectSource(effect) === 'Oxidal' ? 'oxidal' : 'lv2',
    kind: effectType(effect),
    glyph: effectGlyph(effect),
    origin: lv2Source(effect, packs),
    disabledReason: effect.unsupported ?? undefined,
  }));
  if (!type && !source) {
    for (const pack of packs) {
      if (
        !pack.installed &&
        `${pack.name} ${pack.package}`.toLowerCase().includes(found)
      )
        options.push({
          id: `pack:${pack.id}`,
          label: pack.name,
          kind: 'Effect pack',
          from: 'lv2',
          pack: pack.name,
          installed: false,
        });
    }
  }
  const openEffect = (id: string) => {
    const effect = shown.find((item) => item.uri === id);
    if (!effect || !usable(effect)) return;
    if (placement === 'here') onEffect(effect, 'after');
    else {
      setPlugin(effect);
      setStep('place');
    }
  };
  function chips(
    label: string,
    options: readonly string[],
    value: string | null,
    choose: (value: string | null) => void,
  ) {
    return (
      options.length > 1 && (
        <div className="action-row" role="group" aria-label={label}>
          {[null, ...options].map((option) => (
            <Button
              key={option ?? 'all'}
              variant="ghost"
              aria-pressed={value === option}
              onClick={() => choose(option)}
            >
              {option ?? 'All'}
            </Button>
          ))}
        </div>
      )
    );
  }
  return (
    <Sheet open onOpenChange={(open) => !open && onCancel()}>
      <SheetContent
        onOpenChange={(open) => !open && onCancel()}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          returnFocus?.focus({ preventScroll: true });
        }}
        className="md:w-[min(30rem,100vw)]"
      >
        <SheetHeader
          title={
            step === 'kind'
              ? 'Add a block'
              : step === 'effect'
                ? effectTitle
                : 'Where should it go?'
          }
          description={
            step === 'place'
              ? 'A TONE3000 chain plays as one piece, so effects go around it.'
              : placement === 'here'
                ? 'It goes where you pressed +.'
                : undefined
          }
        />
        <SheetBody className="grid content-start gap-3">
          {(step === 'place' || (step === 'effect' && modelsAllowed)) && (
            <Button
              size="sm"
              variant="ghost"
              className="w-fit"
              onClick={() => setStep(step === 'place' ? 'effect' : 'kind')}
            >
              <ArrowLeft /> Back
            </Button>
          )}
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
                  aria-label="Effect"
                  onClick={() => setStep('effect')}
                >
                  <GearIcon gear="" name="Effect" />
                  <span>
                    <strong>Effect</strong>
                    <span>
                      {placement === 'here'
                        ? 'Pitch, Hold, delay and other effects, added here.'
                        : 'Pitch, Hold, delay and other effects, before, after or beside this chain.'}
                    </span>
                  </span>
                </button>
              )}
            </div>
          )}
          {step === 'effect' && (
            <div className="control-stack">
              <label className="flex h-10 items-center gap-2 rounded-md border border-input bg-background px-3 focus-within:outline-2 focus-within:outline-ring">
                <MagnifyingGlass
                  aria-hidden="true"
                  className="size-4 text-muted-foreground"
                />
                <span className="sr-only">Find an effect</span>
                <input
                  type="search"
                  className="min-w-0 flex-1 bg-transparent text-sm outline-none"
                  placeholder="Find an effect"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </label>
              {!plugins && !error && <Loading label="Reading effects…" />}
              {chips('Effect type', types, type, (t) =>
                setType(t as EffectType),
              )}
              {chips('Source', sources, source, setSource)}
              <EffectChoices
                options={options}
                onSelect={openEffect}
                onInstall={() => {
                  onCancel();
                  window.location.hash = 'settings/plugins';
                }}
              />
              {plugins && !options.length && (
                <p className="caption">No effects match.</p>
              )}
            </div>
          )}
          {step === 'place' && plugin && (
            <EffectPlacement
              onPlace={(where) =>
                onEffect(plugin, where === 'beside' ? 'split' : where)
              }
              note={`Makes a new preset with ${plugin.name}. ${presetName} stays as it is.${modified ? ' Save your current edits first to keep them.' : ''}`}
            />
          )}
          {error && <p role="alert">{error}</p>}
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}
