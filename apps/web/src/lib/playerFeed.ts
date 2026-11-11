import { parsePlayer, type PlayerSnapshot } from '../api';

type Listener = (snapshot: PlayerSnapshot) => void;
const listeners = new Set<Listener>();
let latest: PlayerSnapshot | null = null;

/**
 * Backing player snapshots arrive as `player` events on the tab's one device
 * event stream (`/api/v1/events`); the app owns that stream and hands each
 * snapshot here. A browser allows only a few connections to the device, so
 * the player never opens a second stream.
 * @see docs/media.md
 */
export function publishPlayer(value: unknown) {
  const snapshot = parsePlayer(value);
  latest = snapshot;
  for (const listener of listeners) listener(snapshot);
}

/** Every new snapshot; the newest one at once when there is one. */
export function onPlayer(listener: Listener) {
  listeners.add(listener);
  if (latest) listener(latest);
  return () => {
    listeners.delete(listener);
  };
}
