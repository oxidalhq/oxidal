import * as React from 'react';
import { ArrowCounterClockwise, Check } from '@phosphor-icons/react';
import { cn } from '../lib/cn';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { List, ListRow } from '../components/ui/list-row';
import { Switch } from '../components/ui/switch';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '../components/ui/tabs';
import { Caption, Eyebrow } from '../components/ui/text';
import type { BlockModel } from '../widgets/block-editor';
import {
  ModelBrowser,
  type ModelChoice,
  type ToneCatalogue,
} from './model-browser';
import { DockableSheet } from './tool-dock';
import { BlockGlyph } from '../widgets/block-glyph';
import { glyphFor } from '../lib/block-glyphs';

export type { ModelChoice } from './model-browser';

/** A kind of block a block can become, keeping its place in the route. */
export type BlockType = {
  id: string;
  label: string;
  group: string;
  /** What it does, in a few words. */
  description?: string;
  make: (id: string) => BlockModel;
};

/** What the block is trying: the model id, or a block type id. */
export type Trial =
  | {
      kind: 'model';
      choice: ModelChoice;
      /** dB to add to the block's level so it plays as loud as the original. */
      trim: number;
      /** One model inside the tone, when it holds several. */
      variant?: string;
    }
  | { kind: 'type'; type: BlockType };

const modelKind = (block: BlockModel): ModelChoice['kind'] | null =>
  block.kind === 'amp'
    ? 'amp'
    : block.kind === 'cab'
      ? 'cab'
      : block.kind === 'pedal'
        ? 'pedal'
        : null;

/**
 * Tone chasing for one block, in a sheet beside the rig so you keep
 * playing:
 *
 * - **Model**: search and filter the device and TONE3000 together, and Try
 *   plays a model at once. A TONE3000 tone arrives first, with progress.
 * - **Block type**: turn a delay into a reverb, a drive into a fuzz; the new
 *   block takes the same place in the route.
 *
 * The bar at the bottom always offers the way back to what the block was
 * when the sheet opened, and the tones tried so far, so A/B is one tap.
 * Closing keeps what is playing; it is an unsaved change like any other.
 */
export function SwapSheet({
  block,
  open,
  onOpenChange,
  models,
  types,
  onTry,
  onBack,
  downloads = {},
  onGet,
  catalogue,
}: {
  block: BlockModel | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  models: ModelChoice[];
  types: BlockType[];
  /** Load this model or type into the block now. */
  onTry: (trial: Trial) => void;
  /** Put the block back the way it was when the sheet opened. */
  onBack: () => void;
  /** TONE3000 downloads in progress: model id → percent. */
  downloads?: Record<string, number>;
  /** Download a TONE3000 model; the sheet tries it once the model is marked downloaded. */
  onGet?: (choice: ModelChoice) => void;
  /** Search TONE3000 from here. */
  catalogue?: ToneCatalogue;
}) {
  const [tried, setTried] = React.useState<ModelChoice[]>([]);
  const [current, setCurrent] = React.useState<string | null>(null);
  const [wanted, setWanted] = React.useState<{
    id: string;
    variant?: string;
  } | null>(null);
  const [original, setOriginal] = React.useState<string | null>(null);
  const [originalLoudness, setOriginalLoudness] = React.useState<
    number | undefined
  >(undefined);
  const [matching, setMatching] = React.useState(true);

  // Each time the sheet opens, the block as it is becomes the way back.
  const [openedFor, setOpenedFor] = React.useState<string | null>(null);
  if (open && block && openedFor !== block.id) {
    setOpenedFor(block.id);
    setOriginal(block.label);
    setOriginalLoudness(
      models.find((m) => m.id === block.source?.value)?.loudness,
    );
    setTried([]);
    setCurrent(null);
  }
  if (!open && openedFor) setOpenedFor(null);

  if (!block) return null;
  const kind = modelKind(block);
  const trimFor = (choice: ModelChoice, match = matching) =>
    match && originalLoudness !== undefined && choice.loudness !== undefined
      ? Math.round((originalLoudness - choice.loudness) * 10) / 10
      : 0;
  const tryModel = (
    choice: ModelChoice,
    match = matching,
    variant?: string,
  ) => {
    setCurrent(choice.id);
    setTried((all) =>
      [choice, ...all.filter((c) => c.id !== choice.id)].slice(0, 4),
    );
    onTry({ kind: 'model', choice, trim: trimFor(choice, match), variant });
  };
  const known = [...models, ...(catalogue?.results ?? [])];
  const playing = known.find((m) => m.id === current);
  const trim = playing ? trimFor(playing) : 0;
  // A model not on the device yet arrives first, then plays.
  const attempt = (choice: ModelChoice, variant?: string) => {
    if (choice.from === 'mine' || choice.downloaded) {
      tryModel(choice, matching, variant);
      return;
    }
    setWanted({ id: choice.id, variant });
    onGet?.(choice);
  };
  const arrived =
    wanted && known.find((m) => m.id === wanted.id && m.downloaded);
  if (wanted && arrived) {
    setWanted(null);
    tryModel(arrived, matching, wanted.variant);
  }

  const groups = [...new Set(types.map((t) => t.group))];

  return (
    <DockableSheet
      id="change"
      title={`Change ${original ?? block.label}`}
      description="Try plays it through your rig straight away. You can always go back."
      open={open}
      onOpenChange={onOpenChange}
      className="md:w-[min(36rem,100vw)]"
      footer={
        <div className="grid w-full gap-2">
          {kind && (
            <div className="flex items-center justify-between gap-3">
              <label htmlFor="match-loudness" className="grid gap-0.5">
                <span className="text-sm font-semibold">Match loudness</span>
                <Caption as="span" className="text-xs">
                  {playing && trim !== 0
                    ? `${playing.label} plays ${Math.abs(trim).toFixed(1)} dB ${trim < 0 ? 'quieter' : 'louder'} to match ${original}.`
                    : `Each model plays as loud as ${original}, so louder never wins by itself.`}
                </Caption>
              </label>
              <Switch
                id="match-loudness"
                checked={matching}
                onCheckedChange={(on) => {
                  setMatching(on);
                  if (playing) tryModel(playing, on);
                }}
              />
            </div>
          )}
          {tried.length > 1 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <Caption as="span" className="small-caps text-xs">
                Tried
              </Caption>
              {tried.map((c) => (
                <Button
                  key={c.id}
                  size="sm"
                  variant="ghost"
                  aria-pressed={current === c.id}
                  className={cn(current === c.id && 'bg-accent')}
                  onClick={() => tryModel(c)}
                >
                  {c.label}
                </Button>
              ))}
            </div>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            {current && (
              <Button
                variant="outline"
                onClick={() => {
                  setCurrent(null);
                  onBack();
                }}
              >
                <ArrowCounterClockwise /> Back to {original}
              </Button>
            )}
            <Button onClick={() => onOpenChange(false)}>
              <Check /> {current ? 'Keep' : 'Done'}
            </Button>
          </div>
        </div>
      }
    >
      <Tabs defaultValue={kind ? 'model' : 'type'}>
        <TabsList className={cn(!kind && 'hidden')}>
          {kind && <TabsTrigger value="model">Model</TabsTrigger>}
          <TabsTrigger value="type">Block type</TabsTrigger>
        </TabsList>
        {kind && (
          <TabsContent value="model" className="pt-3">
            <ModelBrowser
              models={models}
              kind={kind}
              playing={current}
              downloads={downloads}
              catalogue={catalogue}
              onTry={attempt}
              onGet={onGet}
            />
          </TabsContent>
        )}
        <TabsContent value="type" className="grid gap-3 pt-3">
          <Caption>
            The new block takes the same place in the route. Its settings start
            from their defaults.
          </Caption>
          {groups.map((group) => (
            <section key={group} aria-label={group} className="grid gap-1">
              <Eyebrow>{group}</Eyebrow>
              <List>
                {types
                  .filter((t) => t.group === group)
                  .map((t) => (
                    <ListRow
                      key={t.id}
                      selected={current === t.id}
                      leading={
                        <BlockGlyph
                          glyph={glyphFor('', `${t.group} ${t.label}`)}
                          className="ml-1"
                        />
                      }
                      title={t.label}
                      caption={t.description}
                      onClick={() => {
                        setCurrent(t.id);
                        onTry({ kind: 'type', type: t });
                      }}
                      trailing={
                        current === t.id ? (
                          <Badge
                            size="sm"
                            className="border-background/60 text-background"
                          >
                            Playing
                          </Badge>
                        ) : undefined
                      }
                    />
                  ))}
              </List>
            </section>
          ))}
        </TabsContent>
      </Tabs>
    </DockableSheet>
  );
}
