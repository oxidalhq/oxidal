import {
  ArrowsLeftRight,
  ArrowUUpLeft,
  ArrowUUpRight,
  Books,
  CaretDown,
  CaretLeft,
  CaretRight,
  Faders,
  FloppyDisk,
  Gauge,
  GearSix,
  Guitar,
  Lightning,
  List,
  MagnifyingGlass,
  Metronome,
  MusicNote,
  SpeakerSlash,
  Wrench,
} from '@phosphor-icons/react';
import { type ReactNode, useState } from 'react';

import { cn } from '../lib/cn';
import { sceneColour } from '../lib/scene-colours';
import { SCENES, useLevels } from './rig-samples.data';

/**
 * Top bar designs for the Rig samples: navigation in a menu, the bar itself
 * shows what a player watches live (preset, scene, tempo, levels, load).
 * Fixed example numbers that move a little; nothing is measured.
 */

/** Two thin bars, left over right. Turns orange when hot. */
export function Meter({
  label,
  l,
  r,
  className,
}: {
  label: string;
  l: number;
  r: number;
  className?: string;
}) {
  const bar = (x: number) => (
    <span className="bg-white/15 block h-1.5 w-14 overflow-hidden rounded-full">
      <span
        className={cn(
          'block h-full rounded-full transition-[width] duration-100',
          x > 0.85 ? 'bg-brand' : 'bg-enclosure-foreground',
        )}
        style={{ width: `${Math.round(x * 100)}%` }}
      />
    </span>
  );
  return (
    <span className={cn('flex items-center gap-2', className)}>
      <span className="text-[10px] tracking-wider opacity-60">{label}</span>
      <span className="grid gap-1">
        {bar(l)}
        {bar(r)}
      </span>
    </span>
  );
}

export function Stat({
  label,
  value,
  pct,
}: {
  label: string;
  value: string;
  pct?: number;
}) {
  return (
    <span className="flex min-w-12 flex-col gap-1 leading-none">
      <span className="text-[10px] tracking-wider opacity-60">{label}</span>
      <span className="font-mono text-sm">{value}</span>
      {pct !== undefined && (
        <span className="bg-white/15 h-0.5 rounded-full">
          <span
            className="block h-full rounded-full bg-enclosure-foreground"
            style={{ width: `${pct}%` }}
          />
        </span>
      )}
    </span>
  );
}

const NAV = [
  { icon: Faders, label: 'Rig', hint: 'Shape the sound', current: true },
  { icon: Guitar, label: 'Guitars', hint: 'Your guitars and pickups' },
  { icon: Books, label: 'Library', hint: 'Presets, set lists, stems' },
  { icon: Gauge, label: 'Levels', hint: 'Sound check, even out' },
  { icon: GearSix, label: 'Settings', hint: 'Audio, MIDI, network' },
  { icon: Wrench, label: 'Tools', hint: 'Tuner, reamp, device' },
];

export function NavMenu() {
  return (
    <nav
      aria-label="Main"
      className="shadow-lg absolute top-full left-2 z-30 mt-1 grid w-72 gap-0.5 rounded-xl border border-border bg-popover p-1.5 text-popover-foreground"
    >
      {NAV.map(({ icon: Icon, label, hint, current }) => (
        <button
          key={label}
          className={cn(
            'flex items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-accent',
            current && 'bg-accent',
          )}
        >
          <Icon className="size-5 shrink-0" />
          <span className="grid">
            <span className="text-sm font-semibold">{label}</span>
            <span className="text-xs text-muted-foreground">{hint}</span>
          </span>
        </button>
      ))}
    </nav>
  );
}

const ghost =
  'flex min-h-9 items-center gap-1.5 rounded-md px-2.5 text-sm hover:bg-white/10';

function Burger({ open, onClick }: { open: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-expanded={open}
      aria-label="Menu"
      className="hover:bg-white/10 grid size-10 place-items-center rounded-md"
    >
      <List className="size-5" />
    </button>
  );
}

function Actions({
  perform = true,
  mode,
  onMode,
}: {
  perform?: boolean;
  mode?: 'edit' | 'perform';
  onMode?: (m: 'edit' | 'perform') => void;
}) {
  return (
    <span className="flex items-center gap-1">
      <button className={ghost}>
        <MusicNote className="size-4" /> Tuner
      </button>
      <button className={ghost}>
        <SpeakerSlash className="size-4" /> Mute
      </button>
      {perform && mode && (
        <span
          role="group"
          aria-label="Mode"
          className="bg-white/10 flex rounded-md p-0.5 text-sm font-semibold"
        >
          {(['edit', 'perform'] as const).map((m) => (
            <button
              key={m}
              aria-pressed={mode === m}
              onClick={() => onMode?.(m)}
              className={cn(
                'rounded min-h-8 px-3 capitalize',
                mode === m ? 'bg-brand text-brand-foreground' : 'opacity-70',
              )}
            >
              {m}
            </button>
          ))}
        </span>
      )}
      {perform && !mode && (
        <button className="flex min-h-9 items-center gap-1.5 rounded-md bg-brand px-3 text-sm font-semibold text-brand-foreground">
          <Lightning className="size-4" /> Perform
        </button>
      )}
    </span>
  );
}

const Rule = () => <span aria-hidden className="bg-white/15 h-6 w-px" />;

/** Shown only while the preset has unsaved edits: undo, redo, hold-to-compare, save. */
export function EditTools() {
  return (
    <span className="flex items-center gap-0.5">
      <button
        className="hover:bg-white/10 grid size-8 place-items-center rounded-md"
        aria-label="Undo"
      >
        <ArrowUUpLeft />
      </button>
      <button
        className="grid size-8 place-items-center rounded-md opacity-50"
        aria-label="Redo"
      >
        <ArrowUUpRight />
      </button>
      <button className={ghost} title="Hold to hear the saved version">
        <ArrowsLeftRight className="size-4" /> A/B
      </button>
      <button className={cn(ghost, 'font-semibold')}>
        <FloppyDisk className="size-4" /> Save
      </button>
    </span>
  );
}

export function PresetPicker({
  number = '03A',
  name = 'Oxidal · Harmonic Tremolo',
  edited = true,
}: {
  number?: string;
  name?: string;
  edited?: boolean;
}) {
  return (
    <span className="flex items-center gap-1">
      <button
        className="hover:bg-white/10 grid size-8 place-items-center rounded-md"
        aria-label="Previous preset"
      >
        <CaretLeft />
      </button>
      <button className="hover:bg-white/10 flex items-center gap-2 rounded-md px-1.5 py-1">
        <span className="font-mono text-xs opacity-60">{number}</span>
        <span className="font-serif text-lg font-semibold">{name}</span>
        {edited && (
          <span
            className="size-1.5 rounded-full bg-brand"
            title="Edited, not saved"
          />
        )}
        <CaretDown className="size-3.5 opacity-70" />
      </button>
      <button
        className="hover:bg-white/10 grid size-8 place-items-center rounded-md"
        aria-label="Next preset"
      >
        <CaretRight />
      </button>
    </span>
  );
}

export function SceneReadout({ scene = 1 }: { scene?: number }) {
  return (
    <span className="flex items-center gap-2">
      <span
        className="h-6 w-1 rounded-full"
        style={{ background: sceneColour(scene) }}
      />
      <span className="grid leading-none">
        <span className="text-[10px] tracking-wider opacity-60">
          SCENE {scene + 1}
        </span>
        <span className="text-sm font-semibold">{SCENES[scene]}</span>
      </span>
    </span>
  );
}

export function Tempo() {
  return (
    <button className="hover:bg-white/10 flex items-center gap-2 rounded-md px-2 py-1">
      <Metronome className="size-4 opacity-70" />
      <span className="grid text-left leading-none">
        <span className="text-[10px] tracking-wider opacity-60">TAP</span>
        <span className="font-mono text-sm">112 BPM</span>
      </span>
    </button>
  );
}

export type DisplayVariant = 'strip' | 'screen' | 'quiet';

/** One bar, three designs. The hamburger opens the main navigation. */
export function DisplayBar({
  variant = 'strip',
  scene = 1,
  defaultOpen = false,
  onSearch,
  landmark = true,
  presetName,
  number,
  edited = true,
  mode,
  onMode,
}: {
  variant?: DisplayVariant;
  scene?: number;
  defaultOpen?: boolean;
  onSearch?: () => void;
  /** False when several bars are shown together for comparison. */
  landmark?: boolean;
  presetName?: string;
  number?: string;
  edited?: boolean;
  mode?: 'edit' | 'perform';
  onMode?: (m: 'edit' | 'perform') => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [status, setStatus] = useState(false);
  const lv = useLevels();
  const Root = landmark ? 'header' : 'div';
  const shell =
    'relative z-20 flex shrink-0 items-center gap-3 border-b border-border bg-enclosure px-3 text-enclosure-foreground';
  const search = onSearch && (
    <button
      className={ghost}
      onClick={onSearch}
      aria-label="Search everything ⌘K"
    >
      <MagnifyingGlass className="size-4" />
      <kbd className="font-mono text-[10px] opacity-60">⌘K</kbd>
    </button>
  );

  if (variant === 'screen')
    return (
      <Root className={cn(shell, 'h-24 py-2')}>
        <Burger open={open} onClick={() => setOpen((o) => !o)} />
        {open && <NavMenu />}
        <div className="border-white/10 bg-black/40 flex h-full min-w-0 flex-1 items-center gap-6 rounded-lg border px-4">
          <span className="font-light font-mono text-3xl opacity-70">03A</span>
          <span className="grid min-w-0 leading-tight">
            <span className="truncate font-serif text-2xl font-semibold">
              Oxidal · Harmonic Tremolo
            </span>
            <span className="flex items-center gap-3 text-sm opacity-80">
              <span
                className="h-3 w-1 rounded-full"
                style={{ background: sceneColour(scene) }}
              />
              Scene {scene + 1} · {SCENES[scene]}{' '}
              <span className="opacity-50">·</span> 112 BPM
              <span
                className="size-1.5 rounded-full bg-brand"
                title="Edited, not saved"
              />
            </span>
          </span>
          <span className="ml-auto flex items-center gap-5">
            <span className="grid gap-1.5">
              <Meter label="IN " l={lv.inL} r={lv.inR} />
              <Meter label="OUT" l={lv.outL} r={lv.outR} />
            </span>
            <span className="grid grid-cols-3 gap-x-4 gap-y-1">
              <Stat label="DSP" value="20%" pct={20} />
              <Stat label="CPU" value="31%" pct={31} />
              <Stat label="TEMP" value="60°" pct={60} />
            </span>
          </span>
        </div>
        <span className="grid gap-1">
          <Actions perform={false} />
          <button className="flex min-h-9 items-center justify-center gap-1.5 rounded-md bg-brand px-3 text-sm font-semibold text-brand-foreground">
            <Lightning className="size-4" /> Perform
          </button>
        </span>
      </Root>
    );

  if (variant === 'quiet')
    return (
      <Root className={cn(shell, 'h-12')}>
        <Burger open={open} onClick={() => setOpen((o) => !o)} />
        {open && <NavMenu />}
        <PresetPicker />
        <Rule />
        <SceneReadout scene={scene} />
        <span className="ml-auto flex items-center gap-2">
          {search}
          <button
            onClick={() => setStatus((s) => !s)}
            className={cn(ghost, 'font-mono')}
            aria-expanded={status}
          >
            <span className="size-2 rounded-full bg-led-pedal" /> 20%
            <CaretDown className="size-3 opacity-70" />
          </button>
          <Actions />
        </span>
        {status && (
          <div className="shadow-lg absolute top-full right-24 z-30 mt-1 grid w-64 gap-2 rounded-xl border border-border bg-popover p-3 text-popover-foreground">
            <p className="text-sm font-semibold">All good</p>
            <div className="grid grid-cols-2 gap-2 text-sm">
              {[
                ['DSP', '20%'],
                ['CPU', '31%'],
                ['RAM', '0.5 of 8 GiB'],
                ['Temp', '60°'],
                ['Dropouts', '0'],
                ['Clips', '0'],
              ].map(([k, v]) => (
                <span key={k} className="flex justify-between gap-2">
                  <span className="text-muted-foreground">{k}</span>
                  <span className="font-mono">{v}</span>
                </span>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              This light turns orange on a dropout or a clip, and says why.
            </p>
          </div>
        )}
        <span
          aria-hidden
          className="bg-white/10 absolute inset-x-0 bottom-0 h-0.5"
        >
          <span
            className="block h-full bg-enclosure-foreground transition-[width] duration-100"
            style={{ width: `${Math.round(lv.outL * 100)}%` }}
          />
        </span>
      </Root>
    );

  return (
    <Root className={cn(shell, 'h-14')}>
      <Burger open={open} onClick={() => setOpen((o) => !o)} />
      {open && <NavMenu />}
      <PresetPicker name={presetName} number={number} edited={edited} />
      {edited && <EditTools />}
      <Rule />
      <SceneReadout scene={scene} />
      <Rule />
      <Tempo />
      <span className="ml-auto flex items-center gap-5">
        <Meter label="IN " l={lv.inL} r={lv.inR} />
        <Meter label="OUT" l={lv.outL} r={lv.outR} />
        <Stat label="DSP" value="20%" pct={20} />
        <Stat label="CPU" value="31%" pct={31} />
        {search}
        <Actions mode={mode} onMode={onMode} />
      </span>
    </Root>
  );
}

/** A small caption under a sample, so a story reads as a comparison. */
export function Note({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <p className={cn('px-4 py-2 text-xs text-muted-foreground', className)}>
      {children}
    </p>
  );
}
