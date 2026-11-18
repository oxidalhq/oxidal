import { createContext, useContext } from 'react';

/** Portals keep React context even when their elements move outside the dialog.
 * @see apps/storybook/docs/guide.md
 */
export const DialogLayer = createContext(false);

/** A popup must remain above its owning modal and below the notice tray. */
export function useFloatingLayer() {
  return useContext(DialogLayer)
    ? 'z-[calc(var(--z-index-dialog)+1)]'
    : 'z-popover';
}
