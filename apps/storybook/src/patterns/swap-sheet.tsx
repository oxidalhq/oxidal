import * as React from 'react';
import {
  ArrowCounterClockwise,
  Check,
  DownloadSimple,
  MagnifyingGlass,
} from '@phosphor-icons/react';
import { cn } from '../lib/cn';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { List, ListRow } from '../components/ui/list-row';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetFooter,
  SheetHeader,
} from '../components/ui/sheet';
import { Progress } from '../components/ui/states';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '../components/ui/tabs';
import { Caption, Eyebrow } from '../components/ui/text';
import { PoweredByTone3000 } from './credits';
import type { BlockModel } from '../widgets/block-editor';

/** A model or IR the block can load: one already on the device, or one from TONE3000. */
export type ModelChoice = {
  id: string;
  label: string;
  /** Model type and size, sample rate, mic. */
  caption: string;
  kind: 'amp' | 'cab' | 'pedal';
  from: 'mine' | 'tone3000';
  creator?: string;
  licence?: string;
  /** For TONE3000 choices: already downloaded to the device. */
  downloaded?: boolean;
};

/** A kind of block a block can become, keeping its place in the route. */
export type BlockType = {
  id: string;
  label: string;
  group: string;
  make: (id: string) => BlockModel;
};

/** What the block is trying: the model id, or a block type id. */
export type Trial =
  { kind: 'model'; choice: ModelChoice } | { kind: 'type'; type: BlockType };

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
 * - **Model**: tap a model on the device or from TONE3000 and it plays at
 *   once. A TONE3000 tone downloads first, with progress, then plays.
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
}) {
  const [query, setQuery] = React.useState('');
  const [tried, setTried] = React.useState<ModelChoice[]>([]);
  const [current, setCurrent] = React.useState<string | null>(null);
  const [downloading, setDownloading] = React.useState<{
    id: string;
    progress: number;
  } | null>(null);
  const [downloaded, setDownloaded] = React.useState<Set<string>>(new Set());
  const [original, setOriginal] = React.useState<string | null>(null);
  const timer = React.useRef<ReturnType<typeof setInterval> | null>(null);

  // Each time the sheet opens, the block as it is becomes the way back.
  const [openedFor, setOpenedFor] = React.useState<string | null>(null);
  if (open && block && openedFor !== block.id) {
    setOpenedFor(block.id);
    setOriginal(block.label);
    setTried([]);
    setCurrent(null);
  }
  if (!open && openedFor) setOpenedFor(null);
  React.useEffect(
    () => () => {
      if (timer.current) clearInterval(timer.current);
    },
    [],
  );

  if (!block) return null;
  const kind = modelKind(block);
  const match = (m: ModelChoice) =>
    m.kind === kind &&
    `${m.label} ${m.caption} ${m.creator ?? ''}`
      .toLowerCase()
      .includes(query.toLowerCase());
  const mine = models.filter((m) => m.from === 'mine' && match(m));
  const catalogue = models.filter((m) => m.from === 'tone3000' && match(m));

  const tryModel = (choice: ModelChoice) => {
    setCurrent(choice.id);
    setTried((all) =>
      [choice, ...all.filter((c) => c.id !== choice.id)].slice(0, 4),
    );
    onTry({ kind: 'model', choice });
  };
  const get = (choice: ModelChoice) => {
    if (timer.current) clearInterval(timer.current);
    let progress = 0;
    setDownloading({ id: choice.id, progress });
    timer.current = setInterval(() => {
      progress += 25;
      if (progress <= 100) {
        setDownloading({ id: choice.id, progress });
        return;
      }
      if (timer.current) clearInterval(timer.current);
      setDownloading(null);
      setDownloaded((all) => new Set(all).add(choice.id));
      tryModel(choice);
    }, 120);
  };

  const row = (m: ModelChoice) => {
    const ready = m.from === 'mine' || m.downloaded || downloaded.has(m.id);
    const playing = current === m.id;
    const busy = downloading?.id === m.id;
    return (
      <ListRow
        key={m.id}
        title={m.label}
        selected={playing}
        caption={
          <>
            {m.caption}
            {m.creator && (
              <>
                {' '}
                · by {m.creator}
                {m.licence ? ` · ${m.licence}` : ''}
              </>
            )}
          </>
        }
        trailing={
          busy ? (
            <Progress
              value={downloading.progress}
              label={`Downloading ${m.label}`}
              className="w-20"
            />
          ) : playing ? (
            <Badge tone="live" size="sm">
              Playing
            </Badge>
          ) : ready ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => tryModel(m)}
              aria-label={`Try ${m.label}`}
            >
              Try
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              onClick={() => get(m)}
              aria-label={`Get and try ${m.label}`}
            >
              <DownloadSimple /> Get
            </Button>
          )
        }
      />
    );
  };

  const groups = [...new Set(types.map((t) => t.group))];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        onOpenChange={onOpenChange}
        className="md:w-[min(30rem,100vw)]"
      >
        <SheetHeader
          title={`Change ${original ?? block.label}`}
          description="Tap to hear it straight away. You can always go back."
        />
        <SheetBody className="grid content-start gap-3">
          <Tabs defaultValue={kind ? 'model' : 'type'}>
            <TabsList>
              {kind && <TabsTrigger value="model">Model</TabsTrigger>}
              <TabsTrigger value="type">Block type</TabsTrigger>
            </TabsList>
            {kind && (
              <TabsContent value="model" className="grid gap-3 pt-3">
                <label className="flex h-10 items-center gap-2 rounded-md border border-input bg-background px-3 focus-within:outline-2 focus-within:outline-ring">
                  <MagnifyingGlass
                    aria-hidden="true"
                    className="size-4 text-muted-foreground"
                  />
                  <span className="sr-only">Search models</span>
                  <input
                    type="search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search by name, size or creator"
                    className="min-w-0 flex-1 bg-transparent text-sm outline-none"
                  />
                </label>
                <section aria-label="On this device" className="grid gap-1">
                  <Eyebrow>On this device</Eyebrow>
                  {mine.length ? (
                    <List>{mine.map(row)}</List>
                  ) : (
                    <Caption>Nothing here matches.</Caption>
                  )}
                </section>
                <section aria-label="From TONE3000" className="grid gap-1">
                  <Eyebrow>From TONE3000</Eyebrow>
                  {catalogue.length ? (
                    <List>{catalogue.map(row)}</List>
                  ) : (
                    <Caption>Nothing on TONE3000 matches.</Caption>
                  )}
                  <PoweredByTone3000 />
                </section>
              </TabsContent>
            )}
            <TabsContent value="type" className="grid gap-3 pt-3">
              <Caption>
                The new block takes the same place in the route. Its settings
                start from their defaults.
              </Caption>
              {groups.map((group) => (
                <section key={group} aria-label={group} className="grid gap-1">
                  <Eyebrow>{group}</Eyebrow>
                  <div className="flex flex-wrap gap-2">
                    {types
                      .filter((t) => t.group === group)
                      .map((t) => (
                        <Button
                          key={t.id}
                          size="sm"
                          variant={current === t.id ? 'default' : 'outline'}
                          aria-pressed={current === t.id}
                          onClick={() => {
                            setCurrent(t.id);
                            onTry({ kind: 'type', type: t });
                          }}
                        >
                          {t.label}
                        </Button>
                      ))}
                  </div>
                </section>
              ))}
            </TabsContent>
          </Tabs>
        </SheetBody>
        <SheetFooter className="grid gap-2">
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
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
