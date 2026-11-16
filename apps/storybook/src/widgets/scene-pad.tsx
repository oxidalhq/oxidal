import * as React from 'react';
import { cn } from '@/lib/cn';

export type Scene = { id: string; name: string; number?: number };

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
}: {
  scene: Scene;
  active?: boolean;
  fading?: boolean;
  disabled?: boolean;
  size?: 'md' | 'lg';
  onSelect: (id: string) => void;
  onMenu?: (id: string) => void;
  className?: string;
}) {
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
      aria-label={`Scene ${scene.number ?? ''} ${scene.name}`.replace(
        /\s+/g,
        ' ',
      )}
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
      className={cn(
        'grid min-w-0 content-start gap-0.5 rounded-pad border border-input bg-card px-3 py-2 text-left transition-[background-color,transform] duration-[var(--duration-fast)] select-none hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40',
        size === 'md' ? 'min-h-14' : 'min-h-20 px-4 py-3',
        active &&
          'border-foreground bg-foreground text-background hover:bg-foreground',
        fading && 'border-brand shadow-[inset_0_0_0_1px_var(--brand)]',
        className,
      )}
    >
      {scene.number !== undefined && (
        <span
          className={cn(
            'small-caps text-xs font-medium',
            active ? 'text-background/70' : 'text-muted-foreground',
          )}
        >
          Scene {scene.number}
        </span>
      )}
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

/** The scene grid: two columns on phones, up to four on wider screens. */
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
        <ScenePad
          key={scene.id}
          scene={{ number: index + 1, ...scene }}
          active={scene.id === active}
          fading={fading && scene.id === active}
          disabled={disabled}
          size={size}
          onSelect={onSelect}
          onMenu={onMenu}
        />
      ))}
    </div>
  );
}
