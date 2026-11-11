import { parseVenue, type VenueState } from '../api';

type Listener = (state: VenueState) => void;
const listeners = new Set<Listener>();

/**
 * Venue EQ states arrive as `venue` events on the tab's one device event
 * stream (`/api/v1/events`), so two clients editing the venue EQ stay in step
 * without a second stream.
 * @see docs/media.md
 */
export function publishVenue(value: unknown) {
  const state = parseVenue(value);
  for (const listener of listeners) listener(state);
}

export function onVenue(listener: Listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
