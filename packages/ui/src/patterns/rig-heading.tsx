import { type ReactNode, useContext, useState } from 'react';
import { createPortal } from 'react-dom';

import { Eyebrow } from '../components/ui/text';
import { BarSlotContext } from './dock-context';

/**
 * The Rig's heading: the playing preset (`identity`), its main action
 * (`primary`, such as Perform) and the rest of its actions (`children`).
 * With the display bar they move into the bar. With the floating capsule
 * the preset goes in the capsule's preset slot, the main action beside it,
 * and the rest into the opened capsule (on a phone, in its tray). Without
 * an extras slot the rest stay in a row in the page.
 * @see docs/interface.md
 */
export function RigHeading({
  playing,
  identity,
  primary,
  children,
}: {
  playing: boolean;
  identity: ReactNode;
  /** The main action, always beside the preset: Perform. */
  primary?: ReactNode;
  children: ReactNode;
}) {
  const slots = useContext(BarSlotContext);
  // On a phone the opened capsule has no room for the rest: a row in the page
  // holds them, and anything the preset picker adds (such as its linked mix).
  const [row, setRow] = useState<HTMLElement | null>(null);
  const actions = (
    <div
      role="group"
      aria-label="Rig actions"
      className="flex items-center gap-1"
    >
      {children}
    </div>
  );
  if (slots?.capsule && slots.identity && slots.actions)
    return (
      <>
        <BarSlotContext.Provider
          value={{ ...slots, extras: slots.extras ?? row }}
        >
          {createPortal(identity, slots.identity)}
        </BarSlotContext.Provider>
        {primary && createPortal(primary, slots.actions)}
        {slots.extras ? (
          createPortal(actions, slots.extras)
        ) : (
          <header
            data-slot="rig-heading"
            className="flex flex-wrap items-center justify-end gap-2 px-page pt-1"
          >
            <span ref={setRow} className="contents" />
            {actions}
          </header>
        )}
      </>
    );
  // With the display bar the preset and its actions live in the bar, not in the page.
  if (slots?.identity && slots.actions)
    return (
      <>
        {createPortal(identity, slots.identity)}
        {createPortal(
          <div
            role="group"
            aria-label="Rig actions"
            className="flex items-center gap-1"
          >
            {primary}
            {children}
          </div>,
          slots.actions,
        )}
      </>
    );
  return (
    <header data-slot="rig-heading" className="grid gap-2 px-page pt-3">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div className="grid max-w-full min-w-0 gap-1">
          <Eyebrow>{playing ? 'Playing' : 'Rig'}</Eyebrow>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {identity}
          </div>
        </div>
        <div
          role="group"
          aria-label="Rig actions"
          className="flex flex-wrap items-center gap-2"
        >
          {primary}
          {children}
        </div>
      </div>
    </header>
  );
}
