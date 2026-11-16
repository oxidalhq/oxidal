import * as React from 'react';
import { cn } from '../lib/cn';
import type {
  ControllerProfile,
  Footswitch,
  SwitchAction,
} from './controllers';

export type StageState = {
  scene: string | null;
  scenes: { id: string; name: string }[];
  blocks: Record<string, { label: string; on: boolean }>;
  boost: boolean;
  tuner: boolean;
  playing: boolean;
  loop: boolean;
  bpm: number;
};

function describe(
  action: SwitchAction | undefined,
  state: StageState,
): { label: string; on: boolean } {
  if (!action) return { label: '', on: false };
  switch (action.kind) {
    case 'scene': {
      const scene = state.scenes.find((s) => s.id === action.scene);
      return {
        label: scene?.name ?? 'Scene',
        on: state.scene === action.scene,
      };
    }
    case 'previous':
      return { label: 'Previous', on: false };
    case 'next':
      return { label: 'Next', on: false };
    case 'block': {
      const block = state.blocks[action.block];
      return { label: block?.label ?? 'Block', on: !!block?.on };
    }
    case 'tuner':
      return { label: 'Tuner', on: state.tuner };
    case 'tap':
      return { label: `Tap ${Math.round(state.bpm)}`, on: false };
    case 'boost':
      return { label: 'Boost', on: state.boost };
    case 'play':
      return { label: state.playing ? 'Pause' : 'Play', on: state.playing };
    case 'loop':
      return { label: 'Loop', on: state.loop };
    case 'none':
      return { label: '—', on: false };
  }
}

const HOLD_MS = 450;

function Switch({
  sw,
  state,
  onAction,
  size,
}: {
  sw: Footswitch;
  state: StageState;
  onAction: (action: SwitchAction) => void;
  size: 'md' | 'lg';
}) {
  const tap = describe(sw.tap, state);
  const hold = sw.hold ? describe(sw.hold, state) : null;
  const [flash, setFlash] = React.useState(false);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const held = React.useRef(false);
  const fire = (action: SwitchAction) => {
    onAction(action);
    setFlash(true);
    setTimeout(() => setFlash(false), 180);
  };
  const scene = sw.tap.kind === 'scene';
  return (
    <button
      type="button"
      data-slot="footswitch"
      data-on={tap.on || undefined}
      aria-pressed={
        sw.tap.kind === 'previous' ||
        sw.tap.kind === 'next' ||
        sw.tap.kind === 'tap'
          ? undefined
          : tap.on
      }
      aria-label={`Switch ${sw.name}: ${tap.label}${hold ? `, hold for ${hold.label}` : ''}`}
      onPointerDown={() => {
        held.current = false;
        if (sw.hold)
          timer.current = setTimeout(() => {
            held.current = true;
            fire(sw.hold!);
          }, HOLD_MS);
      }}
      onPointerUp={() => timer.current && clearTimeout(timer.current)}
      onPointerLeave={() => timer.current && clearTimeout(timer.current)}
      onClick={() => {
        if (held.current) return;
        fire(sw.tap);
      }}
      className={cn(
        'relative grid min-w-0 content-between gap-1 rounded-pad border-2 border-input bg-card p-2.5 text-left transition-[background-color,transform] duration-[var(--duration-fast)] select-none hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring active:scale-[0.97]',
        size === 'lg' ? 'min-h-28' : 'min-h-20',
        tap.on &&
          (scene
            ? 'border-foreground bg-foreground text-background hover:bg-foreground'
            : 'border-foreground'),
        flash && 'scale-[0.97] bg-accent',
      )}
    >
      <span className="flex items-center justify-between gap-2">
        <span
          className={cn(
            'font-mono text-xs font-semibold',
            tap.on && scene ? 'text-background/70' : 'text-muted-foreground',
          )}
        >
          {sw.name}
        </span>
        <span
          aria-hidden="true"
          className={cn(
            'size-3 rounded-full border-2',
            tap.on
              ? scene
                ? 'border-background bg-brand'
                : 'border-brand bg-brand'
              : 'border-wire bg-transparent',
          )}
        />
      </span>
      <span
        className={cn(
          'line-clamp-2 leading-tight font-semibold',
          size === 'lg' ? 'text-md sm:text-xl' : 'text-sm sm:text-md',
        )}
      >
        {tap.label}
      </span>
      {hold && (
        <span
          className={cn(
            'truncate small-caps text-xs',
            tap.on && scene ? 'text-background/70' : 'text-muted-foreground',
          )}
        >
          Hold · {hold.label}
        </span>
      )}
    </button>
  );
}

/**
 * The foot controller on screen: one tile per switch, laid out as on the
 * unit, each with its name, its light, what a tap does in large type and
 * what a hold does underneath. It mirrors the hardware (a press on the
 * pedal lights the tile) and works as a touch control too. Any number of
 * switches: the profile decides.
 */
export function Footswitches({
  profile,
  state,
  onAction,
  size = 'lg',
  className,
}: {
  profile: ControllerProfile;
  state: StageState;
  onAction: (action: SwitchAction) => void;
  size?: 'md' | 'lg';
  className?: string;
}) {
  const columns = Math.min(profile.columns, 5);
  return (
    <div
      data-slot="footswitches"
      role="group"
      aria-label={`Footswitches · ${profile.name}`}
      className={cn('grid gap-2', className)}
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
    >
      {profile.switches.map((sw) => (
        <Switch
          key={sw.id}
          sw={sw}
          state={state}
          onAction={onAction}
          size={size}
        />
      ))}
    </div>
  );
}
