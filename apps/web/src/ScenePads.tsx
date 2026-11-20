import { useEffect, useRef } from 'react';

import { sceneColour } from '@oxidal/design-system/lib/scene-colours';
import { ScenePad } from '@oxidal/design-system/widgets/scene-pad';

import './ScenePads.css';

type Scene = { id: string; name: string };

/** True when a key press belongs to a text field or other editor. */
function typing(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  return (
    !!el &&
    (el.isContentEditable ||
      ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))
  );
}

/**
 * Scene pads for hybrid rigs: one large numbered pad per scene, the sounding
 * one ink-inverted. Number keys 1–9 select scenes too, so a USB keypad or a
 * footswitch that sends keystrokes works before physical MIDI.
 * @see docs/mixed-engine.md
 */
export function ScenePads({
  scenes,
  active,
  fading,
  disabled,
  onSelect,
  extra,
  onMenu,
}: {
  scenes: Scene[];
  active: string | null | undefined;
  fading: boolean;
  disabled: boolean;
  onSelect: (id: string) => void;
  /** A control for the heading, such as how scenes change. */
  extra?: React.ReactNode;
  /** The scene menu (rig view): a ⋯ on each pad, or hold the pad. */
  onMenu?: (id: string) => void;
}) {
  const held = useRef<{ timer: ReturnType<typeof setTimeout>; fired: boolean }>(
    null,
  );
  const release = () => {
    if (held.current) clearTimeout(held.current.timer);
  };
  useEffect(() => release, []);
  // Latest props for the key handler without re-registering it every render.
  const latest = useRef({ scenes, active, disabled, onSelect });
  useEffect(() => {
    latest.current = { scenes, active, disabled, onSelect };
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || typing(e.target)) return;
      if (
        document.querySelector(
          'dialog[open], [role="dialog"][data-state="open"]',
        )
      )
        return;
      const index = Number(e.key) - 1;
      const { scenes, active, disabled, onSelect } = latest.current;
      const scene = Number.isInteger(index) ? scenes[index] : undefined;
      if (!scene || disabled || scene.id === active) return;
      e.preventDefault();
      onSelect(scene.id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <section className="scene-pads" aria-label="Scenes">
      <h3>
        Scenes
        <span className="scene-pads-meta">
          {fading ? (
            'fading…'
          ) : (
            <span className="scene-pads-hint">tap or press 1–9</span>
          )}
          {extra}
        </span>
      </h3>
      <div
        className="grid grid-cols-2 gap-2 sm:grid-cols-4"
        role="group"
        aria-label="Scenes"
        aria-busy={fading}
        // Up to four scenes share one row, even on a phone.
        data-few={scenes.length <= 4 || undefined}
        style={{ '--pads': Math.min(scenes.length, 4) } as React.CSSProperties}
      >
        {scenes.map((scene, i) => {
          const pad = (
            <ScenePad
              key={scene.id}
              scene={{ ...scene, number: i + 1, colour: sceneColour(i) }}
              active={scene.id === active}
              fading={fading && scene.id === active}
              className={onMenu ? 'h-full w-full pr-11' : 'h-full w-full'}
              aria-label={`Scene ${i + 1}: ${scene.name}`}
              aria-keyshortcuts={i < 9 ? String(i + 1) : undefined}
              disabled={disabled}
              onSelect={() => {
                // A hold that opened the menu is not also a tap.
                if (held.current?.fired) {
                  held.current = null;
                  return;
                }
                if (scene.id !== active) onSelect(scene.id);
              }}
              {...(onMenu && {
                onPointerDown: () => {
                  release();
                  const hold = {
                    fired: false,
                    timer: setTimeout(() => {
                      hold.fired = true;
                      onMenu(scene.id);
                    }, 600),
                  };
                  held.current = hold;
                },
                onPointerUp: release,
                onPointerLeave: release,
                onPointerCancel: release,
                onContextMenu: (event: React.MouseEvent) => {
                  event.preventDefault();
                  release();
                  if (!held.current?.fired) onMenu(scene.id);
                  if (held.current) held.current.fired = true;
                },
              })}
            />
          );
          return onMenu ? (
            <div key={scene.id} className="scene-pad-cell">
              {pad}
              <button
                type="button"
                className="scene-pad-more"
                aria-label={`More for scene ${scene.name}`}
                aria-haspopup="dialog"
                disabled={disabled}
                onClick={() => onMenu(scene.id)}
              >
                ⋯
              </button>
            </div>
          ) : (
            pad
          );
        })}
      </div>
    </section>
  );
}
