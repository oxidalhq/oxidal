import * as React from 'react';
import { ArrowLeft, MagnifyingGlass } from '@phosphor-icons/react';
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
import type { BlockModel } from '../widgets/block-editor';
import type { ModelChoice } from './swap-sheet';
import { SourceLine, type BlockSource } from '../widgets/block-source';
import { BlockGlyph } from '../widgets/block-glyph';
import { glyphFor } from '../lib/block-glyphs';

/** An effect the chooser offers. LV2 effects come from packs the player installs. */
export type EffectChoice = {
  id: string;
  label: string;
  kind: string;
  from: 'oxidal' | 'engine' | 'lv2';
  /** For LV2: the pack, and whether it is installed. */
  pack?: string;
  installed?: boolean;
  /** Who made it and where it comes from. */
  origin?: BlockSource;
  make: (id: string) => BlockModel;
};

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
  const id = () => `added-${(count.current += 1)}`;
  const fromModel = (m: ModelChoice): BlockModel => ({
    id: id(),
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
              {GROUPS.map((g) => {
                const list = effects.filter(
                  (e) =>
                    e.from === g.from &&
                    matches(`${e.label} ${e.kind} ${e.pack ?? ''}`),
                );
                if (!list.length) return null;
                return (
                  <section
                    key={g.from}
                    aria-label={g.title}
                    className="grid gap-1"
                  >
                    <Eyebrow>{g.title}</Eyebrow>
                    <List>
                      {list.map((e) => (
                        <ListRow
                          key={e.id}
                          leading={
                            <BlockGlyph
                              glyph={glyphFor('', `${e.kind} ${e.label}`)}
                              className="ml-1"
                            />
                          }
                          title={e.label}
                          caption={
                            e.origin ? (
                              <>
                                <span className="block">{e.kind}</span>
                                <SourceLine source={e.origin} plain />
                              </>
                            ) : (
                              `${e.kind}${e.pack ? ` · ${e.pack}` : ''}`
                            )
                          }
                          trailing={
                            e.from === 'lv2' && !e.installed ? (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => onInstall?.(e.pack!)}
                              >
                                Install in Settings…
                              </Button>
                            ) : (
                              <Button
                                size="sm"
                                variant="outline"
                                aria-label={`Add ${e.label}`}
                                onClick={() => {
                                  const made = e.make(id());
                                  const block = e.origin
                                    ? { ...made, origin: e.origin }
                                    : made;
                                  if (tone3000Chain) {
                                    setPending(block);
                                    setStep('where');
                                  } else finish(block);
                                }}
                              >
                                Add
                              </Button>
                            )
                          }
                        />
                      ))}
                    </List>
                  </section>
                );
              })}
              <Caption className="text-xs">
                LV2 packs are made by others; install them in Settings › LV2.
              </Caption>
            </>
          )}
          {step === 'where' && pending && (
            <div className="grid gap-2">
              {(
                [
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
                  [
                    'beside',
                    'In a split beside it',
                    'Runs in parallel and joins after',
                  ],
                ] as const
              ).map(([to, title, caption]) => (
                <button
                  key={to}
                  type="button"
                  onClick={() => finish(pending, to)}
                  className="grid gap-0.5 rounded-lg border border-input bg-card px-4 py-3 text-left hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  <span className="text-md font-semibold">{title}</span>{' '}
                  <span className="text-sm text-muted-foreground">
                    {caption}
                  </span>
                </button>
              ))}
              <Badge size="sm" className="justify-self-start">
                Makes a new preset; the original stays as it is
              </Badge>
            </div>
          )}
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}
