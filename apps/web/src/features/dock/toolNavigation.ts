export const OPEN_TOOL_EVENT = 'oxidal-open-tool';

/** The tools kept in the dock beside every screen. */
export type ToolId =
  'player' | 'stems' | 'sheet' | 'setlist' | 'tuner' | 'venue';

/**
 * Opens a docked tool from anywhere, such as the capsule's now-playing part
 * or a phone's mini player opening the Player. The dock owns where it shows.
 */
export function requestTool(id: ToolId) {
  window.dispatchEvent(
    new CustomEvent<ToolId>(OPEN_TOOL_EVENT, { detail: id }),
  );
}
