export const OPEN_SCREEN_EVENT = 'oxidal-open-screen';

/** A screen another screen can send the player to, such as Settings › Audio. */
export type ScreenTarget =
  { screen: 'guitars' } | { screen: 'settings'; section: 'audio' | 'midi' };

/**
 * Opens another screen from inside one (the chain bar's stream status, the
 * edge lanes' guitar and MIDI figures). App owns the screens and still asks
 * about unsaved edits before leaving.
 */
export function requestScreen(target: ScreenTarget) {
  window.dispatchEvent(
    new CustomEvent<ScreenTarget>(OPEN_SCREEN_EVENT, { detail: target }),
  );
}
