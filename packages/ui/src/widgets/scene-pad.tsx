import * as React from 'react';

import { cn } from '../lib/cn';
import { sceneColour } from '../lib/scene-colours';
import { MidiTarget } from './midi';

export type Scene = {
  id: string;
  name: string;
  number?: number;
  /** The scene's colour (see lib/scene-colours): a stripe on its pad. */
  colour?: string;
};

/** A scene's colour along the top of whatever stands for it. */
export function SceneStripe({ colour }: { colour: string }) {
  return (
    <span
      aria-hidden="true"
      data-slot="scene-colour"
      className="absolute inset-x-0 top-0 h-1"
      style={{ backgroundColor: colour }}
    />
  );
}

/**
 * One scene: a pad with its number in small caps and its name large. The
 * active pad inverts ink and paper; while a change is fading in, the pad
 * shows an oxide edge. Pads are 8 px radius, at least 56 px high, and the
 * name wraps to two lines before it truncates. Long-press (or the ⋯ on
 * the editing surface) opens the scene menu.
 */
export function ScenePad({
  scene,
  active = false,
  fading = false,
  disabled = false,
  size = 'md',
  onSelect,
  onMenu,
  className,
  ...buttonProps
}: {
  scene: Scene;
  active?: boolean;
  fading?: boolean;
  disabled?: boolean;
  size?: 'md' | 'lg';
  onSelect: (id: string) => void;
  onMenu?: (id: string) => void;
  className?: string;
} & Omit<React.ComponentProps<'button'>, 'onSelect' | 'onClick' | 'children'>) {
  const held = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const fired = React.useRef(false);
  const cancel = () => {
    if (held.current) clearTimeout(held.current);
    held.current = null;
  };
  React.useEffect(() => cancel, []);
  return (
    <button
      type="button"
      data-slot="scene-pad"
      data-active={active || undefined}
      data-fading={fading || undefined}
      aria-pressed={active}
      disabled={disabled}
      onPointerDown={() => {
        if (!onMenu) return;
        fired.current = false;
        held.current = setTimeout(() => {
          fired.current = true;
          onMenu(scene.id);
        }, 450);
      }}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onContextMenu={(event) => {
        if (!onMenu) return;
        event.preventDefault();
        onMenu(scene.id);
      }}
      onClick={() => {
        if (fired.current) return;
        onSelect(scene.id);
      }}
      {...buttonProps}
      className={cn(
        'relative grid min-w-0 content-start gap-0.5 overflow-hidden rounded-pad border border-input bg-card px-3 py-2 text-left transition-[background-color,transform] duration-[var(--duration-fast)] select-none hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40',
        size === 'md' ? 'min-h-14' : 'min-h-20 px-4 py-3',
        active &&
          'border-foreground bg-foreground text-background hover:bg-foreground',
        fading && 'border-brand shadow-[inset_0_0_0_1px_var(--brand)]',
        className,
      )}
    >
      {scene.colour && <SceneStripe colour={scene.colour} />}
      {scene.number !== undefined && (
        <span
          className={cn(
            'small-caps text-xs font-medium',
            active ? 'text-background/70' : 'text-muted-foreground',
          )}
        >
          Scene {scene.number}
        </span>
      )}{' '}
      <span
        className={cn(
          'line-clamp-2 font-semibold',
          size === 'md' ? 'text-md' : 'text-xl',
        )}
      >
        {scene.name}
      </span>
    </button>
  );
}

/**
 * The scene grid: two columns on phones, up to four on wider screens. Each
 * scene takes its colour from its place unless it has its own.
 */
export function ScenePads({
  scenes,
  active,
  fading = false,
  disabled = false,
  size = 'md',
  onSelect,
  onMenu,
  className,
}: {
  scenes: Scene[];
  active: string | null;
  fading?: boolean;
  disabled?: boolean;
  size?: 'md' | 'lg';
  onSelect: (id: string) => void;
  onMenu?: (id: string) => void;
  className?: string;
}) {
  return (
    <div
      data-slot="scene-pads"
      role="group"
      aria-label="Scenes"
      className={cn('grid grid-cols-2 gap-2 sm:grid-cols-4', className)}
    >
      {scenes.map((scene, index) => (
        <MidiTarget
          key={scene.id}
          id={`scene:${index + 1}`}
          label={`Scene ${index + 1} · ${scene.name}`}
          kind="trigger"
          group="Scenes"
          onMidi={(m) => (m.kind === 'pc' || m.value > 0) && onSelect(scene.id)}
        >
          <ScenePad
            scene={{
              number: index + 1,
              ...scene,
              colour: scene.colour ?? sceneColour(index),
            }}
            active={scene.id === active}
            fading={fading && scene.id === active}
            disabled={disabled}
            size={size}
            onSelect={onSelect}
            onMenu={onMenu}
          />
        </MidiTarget>
      ))}
    </div>
  );
}
