import * as React from 'react';
import { cn } from '../lib/cn';
import { sceneColour } from '../lib/scene-colours';
import { SceneStripe } from './scene-pad';
import type {
  ControllerProfile,
  Footswitch,
  SwitchAction,
} from './controllers';

export type StageState = {
  scene: string | null;
  scenes: { id: string; name: string; colour?: string }[];
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
): { label: string; on: boolean; colour?: string } {
  if (!action) return { label: '', on: false };
  switch (action.kind) {
    case 'scene': {
      const index = state.scenes.findIndex((s) => s.id === action.scene);
      const scene = state.scenes[index];
      return {
        label: scene?.name ?? 'Scene',
        on: state.scene === action.scene,
        colour: scene && (scene.colour ?? sceneColour(index)),
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
      aria-label={[sw.name, tap.label, hold && `Hold · ${hold.label}`]
        .filter(Boolean)
        .join(' ')}
      data-on={tap.on || undefined}
      aria-pressed={
        sw.tap.kind === 'previous' ||
        sw.tap.kind === 'next' ||
        sw.tap.kind === 'tap'
          ? undefined
          : tap.on
      }
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
        'relative grid min-w-0 content-between gap-1 overflow-hidden rounded-pad border-2 border-input bg-card p-2.5 text-left transition-[background-color,transform] duration-[var(--duration-fast)] select-none hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring active:scale-[0.97]',
        size === 'lg' ? 'min-h-28' : 'min-h-20',
        tap.on &&
          (scene
            ? 'border-foreground bg-foreground text-background hover:bg-foreground'
            : 'border-foreground'),
        flash && 'scale-[0.97] bg-accent',
      )}
    >
      {tap.colour && <SceneStripe colour={tap.colour} />}
      <span className="flex items-center justify-between gap-2">
        <span
          className={cn(
            'font-mono text-xs font-semibold',
            tap.on && scene ? 'text-background/70' : 'text-muted-foreground',
          )}
        >
          {sw.name}
        </span>{' '}
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
          size === 'lg'
            ? 'lg:text-4xl text-lg sm:text-xl'
            : 'text-sm sm:text-md',
        )}
      >
        {tap.label}
      </span>{' '}
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
      className={cn(
        // Rows share the height they are given, so on a stage the tiles
        // fill the screen. Four switches sit two by two on a phone.
        'grid auto-rows-fr grid-cols-[repeat(var(--switch-columns),minmax(0,1fr))] gap-2',
        profile.switches.length <= 4 && 'max-sm:grid-cols-2',
        className,
      )}
      style={{ ['--switch-columns' as string]: columns }}
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
