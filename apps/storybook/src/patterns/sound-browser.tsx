import * as React from 'react';
import {
  ArrowClockwise,
  CheckCircle,
  CircleNotch,
  MagnifyingGlass,
  Play,
  Warning,
} from '@phosphor-icons/react';
import { cn } from '../lib/cn';
import { glyphForBlock } from '../lib/block-glyphs';
import { useMedia } from '../lib/use-media';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { List, ListRow } from '../components/ui/list-row';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetHeader,
} from '../components/ui/sheet';
import { Switch } from '../components/ui/switch';
import { Caption, Eyebrow, Title } from '../components/ui/text';
import type { BlockKind } from '../widgets/chain';
import { BlockGlyph } from '../widgets/block-glyph';
import { SourceLine, type BlockSource } from '../widgets/block-source';

export type SoundEngine =
  'lv2' | 'tone3000-a2-lite' | 'tone3000-a2-full' | 'hybrid';
export type SoundComplexity = 'simple' | 'layered' | 'complex';
export type SoundReadiness =
  | { state: 'checking' }
  | { state: 'ready' }
  | {
      state: 'needs';
      /** TONE3000 tones to get, with their creators. */
      tones: BlockSource[];
      /** LV2 packs to install. */
      packs: string[];
    };

/** One finished Oxidal sound, as its recipe describes it. */
export type OxidalSound = {
  id: string;
  name: string;
  era?: string;
  genres: string[];
  engine: SoundEngine;
  complexity: SoundComplexity;
  description: string;
  /** The style and era it draws on; never an artist or song. */
  inspiration: string;
  /** How its scenes are meant to be played live. */
  performance: string;
  scenes: string[];
  /** Its blocks in order, for the glyph strip. */
  blocks: { label: string; kind: BlockKind; role?: string }[];
  /** NAM captures that run at once. */
  nam: number;
  readiness: SoundReadiness;
};

/** What the device could tell about every sound at once. */
export type SoundsStatus =
  | { state: 'checking'; checked: number }
  | { state: 'ready' }
  | { state: 'offline' };

const ENGINE: Record<SoundEngine, string> = {
  lv2: 'LV2 only',
  'tone3000-a2-lite': 'TONE3000 · A2 Lite',
  'tone3000-a2-full': 'TONE3000 · A2 Full',
  hybrid: 'Hybrid',
};
const COMPLEXITY: Record<SoundComplexity, string> = {
  simple: 'Simple',
  layered: 'Layered',
  complex: 'Complex',
};

function Readiness({
  readiness,
  inverse = false,
}: {
  readiness: SoundReadiness;
  inverse?: boolean;
}) {
  if (readiness.state === 'checking')
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1 text-xs',
          inverse ? 'text-background/70' : 'text-muted-foreground',
        )}
      >
        <CircleNotch aria-hidden="true" className="size-3.5 animate-spin" />
        Checking
      </span>
    );
  if (readiness.state === 'ready')
    return (
      <span className="inline-flex items-center gap-1 text-xs">
        <CheckCircle aria-hidden="true" className="size-4" /> Ready
      </span>
    );
  const parts = [
    readiness.tones.length &&
      `${readiness.tones.length} ${readiness.tones.length === 1 ? 'tone' : 'tones'}`,
    readiness.packs.length &&
      `${readiness.packs.length} ${readiness.packs.length === 1 ? 'pack' : 'packs'}`,
  ].filter(Boolean);
  return (
    <span className="inline-flex items-center gap-1 text-xs">
      <Warning aria-hidden="true" className="size-4 text-brand" /> Needs{' '}
      {parts.join(' and ')}
    </span>
  );
}

function Glyphs({ sound }: { sound: OxidalSound }) {
  const shown = sound.blocks.slice(0, 7);
  return (
    <span aria-hidden="true" className="inline-flex items-center gap-1">
      {shown.map((b, i) => (
        <BlockGlyph
          key={`${b.label}-${i}`}
          glyph={glyphForBlock(b)}
          className="size-4 opacity-80"
        />
      ))}
      {sound.blocks.length > shown.length && (
        <span className="text-2xs">+{sound.blocks.length - shown.length}</span>
      )}
    </span>
  );
}

/**
 * Library › Oxidal sounds: the finished sounds that come with Oxidal, as a
 * dense list you can scan, filter and try. Each row says what the sound is
 * for, what is inside it and whether it plays here now; the detail beside it
 * (a sheet on phones) says how to play its scenes, what it needs and where
 * that comes from. One status line replaces per-card "Checking…" and stacked
 * errors.
 */
export function SoundBrowser({
  sounds,
  status,
  onTry,
  onSaveCopy,
  onAddToSetList,
  onGetTone,
  onInstallPack,
  onRetry,
}: {
  sounds: OxidalSound[];
  status: SoundsStatus;
  /** Load it now to hear it; only for ready sounds. */
  onTry: (sound: OxidalSound) => void;
  onSaveCopy: (sound: OxidalSound) => void;
  onAddToSetList: (sound: OxidalSound) => void;
  onGetTone: (tone: BlockSource) => void;
  /** Install happens in Settings › LV2; this takes the player there. */
  onInstallPack: (pack: string) => void;
  onRetry: () => void;
}) {
  const wide = useMedia('(min-width: 64rem)');
  const [query, setQuery] = React.useState('');
  const [genre, setGenre] = React.useState('all');
  const [engine, setEngine] = React.useState('all');
  const [complexity, setComplexity] = React.useState('all');
  const [readyOnly, setReadyOnly] = React.useState(false);
  const [selected, setSelected] = React.useState<string | null>(null);
  const readyId = React.useId();

  const genres = [...new Set(sounds.flatMap((s) => s.genres))].sort();
  const shown = sounds.filter(
    (s) =>
      (genre === 'all' || s.genres.includes(genre)) &&
      (engine === 'all' || s.engine === engine) &&
      (complexity === 'all' || s.complexity === complexity) &&
      (!readyOnly || s.readiness.state === 'ready') &&
      `${s.name} ${s.description} ${s.genres.join(' ')} ${s.era ?? ''}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const ready = sounds.filter((s) => s.readiness.state === 'ready').length;
  const needs = sounds.filter((s) => s.readiness.state === 'needs').length;
  const filtered =
    genre !== 'all' ||
    engine !== 'all' ||
    complexity !== 'all' ||
    readyOnly ||
    query !== '';
  const sound =
    shown.find((s) => s.id === selected) ?? (wide ? shown[0] : undefined);

  const detail = sound && (
    <SoundDetail
      sound={sound}
      offline={status.state === 'offline'}
      onTry={onTry}
      onSaveCopy={onSaveCopy}
      onAddToSetList={onAddToSetList}
      onGetTone={onGetTone}
      onInstallPack={onInstallPack}
      showTitle={wide}
    />
  );

  return (
    <div data-slot="sound-browser" className="grid gap-3">
      {status.state === 'checking' && (
        <p
          role="status"
          className="m-0 flex items-center gap-2 text-sm text-muted-foreground"
        >
          <CircleNotch aria-hidden="true" className="size-4 animate-spin" />
          Checking which sounds play on this device… {status.checked} of{' '}
          {sounds.length}
        </p>
      )}
      {status.state === 'offline' && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-foreground bg-card px-3 py-2"
        >
          <span className="grid gap-0.5">
            <span className="text-sm font-semibold">
              Oxidal is not reachable
            </span>
            <Caption as="span" className="text-xs">
              You can browse every sound. Trying one, and checking what it
              needs, waits for the device.
            </Caption>
          </span>
          <Button
            size="sm"
            variant="outline"
            className="ml-auto"
            onClick={onRetry}
          >
            <ArrowClockwise /> Try again
          </Button>
        </div>
      )}

      <div className="grid gap-2">
        <label className="relative">
          <span className="sr-only">Search Oxidal sounds</span>
          <MagnifyingGlass
            aria-hidden="true"
            className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, style or era"
            className="h-10 w-full rounded-md border border-input bg-background pr-3 pl-9 text-sm focus-visible:outline-2 focus-visible:outline-ring"
          />
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <Filter
            label="Genre"
            value={genre}
            onValue={setGenre}
            options={genres.map((g) => [g, g])}
          />
          <Filter
            label="Engine"
            value={engine}
            onValue={setEngine}
            options={Object.entries(ENGINE)}
          />
          <Filter
            label="Complexity"
            value={complexity}
            onValue={setComplexity}
            options={Object.entries(COMPLEXITY)}
          />
          <label
            htmlFor={readyId}
            className="ml-auto inline-flex min-h-touch items-center gap-2 text-sm"
          >
            Ready to play only
            <Switch
              id={readyId}
              checked={readyOnly}
              onCheckedChange={setReadyOnly}
            />
          </label>
        </div>
        <div className="flex flex-wrap items-baseline gap-x-3 text-sm">
          <span>
            {shown.length === sounds.length
              ? `${sounds.length} sounds`
              : `${shown.length} of ${sounds.length} sounds`}
          </span>
          {status.state !== 'offline' && (
            <Caption as="span" className="text-xs">
              {ready} ready · {needs} need a tone or pack
            </Caption>
          )}
          {filtered && (
            <Button
              size="sm"
              variant="ghost"
              className="ml-auto"
              onClick={() => {
                setQuery('');
                setGenre('all');
                setEngine('all');
                setComplexity('all');
                setReadyOnly(false);
              }}
            >
              Clear filters
            </Button>
          )}
        </div>
      </div>

      <div
        className={cn(
          'grid gap-4',
          wide && 'grid-cols-[minmax(0,1fr)_minmax(0,26rem)] items-start',
        )}
      >
        {shown.length ? (
          <List aria-label="Oxidal sounds">
            {shown.map((s) => {
              const active = s.id === sound?.id;
              return (
                <ListRow
                  key={s.id}
                  selected={active}
                  onClick={() => setSelected(s.id)}
                  title={
                    <span className="flex min-w-0 items-baseline gap-2">
                      <span className="truncate">{s.name}</span>
                      <span
                        className={cn(
                          'shrink-0 text-xs font-normal',
                          active
                            ? 'text-background/70'
                            : 'text-muted-foreground',
                        )}
                      >
                        {[s.era, ...s.genres].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                  }
                  caption={
                    <span className="grid gap-1">
                      <span className="truncate">{s.description}</span>
                      <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <Glyphs sound={s} />
                        <span className="small-caps text-2xs">
                          {ENGINE[s.engine]} · {s.scenes.length} scenes
                        </span>
                        <Readiness readiness={s.readiness} inverse={active} />
                      </span>
                    </span>
                  }
                  trailing={
                    <Button
                      size="sm"
                      variant={active ? 'secondary' : 'outline'}
                      disabled={
                        s.readiness.state !== 'ready' ||
                        status.state === 'offline'
                      }
                      aria-label={`Try ${s.name}`}
                      onClick={() => onTry(s)}
                    >
                      <Play weight="fill" /> Try
                    </Button>
                  }
                />
              );
            })}
          </List>
        ) : (
          <div className="grid justify-items-start gap-2 rounded-lg border border-dashed border-border p-4">
            <span className="text-sm font-semibold">
              No sounds match these filters
            </span>
            <Caption className="text-xs">
              Try another genre or engine, or turn off Ready to play only.
            </Caption>
          </div>
        )}
        {wide && detail && (
          <div className="sticky top-4 rounded-lg border border-border bg-card p-4">
            {detail}
          </div>
        )}
      </div>

      {!wide && (
        <Sheet
          open={Boolean(selected && sound)}
          onOpenChange={(o) => !o && setSelected(null)}
        >
          <SheetContent onOpenChange={(o) => !o && setSelected(null)}>
            <SheetHeader
              title={sound?.name ?? ''}
              description={sound ? ENGINE[sound.engine] : ''}
            />
            <SheetBody>{detail}</SheetBody>
          </SheetContent>
        </Sheet>
      )}
    </div>
  );
}

function Filter({
  label,
  value,
  onValue,
  options,
}: {
  label: string;
  value: string;
  onValue: (v: string) => void;
  options: [string, string][];
}) {
  return (
    <Select value={value} onValueChange={onValue}>
      <SelectTrigger
        aria-label={label}
        className={cn(
          'h-9 w-auto min-w-36',
          value !== 'all' && 'border-foreground',
        )}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">Every {label.toLowerCase()}</SelectItem>
        {options.map(([v, text]) => (
          <SelectItem key={v} value={v}>
            {text}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function SoundDetail({
  sound,
  offline,
  onTry,
  onSaveCopy,
  onAddToSetList,
  onGetTone,
  onInstallPack,
  showTitle = true,
}: {
  sound: OxidalSound;
  offline: boolean;
  /** Off in the phone sheet, whose header already names it. */
  showTitle?: boolean;
  onTry: (sound: OxidalSound) => void;
  onSaveCopy: (sound: OxidalSound) => void;
  onAddToSetList: (sound: OxidalSound) => void;
  onGetTone: (tone: BlockSource) => void;
  onInstallPack: (pack: string) => void;
}) {
  const r = sound.readiness;
  return (
    <section aria-label={`About ${sound.name}`} className="grid gap-4">
      <div className="grid gap-1">
        {showTitle && (
          <Title as="h2" size="md">
            {sound.name}
          </Title>
        )}
        <div className="flex flex-wrap gap-1">
          {[sound.era, ...sound.genres].filter(Boolean).map((g) => (
            <Badge key={g} size="sm">
              {g}
            </Badge>
          ))}
          <Badge size="sm">{ENGINE[sound.engine]}</Badge>
          <Badge size="sm">{COMPLEXITY[sound.complexity]}</Badge>
        </div>
        <p className="m-0 text-sm">{sound.description}</p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          disabled={r.state !== 'ready' || offline}
          onClick={() => onTry(sound)}
        >
          <Play weight="fill" /> Try {sound.name}
        </Button>
        <Button variant="outline" onClick={() => onSaveCopy(sound)}>
          Save a copy to Mine
        </Button>
        <Button variant="ghost" onClick={() => onAddToSetList(sound)}>
          Add to set list
        </Button>
      </div>

      {r.state === 'needs' && (
        <section className="grid gap-1.5 rounded-lg border border-brand p-3">
          <Eyebrow>Before it plays here</Eyebrow>
          <List>
            {r.tones.map((t) => (
              <ListRow
                key={t.title}
                title={t.title}
                caption={<SourceLine source={t} />}
                trailing={
                  <Button
                    size="sm"
                    variant="outline"
                    aria-label={`Get ${t.title}`}
                    onClick={() => onGetTone(t)}
                  >
                    Get
                  </Button>
                }
              />
            ))}
            {r.packs.map((p) => (
              <ListRow
                key={p}
                title={p}
                caption="LV2 pack · installed by you in Settings › LV2"
                trailing={
                  <Button
                    size="sm"
                    variant="outline"
                    aria-label={`Install ${p}…`}
                    onClick={() => onInstallPack(p)}
                  >
                    Install…
                  </Button>
                }
              />
            ))}
          </List>
        </section>
      )}

      <section className="grid gap-1.5">
        <Eyebrow>How to play it</Eyebrow>
        <ol className="m-0 grid list-none gap-1 p-0">
          {sound.scenes.map((name, i) => (
            <li key={name} className="flex items-baseline gap-2 text-sm">
              <span className="w-14 shrink-0 small-caps text-xs text-muted-foreground">
                Scene {i + 1}
              </span>
              <span className="font-medium">{name}</span>
            </li>
          ))}
        </ol>
        <Caption className="text-xs">{sound.performance}</Caption>
      </section>

      <section className="grid gap-1.5">
        <Eyebrow>What's inside</Eyebrow>
        <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
          {sound.blocks.map((b, i) => (
            <li
              key={`${b.label}-${i}`}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1 text-xs"
            >
              <BlockGlyph glyph={glyphForBlock(b)} className="size-4" />
              {b.label}
            </li>
          ))}
        </ul>
        <Caption className="text-xs">
          {sound.blocks.length} blocks
          {sound.nam > 0 &&
            ` · ${sound.nam} NAM ${sound.nam === 1 ? 'capture' : 'captures'} at once`}
        </Caption>
      </section>

      <section className="grid gap-1">
        <Eyebrow>Inspired by</Eyebrow>
        <Caption className="text-xs">{sound.inspiration}</Caption>
      </section>
    </section>
  );
}
