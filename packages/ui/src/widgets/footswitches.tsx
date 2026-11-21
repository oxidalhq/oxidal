import * as React from 'react';

import { cn } from '../lib/cn';
import { sceneColour } from '../lib/scene-colours';
import type {
  ControllerProfile,
  Footswitch,
  SwitchAction,
} from './controllers';
import { SceneStripe } from './scene-pad';

export type StageState = {
  scene: string | null;
  scenes: { id: string; name: string; colour?: string }[];
  blocks: Record<string, { label: string; on: boolean }>;
  boost: boolean;
  tuner: boolean;
  playing: boolean;
  loop: boolean;
  bpm?: number | null;
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
      return {
        label: state.bpm == null ? 'Tap tempo' : `Tap ${Math.round(state.bpm)}`,
        on: false,
      };
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
  return (
    <FootswitchPad
      name={sw.name}
      label={tap.label}
      holdLabel={hold?.label}
      pressed={
        ['previous', 'next', 'tap'].includes(sw.tap.kind) ? undefined : tap.on
      }
      scene={sw.tap.kind === 'scene'}
      colour={tap.colour}
      size={size}
      onTap={() => onAction(sw.tap)}
      onHold={sw.hold ? () => onAction(sw.hold!) : undefined}
    />
  );
}

export function FootswitchPad({
  name,
  label,
  accessibleName,
  holdLabel,
  pressed,
  colour,
  scene = false,
  size = 'lg',
  disabled,
  onTap,
  onHold,
}: {
  name: string;
  label: string;
  accessibleName?: string;
  holdLabel?: string;
  pressed?: boolean;
  colour?: string;
  scene?: boolean;
  size?: 'md' | 'lg';
  disabled?: boolean;
  onTap: () => void;
  onHold?: () => void;
}) {
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const held = React.useRef(false);
  const cancel = React.useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  React.useEffect(() => cancel, [cancel, disabled, name, label, holdLabel]);
  return (
    <button
      type="button"
      data-slot="footswitch"
      disabled={disabled}
      aria-label={
        accessibleName ??
        [name, label, holdLabel && `Hold · ${holdLabel}`]
          .filter(Boolean)
          .join(' ')
      }
      data-on={pressed || undefined}
      aria-pressed={pressed}
      onPointerDown={(event) => {
        cancel();
        held.current = false;
        if (onHold && event.isPrimary !== false && event.button <= 0)
          timer.current = setTimeout(() => {
            held.current = true;
            onHold();
          }, HOLD_MS);
      }}
      onPointerCancel={cancel}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onKeyDown={() => {
        held.current = false;
      }}
      onClick={() => {
        if (!held.current) onTap();
        held.current = false;
      }}
      className={cn(
        'relative grid min-w-0 content-between gap-1 overflow-hidden rounded-pad border-2 border-input bg-card p-2.5 text-left transition-[background-color,transform] duration-[var(--duration-fast)] select-none hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring active:scale-[0.97]',
        size === 'lg' ? 'min-h-28' : 'min-h-20',
        pressed &&
          (scene
            ? 'border-foreground bg-foreground text-background hover:bg-foreground'
            : 'border-foreground'),
      )}
    >
      {colour && <SceneStripe colour={colour} />}
      <span className="flex items-center justify-between gap-2">
        <span
          className={cn(
            'font-mono text-xs font-semibold',
            pressed && scene ? 'text-background/70' : 'text-muted-foreground',
          )}
        >
          {name}
        </span>{' '}
        <span
          aria-hidden="true"
          className={cn(
            'size-3 rounded-full border-2',
            pressed
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
        {label}
      </span>{' '}
      {holdLabel && (
        <span
          className={cn(
            'truncate small-caps text-xs',
            pressed && scene ? 'text-background/70' : 'text-muted-foreground',
          )}
        >
          Hold · {holdLabel}
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
