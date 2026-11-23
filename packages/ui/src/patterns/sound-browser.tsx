import {
  ArrowClockwise,
  CheckCircle,
  CircleNotch,
  MagnifyingGlass,
  Play,
  Warning,
} from '@phosphor-icons/react';
import * as React from 'react';

import { Badge, Led } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { FilterSelect } from '../components/ui/filter-select';
import { List, ListRow } from '../components/ui/list-row';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetHeader,
} from '../components/ui/sheet';
import { Switch } from '../components/ui/switch';
import { Caption, Eyebrow, Title } from '../components/ui/text';
import { glyphForBlock } from '../lib/block-glyphs';
import { cn } from '../lib/cn';
import { useMedia } from '../lib/use-media';
import { BlockGlyph } from '../widgets/block-glyph';
import { type BlockSource, SourceLine } from '../widgets/block-source';
import type { BlockKind } from '../widgets/chain';

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

const KIND_VAR: Record<BlockKind, string> = {
  amp: 'var(--led-amp)',
  cab: 'var(--led-cab)',
  pedal: 'var(--led-pedal)',
  time: 'var(--led-time)',
  mod: 'var(--led-mod)',
  lv2: 'var(--led-lv2)',
};

/** The block that gives the sound its character: its amp, else its first block. */
const mainBlock = (sound: Pick<OxidalSound, 'blocks'>) =>
  sound.blocks.find((b) => b.kind === 'amp') ?? sound.blocks[0];

/** A square tinted by the main block's category colour, with its glyph. */
function VoiceTile({
  sound,
  size = 'md',
}: {
  sound: Pick<OxidalSound, 'blocks'>;
  size?: 'md' | 'lg';
}) {
  const main = mainBlock(sound);
  const colour = KIND_VAR[main?.kind ?? 'lv2'];
  return (
    <span
      aria-hidden="true"
      className={cn(
        'grid shrink-0 place-items-center rounded-lg border',
        size === 'md' ? 'size-12' : 'size-16',
      )}
      style={{
        background: `color-mix(in oklab, ${colour} 16%, var(--card))`,
        borderColor: `color-mix(in oklab, ${colour} 45%, var(--border))`,
        color: `color-mix(in oklab, ${colour} 70%, var(--foreground))`,
      }}
    >
      {main && (
        <BlockGlyph
          glyph={glyphForBlock(main)}
          className={size === 'md' ? 'size-6' : 'size-8'}
        />
      )}
    </span>
  );
}

/** The sound's blocks as a small signal chain: LED and glyph per block, joined by a wire. */
function MiniChain({ sound }: { sound: Pick<OxidalSound, 'blocks'> }) {
  const shown = sound.blocks.slice(0, 6);
  return (
    <span
      aria-hidden="true"
      className="inline-flex max-w-full flex-wrap items-center gap-y-1"
    >
      {shown.map((b, i) => (
        <span key={`${b.label}-${i}`} className="inline-flex items-center">
          {i > 0 && <span className="h-px w-2 bg-wire" />}
          <span className="rounded inline-flex items-center gap-1 border border-border bg-background px-1 py-0.5">
            <Led kind={b.kind} className="size-1.5" />
            <BlockGlyph glyph={glyphForBlock(b)} className="size-3.5" />
          </span>
        </span>
      ))}
      {sound.blocks.length > shown.length && (
        <span className="ml-1 text-2xs text-muted-foreground">
          +{sound.blocks.length - shown.length}
        </span>
      )}
    </span>
  );
}

/** @see SoundBrowser */
export function SoundReadinessPill({
  readiness,
}: {
  readiness: SoundReadiness;
}) {
  const base =
    'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-2xs font-semibold small-caps';
  if (readiness.state === 'checking')
    return (
      <span className={cn(base, 'border-border text-muted-foreground')}>
        <CircleNotch aria-hidden="true" className="size-3 animate-spin" />
        Checking
      </span>
    );
  if (readiness.state === 'ready')
    return (
      <span
        className={cn(base, 'border-foreground bg-foreground text-background')}
      >
        <CheckCircle aria-hidden="true" weight="fill" className="size-3" />
        Ready
      </span>
    );
  const parts = [
    readiness.tones.length &&
      `${readiness.tones.length} ${readiness.tones.length === 1 ? 'tone' : 'tones'}`,
    readiness.packs.length &&
      `${readiness.packs.length} ${readiness.packs.length === 1 ? 'pack' : 'packs'}`,
  ].filter(Boolean);
  return (
    <span className={cn(base, 'border-brand text-foreground')}>
      <Warning aria-hidden="true" weight="fill" className="size-3 text-brand" />
      Needs {parts.join(' and ')}
    </span>
  );
}

/** @see SoundBrowser */
export function SoundCheckingAction() {
  return (
    <span
      aria-hidden="true"
      className="grid size-11 place-items-center rounded-full border border-dashed border-border text-muted-foreground"
    >
      <CircleNotch className="size-4 animate-spin" />
    </span>
  );
}

function SoundRow({
  sound: s,
  active,
  offline,
  onSelect,
  onTry,
}: {
  sound: OxidalSound;
  active: boolean;
  offline: boolean;
  onSelect: () => void;
  onTry: () => void;
}) {
  return (
    <SoundRecipeRow
      sound={s}
      selectLabel={`Details: ${s.name}`}
      active={active}
      onSelect={onSelect}
      summary={`${ENGINE[s.engine]} · ${s.scenes.length} scenes`}
      badge={<SoundReadinessPill readiness={s.readiness} />}
      action={
        s.readiness.state === 'ready' ? (
          <button
            type="button"
            aria-label={`Try ${s.name}`}
            disabled={offline}
            onClick={onTry}
            className="grid size-11 place-items-center rounded-full bg-foreground text-background transition-transform hover:scale-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring active:scale-95 disabled:opacity-40"
          >
            <Play weight="fill" className="size-5" />
          </button>
        ) : s.readiness.state === 'needs' ? (
          <Button
            size="sm"
            variant="outline"
            aria-label={`Get what ${s.name} needs`}
            onClick={onSelect}
          >
            Get…
          </Button>
        ) : (
          <SoundCheckingAction />
        )
      }
    />
  );
}

export function SoundRecipeRow({
  sound: s,
  active,
  onSelect,
  summary,
  badge,
  action,
  feedback,
  selectLabel,
  as: Row = 'li',
  rowLabel,
  state,
}: {
  sound: Pick<
    OxidalSound,
    'name' | 'era' | 'genres' | 'description' | 'blocks'
  >;
  active?: boolean;
  onSelect: () => void;
  summary: string;
  badge: React.ReactNode;
  action: React.ReactNode;
  feedback?: React.ReactNode;
  selectLabel?: string;
  as?: 'article' | 'li';
  rowLabel?: string;
  state?: string;
}) {
  return (
    <Row
      data-slot="sound-row"
      aria-label={rowLabel}
      data-state={state}
      data-active={active || undefined}
      className={cn(
        'relative grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-lg border border-border bg-card p-3 transition-[border-color,box-shadow] duration-[var(--duration-fast)] hover:border-foreground/40',
        active &&
          'before:rounded-r border-foreground shadow-raised before:absolute before:inset-y-3 before:left-0 before:w-1 before:bg-brand',
      )}
    >
      <VoiceTile sound={s} />
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-1">
        <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <button
            type="button"
            aria-label={selectLabel}
            aria-pressed={active}
            onClick={onSelect}
            className="text-left font-display text-lg leading-tight font-semibold outline-none after:absolute after:inset-0 after:rounded-lg after:content-[''] focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-ring"
          >
            {s.name}
          </button>
          {s.era && (
            <span className="rounded border border-border px-1 small-caps text-2xs text-muted-foreground">
              {s.era}
            </span>
          )}
          <span className="text-xs text-muted-foreground">
            {s.genres.join(' · ')}
          </span>
        </span>
        <span className="line-clamp-2 text-sm text-muted-foreground md:line-clamp-1">
          {s.description}
        </span>
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1.5 pt-0.5">
          <MiniChain sound={s} />
          <span className="small-caps text-2xs text-muted-foreground">
            {summary}
          </span>
          {badge}
        </span>
      </div>
      <span className="relative z-10">{action}</span>
      {feedback && (
        <div className="col-span-full grid gap-1 text-sm">{feedback}</div>
      )}
    </Row>
  );
}

/** Readiness feedback for the collection, while the recipe list remains usable. */
/** @see SoundBrowser */
export function SoundBrowserStatus({
  status,
  total,
  onRetry,
}: {
  status: SoundsStatus;
  total: number;
  onRetry: () => void;
}) {
  return (
    <>
      {status.state === 'checking' && (
        <p
          role="status"
          className="m-0 flex items-center gap-2 text-sm text-muted-foreground"
        >
          <CircleNotch aria-hidden="true" className="size-4 animate-spin" />
          Checking which sounds play on this device… {status.checked} of {total}
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
    </>
  );
}

/** @see SoundBrowser */
export function SoundSearch({
  query,
  onQuery,
}: {
  query: string;
  onQuery: (query: string) => void;
}) {
  return (
    <label className="relative">
      <span className="sr-only">Search Oxidal sounds</span>
      <MagnifyingGlass
        aria-hidden="true"
        className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
      />
      <input
        type="search"
        value={query}
        onChange={(event) => onQuery(event.target.value)}
        placeholder="Search by name, style or era"
        className="min-h-touch w-full rounded-md border border-input bg-background pr-3 pl-9 text-sm focus-visible:outline-2 focus-visible:outline-ring"
      />
    </label>
  );
}

/** @see SoundBrowser */
export function ReadySoundsFilter({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  const id = React.useId();
  return (
    <label
      htmlFor={id}
      className="ml-auto inline-flex min-h-touch items-center gap-2 text-sm"
    >
      Ready to play only
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </label>
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
      <SoundBrowserStatus
        status={status}
        total={sounds.length}
        onRetry={onRetry}
      />

      <div className="grid gap-2">
        <SoundSearch query={query} onQuery={setQuery} />

        <div className="flex flex-wrap items-center gap-2">
          <FilterSelect
            label="Genre"
            value={genre}
            onValue={setGenre}
            options={genres.map((g) => [g, g])}
          />
          <FilterSelect
            label="Engine"
            value={engine}
            onValue={setEngine}
            options={Object.entries(ENGINE)}
          />
          <FilterSelect
            label="Complexity"
            value={complexity}
            onValue={setComplexity}
            options={Object.entries(COMPLEXITY)}
          />
          <ReadySoundsFilter checked={readyOnly} onChange={setReadyOnly} />
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
          <ul
            aria-label="Oxidal sounds"
            className="m-0 grid list-none gap-2 p-0"
          >
            {shown.map((s) => (
              <SoundRow
                key={s.id}
                sound={s}
                active={s.id === sound?.id}
                offline={status.state === 'offline'}
                onSelect={() => setSelected(s.id)}
                onTry={() => onTry(s)}
              />
            ))}
          </ul>
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
        <div className="flex items-center gap-3">
          <VoiceTile sound={sound} size="lg" />
          {showTitle && (
            <Title as="h2" size="md">
              {sound.name}
            </Title>
          )}
        </div>
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
