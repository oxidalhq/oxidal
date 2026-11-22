import { ArrowLeft, MagnifyingGlass } from '@phosphor-icons/react';
import * as React from 'react';

import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { List, ListRow } from '../components/ui/list-row';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetHeader,
} from '../components/ui/sheet';
import { Caption, Eyebrow } from '../components/ui/text';
import { glyphFor, type GlyphKey } from '../lib/block-glyphs';
import type { BlockModel } from '../widgets/block-editor';
import { BlockGlyph } from '../widgets/block-glyph';
import { type BlockSource, SourceLine } from '../widgets/block-source';
import type { ModelChoice } from './swap-sheet';

/** An effect the chooser offers. LV2 effects come from packs the player installs. */
export type EffectOption = {
  id: string;
  label: string;
  kind: string;
  from: 'oxidal' | 'engine' | 'lv2';
  /** For LV2: the pack, and whether it is installed. */
  pack?: string;
  installed?: boolean;
  /** Who made it and where it comes from. */
  origin?: BlockSource;
  disabledReason?: string;
  glyph?: GlyphKey;
};

export type EffectChoice = EffectOption & { make: (id: string) => BlockModel };

export type Placement = 'before' | 'after' | 'beside';

const GROUPS: { from: EffectChoice['from']; title: string }[] = [
  { from: 'oxidal', title: "Oxidal's own" },
  { from: 'engine', title: 'TONE3000 engine' },
  { from: 'lv2', title: 'LV2 packs' },
];

/**
 * What to add at a + in the route, in two steps at most:
 *
 * 1. **What**: an amp or pedal capture (NAM), a cab or room (IR), or an
 *    effect, with search. Effects from LV2 packs that are not installed are
 *    listed with where to install them, never installed from here.
 * 2. **Where**, only when an effect meets a TONE3000 chain, which cannot
 *    take effects inside it: before it, after it, or in a split beside it.
 *    That makes a new preset with the effect; the original stays as it is.
 */
export function BlockChooser({
  open,
  onOpenChange,
  models,
  effects,
  tone3000Chain = false,
  onChoose,
  onInstall,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  models: ModelChoice[];
  effects: EffectChoice[];
  /** The + is inside a TONE3000 chain: effects need a placement. */
  tone3000Chain?: boolean;
  onChoose: (block: BlockModel, placement?: Placement) => void;
  onInstall?: (pack: string) => void;
}) {
  const [step, setStep] = React.useState<
    'what' | 'nam' | 'ir' | 'effect' | 'where'
  >('what');
  const [query, setQuery] = React.useState('');
  const [pending, setPending] = React.useState<BlockModel | null>(null);
  // Closing starts the next visit from the first step.
  const close = (next: boolean) => {
    if (!next) {
      setStep('what');
      setQuery('');
      setPending(null);
    }
    onOpenChange(next);
  };

  const q = query.toLowerCase();
  const matches = (text: string) => text.toLowerCase().includes(q);
  const finish = (block: BlockModel, placement?: Placement) => {
    onChoose(block, placement);
    close(false);
  };
  const count = React.useRef(0);
  const nextId = () => `added-${(count.current += 1)}`;
  const fromModel = (m: ModelChoice): BlockModel => ({
    id: nextId(),
    label: m.label,
    kind: m.kind === 'cab' ? 'cab' : m.kind === 'pedal' ? 'pedal' : 'amp',
    caption: m.caption,
    on: true,
    unsaved: true,
    controls: [
      {
        id: 'level',
        label: 'Level',
        value: 0,
        min: -24,
        max: 12,
        unit: 'dB',
        main: true,
      },
    ],
  });

  const back = step !== 'what' && (
    <Button
      size="sm"
      variant="ghost"
      onClick={() => setStep(step === 'where' ? 'effect' : 'what')}
    >
      <ArrowLeft /> Back
    </Button>
  );
  const search = (placeholder: string) => (
    <label className="flex h-10 items-center gap-2 rounded-md border border-input bg-background px-3 focus-within:outline-2 focus-within:outline-ring">
      <MagnifyingGlass
        aria-hidden="true"
        className="size-4 text-muted-foreground"
      />
      <span className="sr-only">{placeholder}</span>
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={placeholder}
        style={{ outline: 'none' }}
        className="min-w-0 flex-1 bg-transparent text-sm"
      />
    </label>
  );

  return (
    <Sheet open={open} onOpenChange={close}>
      <SheetContent onOpenChange={close} className="md:w-[min(30rem,100vw)]">
        <SheetHeader
          title={step === 'where' ? 'Where should it go?' : 'Add a block'}
          description={
            step === 'where'
              ? 'A TONE3000 chain plays as one piece, so effects go around it.'
              : 'It goes where you pressed +.'
          }
        />
        <SheetBody className="grid content-start gap-3">
          {back}
          {step === 'what' && (
            <div className="grid gap-2">
              {[
                [
                  'nam',
                  'Amp or pedal',
                  'A NAM capture from your device or TONE3000',
                ],
                ['ir', 'Cab or room', 'An impulse response'],
                [
                  'effect',
                  'Effect',
                  'Drive, delay, reverb, modulation, dynamics and more',
                ],
              ].map(([to, title, caption]) => (
                <button
                  key={to}
                  type="button"
                  onClick={() => setStep(to as 'nam' | 'ir' | 'effect')}
                  className="grid gap-0.5 rounded-lg border border-input bg-card px-4 py-3 text-left hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  <span className="text-md font-semibold">{title}</span>{' '}
                  <span className="text-sm text-muted-foreground">
                    {caption}
                  </span>
                </button>
              ))}
            </div>
          )}
          {(step === 'nam' || step === 'ir') && (
            <>
              {search(step === 'nam' ? 'Find a capture' : 'Find an IR')}
              <List>
                {models
                  .filter((m) =>
                    step === 'ir' ? m.kind === 'cab' : m.kind !== 'cab',
                  )
                  .filter((m) => matches(`${m.label} ${m.caption}`))
                  .map((m) => (
                    <ListRow
                      key={m.id}
                      title={m.label}
                      caption={`${m.caption}${m.from === 'tone3000' ? ' · TONE3000' : ''}`}
                      trailing={
                        <Button
                          size="sm"
                          variant="outline"
                          aria-label={`Add ${m.label}`}
                          onClick={() => finish(fromModel(m))}
                        >
                          Add
                        </Button>
                      }
                    />
                  ))}
              </List>
            </>
          )}
          {step === 'effect' && (
            <>
              {search('Find an effect')}
              <EffectChoices
                options={effects.filter((effect) =>
                  matches(
                    `${effect.label} ${effect.kind} ${effect.pack ?? ''}`,
                  ),
                )}
                onSelect={(id) => {
                  const effect = effects.find((item) => item.id === id)!;
                  const made = effect.make(nextId());
                  const block = effect.origin
                    ? { ...made, origin: effect.origin }
                    : made;
                  if (tone3000Chain) {
                    setPending(block);
                    setStep('where');
                  } else finish(block);
                }}
                onInstall={onInstall}
              />
              <Caption className="text-xs">
                LV2 packs are made by others; install them in Settings › LV2.
              </Caption>
            </>
          )}
          {step === 'where' && pending && (
            <EffectPlacement
              onPlace={(placement) => finish(pending, placement)}
              note="Makes a new preset; the original stays as it is"
            />
          )}
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}

/** @see BlockChooser */
export function EffectChoices({
  options,
  onSelect,
  onInstall,
}: {
  options: EffectOption[];
  onSelect: (id: string) => void;
  onInstall?: (pack: string) => void;
}) {
  return GROUPS.map(({ from, title }) => {
    const list = options.filter((effect) => effect.from === from);
    return list.length ? (
      <section key={from} aria-label={title} className="grid gap-1">
        <Eyebrow>{title}</Eyebrow>
        <List>
          {list.map((effect) => (
            <ListRow
              key={effect.id}
              leading={
                <BlockGlyph
                  glyph={
                    effect.glyph ??
                    glyphFor('', `${effect.kind} ${effect.label}`)
                  }
                  className="ml-1"
                />
              }
              title={effect.label}
              caption={
                effect.disabledReason ??
                (effect.origin ? (
                  <>
                    <span className="block">{effect.kind}</span>
                    <SourceLine source={effect.origin} plain />
                  </>
                ) : (
                  [effect.kind, effect.pack].filter(Boolean).join(' · ')
                ))
              }
              trailing={
                effect.from === 'lv2' && effect.installed === false ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => effect.pack && onInstall?.(effect.pack)}
                  >
                    Install in Settings…
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    aria-label={`Add ${effect.label}`}
                    disabled={!!effect.disabledReason}
                    onClick={() => onSelect(effect.id)}
                  >
                    Add
                  </Button>
                )
              }
            />
          ))}
        </List>
      </section>
    ) : null;
  });
}

const placements: [Placement, string, string][] = [
  [
    'before',
    'Before the TONE3000 chain',
    'Into the amp, like a pedal on the floor',
  ],
  [
    'after',
    'After the TONE3000 chain',
    'Like an effects loop or a studio rack',
  ],
  ['beside', 'In a split beside it', 'Runs in parallel and joins after'],
];

/** @see BlockChooser */
export function EffectPlacement({
  onPlace,
  note,
}: {
  onPlace: (placement: Placement) => void;
  note: string;
}) {
  return (
    <div className="grid gap-2">
      {placements.map(([placement, title, caption]) => (
        <button
          key={placement}
          type="button"
          onClick={() => onPlace(placement)}
          className="grid gap-0.5 rounded-lg border border-input bg-card px-4 py-3 text-left hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <span className="text-md font-semibold">{title}</span>{' '}
          <span className="text-sm text-muted-foreground">{caption}</span>
        </button>
      ))}
      <Badge size="sm" className="justify-self-start whitespace-normal">
        {note}
      </Badge>
    </div>
  );
}
