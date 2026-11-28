import { useEffect, useRef } from 'react';

import { Led } from '@oxidal/design-system/components/badge';
import { Button } from '@oxidal/design-system/components/button';
import { sceneColour } from '@oxidal/design-system/lib/scene-colours';
import { ScenePad } from '@oxidal/design-system/widgets/scene-pad';

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
  canRecallActive = false,
  fading,
  disabled,
  onSelect,
  extra,
  onMenu,
  compact = false,
  details,
  fill = false,
}: {
  scenes: Scene[];
  active: string | null | undefined;
  /** A manual override can be reset by pressing the last recalled scene again. */
  canRecallActive?: boolean;
  fading: boolean;
  disabled: boolean;
  onSelect: (id: string) => void;
  /** A control for the heading, such as how scenes change. */
  extra?: React.ReactNode;
  /** The scene menu (rig view): a ⋯ on each pad, or hold the pad. */
  onMenu?: (id: string) => void;
  /** Tabs in a thin strip instead of large pads: the chain and the controls get the room. */
  compact?: boolean;
  /**
   * Perform (C2): what each pad's switch does: the pedals the scene turns on
   * and off, and the MIDI it answers to.
   */
  details?: (scene: Scene) => {
    midi?: string;
    pedals?: {
      id: string;
      label: string;
      on: boolean;
      /** The block's kind, for its coloured light (C2). */
      kind?: 'amp' | 'cab' | 'pedal' | 'time' | 'mod' | 'lv2' | 'other';
      /** The block's gear picture, drawn small beside its name. */
      face?: React.ReactNode;
    }[];
  };
  /** The pads share the room they are given (Perform): one row of tall cards. */
  fill?: boolean;
}) {
  const held = useRef<{ timer: ReturnType<typeof setTimeout>; fired: boolean }>(
    null,
  );
  const release = () => {
    if (held.current) clearTimeout(held.current.timer);
  };
  useEffect(() => release, []);
  // The tab strip keeps the sounding scene in view: on a phone it would
  // otherwise sit past the edge, and nothing would say which scene plays.
  const strip = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const row = strip.current;
    // The pressed tab's wrapper: the strip is its positioned parent.
    const tab = row?.querySelector<HTMLElement>(
      '[aria-pressed=true]',
    )?.parentElement;
    if (!row || !tab) return;
    const left = tab.offsetLeft;
    const right = left + tab.offsetWidth;
    if (left < row.scrollLeft) row.scrollLeft = left;
    else if (right > row.scrollLeft + row.clientWidth)
      row.scrollLeft = right - row.clientWidth;
  }, [active, compact]);
  // Latest props for the key handler without re-registering it every render.
  const latest = useRef({
    scenes,
    active,
    canRecallActive,
    disabled,
    onSelect,
  });
  useEffect(() => {
    latest.current = { scenes, active, canRecallActive, disabled, onSelect };
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
      const { scenes, active, canRecallActive, disabled, onSelect } =
        latest.current;
      const scene = Number.isInteger(index) ? scenes[index] : undefined;
      if (!scene || disabled || (scene.id === active && !canRecallActive))
        return;
      e.preventDefault();
      onSelect(scene.id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const tap = (scene: Scene) => {
    // A hold that opened the menu is not also a tap.
    if (held.current?.fired) {
      held.current = null;
      return;
    }
    if (scene.id !== active || canRecallActive) onSelect(scene.id);
  };
  const holdProps = (scene: Scene) =>
    onMenu
      ? {
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
        }
      : {};
  if (compact)
    return (
      <section
        className="flex items-end gap-x-3 border-b border-border"
        aria-label="Scenes"
      >
        <div
          ref={strip}
          // A row that runs past the edge on a phone fades out there and scrolls.
          className="relative flex min-w-0 flex-1 items-end gap-1 overflow-x-auto overflow-y-hidden max-md:mask-r-from-[calc(100%-1.5rem)] md:flex-initial"
          role="group"
          aria-label="Scenes"
          aria-busy={fading}
        >
          {scenes.map((scene, i) => {
            const on = scene.id === active;
            return (
              <div key={scene.id} className="group/tab relative flex shrink-0">
                <button
                  type="button"
                  aria-pressed={on}
                  aria-label={`Scene ${i + 1}: ${scene.name}`}
                  aria-keyshortcuts={i < 9 ? String(i + 1) : undefined}
                  disabled={disabled}
                  onClick={() => tap(scene)}
                  {...holdProps(scene)}
                  // As C2 on a phone: the sounding scene keeps its name, the
                  // others show their number (the label still names them).
                  className={`relative flex min-h-control items-center gap-2 rounded-t-lg border border-b-0 py-1 pr-9 pl-3 text-sm focus-visible:outline-2 focus-visible:outline-ring [@media(pointer:coarse)]:min-h-touch ${on ? '-mb-px border-border bg-card font-semibold' : 'border-transparent text-muted-foreground hover:bg-accent max-md:min-w-10 max-md:justify-center max-md:pr-3'} ${on && fading ? 'animate-pulse' : ''}`}
                >
                  <span
                    aria-hidden="true"
                    className="absolute inset-x-2 top-0 h-0.5 rounded-full"
                    style={{ background: sceneColour(i) }}
                  />
                  <span className="font-mono text-xs text-muted-foreground">
                    {i + 1}
                  </span>
                  <span className={on ? undefined : 'max-md:hidden'}>
                    {scene.name}
                  </span>
                </button>
                {onMenu && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    // A phone has no hover: a number-only tab has no room for
                    // a hidden ⋯, and pressing the tab brings its own ⋯.
                    className={`absolute top-1/2 right-0.5 size-7 -translate-y-1/2 ${on ? '' : 'opacity-0 group-hover/tab:opacity-100 focus-visible:opacity-100 max-md:hidden'}`}
                    aria-label={`More for scene ${scene.name}`}
                    aria-haspopup="dialog"
                    disabled={disabled}
                    onClick={() => onMenu(scene.id)}
                  >
                    ⋯
                  </Button>
                )}
              </div>
            );
          })}
        </div>
        <span className="flex shrink-0 items-baseline gap-3 pb-2 text-xs text-muted-foreground">
          {fading && 'fading…'}
          {extra}
        </span>
      </section>
    );
  return (
    <section
      className={fill ? 'flex min-h-0 flex-1 flex-col gap-2' : 'grid gap-2'}
      aria-label="Scenes"
    >
      <h3
        className={
          // Perform (C2): the cards speak for themselves.
          fill
            ? 'sr-only'
            : 'flex flex-wrap items-baseline justify-between gap-x-3 text-sm font-semibold'
        }
      >
        Scenes
        <span className="inline-flex flex-wrap items-baseline justify-end gap-x-3 text-xs font-normal text-muted-foreground">
          {fading ? (
            'fading…'
          ) : (
            <span className="hidden sm:inline">tap or press 1–9</span>
          )}
          {extra}
        </span>
      </h3>
      <div
        className={
          fill
            ? 'grid min-h-[clamp(11rem,38vh,30rem)] flex-1 auto-rows-fr grid-cols-2 gap-2 sm:grid-cols-[repeat(auto-fit,minmax(10rem,1fr))]'
            : 'grid grid-cols-2 gap-2 sm:grid-cols-4'
        }
        role="group"
        aria-label="Scenes"
        aria-busy={fading}
      >
        {scenes.map((scene, i) => {
          const about = details?.(scene);
          const on = scene.id === active;
          const card = about && (about.midi || about.pedals?.length) && (
            // Drawn over the pad, out of the way of its press; said once
            // more for a screen reader through the pad's description.
            <span
              aria-hidden="true"
              className={`pointer-events-none absolute inset-x-3 top-20 bottom-3 flex flex-col justify-between gap-2 overflow-hidden text-left md:top-24 ${on ? 'text-background' : 'text-foreground'}`}
            >
              <ul className="m-0 grid list-none content-start gap-1 p-0">
                {about.pedals?.slice(0, 8).map((pedal) => (
                  <li
                    key={pedal.id}
                    className={`flex min-w-0 items-center gap-2 text-sm ${pedal.on ? 'font-medium' : 'font-normal opacity-60'}`}
                  >
                    {pedal.kind && pedal.kind !== 'other' ? (
                      <Led kind={pedal.kind} on={pedal.on} className="size-2" />
                    ) : (
                      <span
                        className={`size-2 shrink-0 rounded-full ${pedal.on ? 'bg-current' : 'border border-current'}`}
                      />
                    )}
                    {pedal.face && (
                      <span
                        className={`flex size-4 shrink-0 items-center justify-center [&_svg]:size-4 ${pedal.on ? '' : 'opacity-40'}`}
                      >
                        {pedal.face}
                      </span>
                    )}
                    <span className="truncate">{pedal.label}</span>
                    {!pedal.on && (
                      <span className="shrink-0 text-xs small-caps">Off</span>
                    )}
                  </li>
                ))}
                {(about.pedals?.length ?? 0) > 8 && (
                  <li className="text-xs">+{about.pedals!.length - 8} more</li>
                )}
              </ul>
              {about.midi && (
                <span className="self-end font-mono text-xs tabular-nums opacity-80">
                  {about.midi}
                </span>
              )}
            </span>
          );
          const describedBy = card ? `scene-pad-${scene.id}-about` : undefined;
          const pad = (
            <ScenePad
              key={scene.id}
              scene={{ ...scene, number: i + 1, colour: sceneColour(i) }}
              active={scene.id === active}
              fading={fading && scene.id === active}
              size={fill ? 'lg' : 'md'}
              className={`${onMenu ? 'h-full w-full pr-11' : 'h-full w-full'} ${fill ? '[&>.line-clamp-2]:font-display [&>.line-clamp-2]:text-2xl md:[&>.line-clamp-2]:text-3xl' : ''}`}
              aria-label={`Scene ${i + 1}: ${scene.name}`}
              aria-describedby={describedBy}
              aria-keyshortcuts={i < 9 ? String(i + 1) : undefined}
              disabled={disabled}
              onSelect={() => {
                // A hold that opened the menu is not also a tap.
                if (held.current?.fired) {
                  held.current = null;
                  return;
                }
                if (scene.id !== active || canRecallActive) onSelect(scene.id);
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
          const said = card && (
            <span id={describedBy} className="sr-only">
              {[
                about.pedals
                  ?.map((p) => `${p.label} ${p.on ? 'on' : 'off'}`)
                  .join(', '),
                about.midi && `MIDI ${about.midi}`,
              ]
                .filter(Boolean)
                .join('. ')}
            </span>
          );
          if (card && !onMenu)
            return (
              <div key={scene.id} className="relative grid">
                {pad}
                {card}
                {said}
              </div>
            );
          return onMenu ? (
            <div key={scene.id} className="relative grid">
              {pad}
              {card}
              {said}
              <Button
                variant="ghost"
                size="icon"
                className={`absolute inset-y-0 right-0 h-full rounded-l-none border-l-border ${scene.id === active ? 'text-background' : 'text-foreground'}`}
                aria-label={`More for scene ${scene.name}`}
                aria-haspopup="dialog"
                disabled={disabled}
                onClick={() => onMenu(scene.id)}
              >
                ⋯
              </Button>
            </div>
          ) : (
            pad
          );
        })}
      </div>
    </section>
  );
}
