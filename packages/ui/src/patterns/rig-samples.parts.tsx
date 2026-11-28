import {
  CaretDown,
  CaretLeft,
  CaretRight,
  DotsThree,
  FloppyDisk,
  Lightning,
  MagnifyingGlass,
  Pause,
  Play,
  Plus,
} from '@phosphor-icons/react';
import { type ReactNode, useState } from 'react';

import { Button } from '../components/ui/button';
import { Slider } from '../components/ui/slider';
import { Switch } from '../components/ui/switch';
import { Eyebrow, Readout } from '../components/ui/text';
import { cn } from '../lib/cn';
import { sceneColour } from '../lib/scene-colours';
import { BlockGlyph } from '../widgets/block-glyph';
import {
  CHAIN,
  CHANGED,
  CONTROLS,
  PRESETS,
  type RigSample,
  type SampleBlock,
  SCENES,
  SONGS,
} from './rig-samples.data';

/**
 * Shared data and small parts for the five rig layout samples. These are
 * design samples with fixed example data, not the product screens.
 */

/** The navigation row and one thin health chip. */
export function TopBar({ health = true }: { health?: boolean }) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-4 border-b border-border bg-enclosure px-4 text-enclosure-foreground">
      <span className="font-semibold tracking-tight">⌀xidal</span>
      <span className="rounded-sm bg-brand px-1.5 text-xs font-bold text-brand-foreground">
        LIVE
      </span>
      <nav className="ml-4 flex gap-1 text-sm">
        {['Rig', 'Guitars', 'Library', 'Levels', 'Settings', 'Tools'].map(
          (n) => (
            <span
              key={n}
              className={cn(
                'rounded-md px-3 py-1.5',
                n === 'Rig' ? 'bg-white/10 font-semibold' : 'opacity-70',
              )}
            >
              {n}
            </span>
          ),
        )}
      </nav>
      {health && (
        <span className="ml-auto flex items-center gap-2 font-mono text-xs opacity-80">
          DSP 20% · 0 dropouts <CaretDown />
        </span>
      )}
    </header>
  );
}

/** Preset name with previous and next, then the few actions that matter. */
export function PresetBar({
  className,
  compact,
}: {
  className?: string;
  compact?: boolean;
}) {
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <Button variant="ghost" size="icon-sm" aria-label="Previous preset">
        <CaretLeft />
      </Button>
      <button
        className={cn(
          'flex min-w-0 items-center gap-1 font-serif font-semibold',
          compact ? 'text-base' : 'text-xl',
        )}
      >
        <span className="truncate">
          {compact ? 'Harmonic Tremolo' : 'Oxidal · Harmonic Tremolo'}
        </span>
        <CaretDown className="size-4 shrink-0" />
      </button>
      <Button variant="ghost" size="icon-sm" aria-label="Next preset">
        <CaretRight />
      </Button>
      <span className="ml-auto flex items-center gap-1">
        {!compact && (
          <Button variant="ghost" size="sm">
            Mute
          </Button>
        )}
        <Button size="sm">
          <Lightning /> Perform
        </Button>
        {!compact && (
          <Button variant="outline" size="sm">
            <FloppyDisk /> Save
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Tuner, Protect, Stop"
        >
          <DotsThree weight="bold" />
        </Button>
      </span>
    </div>
  );
}

const LED = {
  amp: 'bg-led-amp',
  pedal: 'bg-led-pedal',
  time: 'bg-led-time',
  mod: 'bg-led-mod',
};

/** A block with no box around the chain: glyph, LED, name. */
export function Tile({
  block,
  rig,
  size = 'md',
  showMain,
  badge,
  className,
}: {
  block: SampleBlock;
  rig: RigSample;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  showMain?: ReactNode;
  /** A footswitch label such as FS2, shown on the tile. */
  badge?: string;
  className?: string;
}) {
  const sel = rig.selected === block.id;
  const on = rig.isOn(block.id);
  const dim = { sm: 'size-12', md: 'size-16', lg: 'size-20', xl: 'size-24' }[
    size
  ];
  const width = { sm: 'w-16', md: 'w-24', lg: 'w-24', xl: 'w-32' }[size];
  return (
    <button
      type="button"
      onClick={() => rig.setSelected(sel ? null : block.id)}
      aria-pressed={sel}
      title={block.name}
      className={cn(
        'group flex shrink-0 flex-col items-center gap-1.5 rounded-lg p-1.5 outline-none focus-visible:outline-2 focus-visible:outline-ring',
        width,
        className,
      )}
    >
      <span
        className={cn(
          'relative grid place-items-center rounded-xl border-2 bg-card transition-colors',
          dim,
          sel ? 'border-foreground' : 'border-border group-hover:border-wire',
          !on && 'opacity-40',
        )}
      >
        <BlockGlyph
          glyph={block.glyph}
          className={
            size === 'xl' ? 'size-11' : size === 'lg' ? 'size-9' : 'size-7'
          }
        />
        {badge && (
          <span className="absolute -bottom-2 left-1/2 -translate-x-1/2 rounded-sm bg-foreground px-1 font-mono text-[9px] font-bold text-background">
            {badge}
          </span>
        )}
        <span
          className={cn(
            'absolute -top-1 -right-1 size-2.5 rounded-full ring-2 ring-background',
            on ? LED[block.led] : 'bg-muted',
          )}
        />
      </span>
      <span className="line-clamp-2 w-full text-center text-xs leading-tight font-medium">
        {block.name.replace('Oxidal ', '')}
      </span>
      {!on && <span className="sr-only">, off</span>}
      {showMain}
    </button>
  );
}

/** Wire between two tiles. */
export const Wire = ({ className }: { className?: string }) => (
  <span
    aria-hidden
    className={cn('h-px w-6 shrink-0 self-center bg-wire', className)}
  />
);

export const Cap = ({ label, db }: { label: string; db: string }) => (
  <span className="flex shrink-0 flex-col items-center gap-0.5 text-xs">
    <span className="grid size-9 place-items-center rounded-full border-2 border-foreground font-mono text-[10px] font-bold">
      {label}
    </span>
    <span className="font-mono text-muted-foreground">{db}</span>
  </span>
);

/** The chain in one fluid row, with the parallel split drawn as a fork. */
export function Chain({
  rig,
  size = 'md',
  className,
  nowrap,
  badges,
}: {
  rig: RigSample;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  nowrap?: boolean;
  badges?: Record<string, string>;
}) {
  return (
    <div
      className={cn(
        'flex items-center gap-y-3',
        nowrap ? 'overflow-x-auto' : 'flex-wrap',
        className,
      )}
    >
      <Cap label="IN" db="−3 dB" />
      {CHAIN.map((item) => (
        <span
          key={item.kind === 'block' ? item.block.id : 'split'}
          className="flex items-center"
        >
          <Wire />
          {item.kind === 'block' ? (
            <Tile
              block={item.block}
              rig={rig}
              size={size}
              badge={badges?.[item.block.id]}
            />
          ) : (
            <span className="flex flex-col border-x-2 border-wire/60 px-1">
              {item.lanes.map((lane, i) =>
                lane ? (
                  <Tile
                    key={lane.id}
                    block={lane}
                    rig={rig}
                    size={size}
                    badge={badges?.[lane.id]}
                  />
                ) : (
                  <span
                    key={i}
                    className={cn(
                      'grid h-12 place-items-center text-xs text-muted-foreground',
                      size === 'sm' ? 'w-16' : size === 'xl' ? 'w-32' : 'w-24',
                    )}
                  >
                    Dry
                  </span>
                ),
              )}
            </span>
          )}
        </span>
      ))}
      <Wire />
      <Cap label="OUT" db="+3 dB" />
    </div>
  );
}

/** Scene tabs: number, name, colour. One strip, no menus on each chip. */
export function SceneTabs({
  rig,
  className,
  compact,
}: {
  rig: RigSample;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex items-end gap-1 overflow-x-auto overflow-y-hidden',
        className,
      )}
    >
      <div role="tablist" aria-label="Scenes" className="contents">
        {SCENES.map((name, i) => (
          <button
            key={name}
            role="tab"
            aria-selected={rig.scene === i}
            onClick={() => rig.setScene(i)}
            className={cn(
              'relative flex min-h-touch shrink-0 items-center gap-2 rounded-t-lg border border-b-0 px-3 text-sm',
              rig.scene === i
                ? 'border-border bg-card font-semibold'
                : 'border-transparent text-muted-foreground hover:bg-accent',
            )}
          >
            <span
              aria-hidden
              className="absolute inset-x-2 top-0 h-0.5 rounded-full"
              style={{ background: sceneColour(i) }}
            />
            <span className="font-mono text-xs text-muted-foreground">
              {i + 1}
            </span>
            {!compact && name}
            {compact && rig.scene === i && name}
          </button>
        ))}
      </div>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Scene options"
        className="ml-1"
      >
        <DotsThree weight="bold" />
      </Button>
    </div>
  );
}

/** The block editor body: header that says what is being edited, then controls. */
export function Editor({
  rig,
  columns = 'grid-cols-1 sm:grid-cols-2',
  onClose,
}: {
  rig: RigSample;
  columns?: string;
  onClose?: () => void;
}) {
  const block = rig.block;
  if (!block)
    return (
      <p className="p-6 text-sm text-muted-foreground">
        Select a block in the chain to edit it.
      </p>
    );
  const changed = CHANGED[rig.scene] ?? [];
  return (
    <div className="grid min-w-0 gap-4 p-4 [&>*]:min-w-0">
      <div className="flex items-center gap-3">
        <BlockGlyph glyph={block.glyph} className="size-6" />
        <div className="min-w-0">
          <Eyebrow>
            Scene {rig.scene + 1} · {SCENES[rig.scene]}
          </Eyebrow>
          <p className="truncate font-serif text-lg font-semibold">
            {block.name}
          </p>
        </div>
        <span className="ml-auto flex items-center gap-2 text-sm">
          {rig.isOn(block.id) ? 'On' : 'Off'}
          <Switch
            checked={rig.isOn(block.id)}
            onCheckedChange={() => rig.toggle(block.id)}
            aria-label={`${block.name} on in this scene`}
          />
          {onClose && (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onClose}
              aria-label="Close"
            >
              ✕
            </Button>
          )}
        </span>
      </div>
      <SourceLine block={block} />
      <div className={cn('grid gap-x-6 gap-y-3', columns)}>
        {CONTROLS.map((c) => (
          <div key={c.id} className="relative min-w-0">
            {changed.includes(c.id) && (
              <span
                title="Different in this scene"
                className="absolute top-2.5 -left-3 size-1.5 rounded-full bg-brand"
              />
            )}
            <Slider
              label={c.label}
              min={c.min}
              max={c.max}
              step={0.5}
              value={[rig.values[c.id] ?? 0]}
              onValueChange={([v]) => rig.setValue(c.id, v ?? 0)}
              readout={`${(rig.values[c.id] ?? 0).toFixed(1)}${c.unit}`}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

/** TONE3000 picture, name, author and what the block is: visible, not hidden. */
export function SourceLine({ block }: { block: SampleBlock }) {
  if (block.id !== 'amp')
    return <p className="text-sm text-muted-foreground">{block.caption}</p>;
  return (
    <div className="flex items-center gap-3 rounded-lg bg-muted/50 p-2">
      <span className="grid size-12 shrink-0 place-items-center rounded-md bg-secondary">
        <BlockGlyph glyph="amp" className="size-6" />
      </span>
      <div className="min-w-0 text-sm">
        <p className="truncate font-medium">by TONE3000 · @tone3000</p>
        <p className="truncate text-muted-foreground">
          {block.caption} · 6 models
        </p>
      </div>
      <Button variant="outline" size="sm" className="ml-auto">
        Swap model
      </Button>
    </div>
  );
}

/** Left panel body: one list for presets and set list, the same in Library. */
export function PresetsPanel({ rig }: { rig?: RigSample }) {
  void rig;
  return (
    <div className="grid gap-4 p-3 text-sm">
      <label className="flex items-center gap-2 rounded-md border border-input px-2 py-1.5">
        <MagnifyingGlass />{' '}
        <span className="text-muted-foreground">Search presets</span>
      </label>
      <section className="grid gap-0.5">
        <Eyebrow>Set list · Friday gig · 3 of 5</Eyebrow>
        {SONGS.map((s, i) => (
          <span
            key={s}
            className={cn(
              'flex items-center gap-2 rounded-md px-2 py-1.5',
              i === 2 && 'bg-accent font-semibold',
            )}
          >
            <span className="w-4 font-mono text-xs text-muted-foreground">
              {i + 1}
            </span>
            {s}
          </span>
        ))}
      </section>
      <section className="grid gap-0.5">
        <Eyebrow>All presets</Eyebrow>
        {PRESETS.map((p, i) => (
          <span
            key={p}
            className={cn(
              'truncate rounded-md px-2 py-1.5',
              i === 0 && 'bg-accent font-semibold',
            )}
          >
            {p}
          </span>
        ))}
      </section>
    </div>
  );
}

/** Right panel body: backing track and a stem mixer. */
export function BackingPanel() {
  const [playing, setPlaying] = useState(false);
  const [levels, setLevels] = useState([80, 60, 70, 40]);
  return (
    <div className="grid gap-4 p-3 text-sm">
      <section className="grid gap-2">
        <Eyebrow>Backing track</Eyebrow>
        <p className="font-medium">Slow Burn · 112 BPM</p>
        <div className="flex items-center gap-2">
          <Button
            size="icon-sm"
            aria-label={playing ? 'Pause' : 'Play'}
            onClick={() => setPlaying((p) => !p)}
          >
            {playing ? <Pause /> : <Play />}
          </Button>
          <div className="h-1.5 flex-1 rounded-full bg-muted">
            <div className="h-full w-1/3 rounded-full bg-foreground" />
          </div>
          <span className="font-mono text-xs">1:12 / 3:40</span>
        </div>
      </section>
      <section className="grid gap-2">
        <Eyebrow>Stems</Eyebrow>
        <div className="flex h-36 justify-between gap-2">
          {['Guitar', 'Bass', 'Drums', 'Vocals'].map((n, i) => (
            <div key={n} className="flex flex-1 flex-col items-center gap-2">
              <Slider
                label={n}
                orientation="vertical"
                min={0}
                max={100}
                value={[levels[i] ?? 0]}
                onValueChange={([v]) =>
                  setLevels((l) => l.map((x, j) => (j === i ? (v ?? 0) : x)))
                }
              />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

/** A narrow button strip that stands for a minimised panel. */
export function MiniRail({
  icons,
  onOpen,
  status,
}: {
  icons: ReactNode[];
  onOpen: () => void;
  status: string[];
}) {
  return (
    <div className="flex w-12 shrink-0 flex-col items-center gap-3 py-3">
      {icons.map((icon, i) => (
        <button
          key={i}
          onClick={onOpen}
          className="flex min-h-touch w-10 flex-col items-center justify-center gap-0.5 rounded-md text-muted-foreground hover:bg-accent"
        >
          {icon}
          <span className="font-mono text-[9px]">{status[i]}</span>
        </button>
      ))}
    </div>
  );
}

export { Plus, Readout };
