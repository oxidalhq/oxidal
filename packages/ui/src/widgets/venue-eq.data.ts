import type { VenueSettings } from '../lib/venue-eq';
import type { VenueProfile } from './venue-eq';

const flat = (): VenueSettings => ({
  trimDb: 0,
  bands: [
    { enabled: false, freqHz: 80 },
    { enabled: true, freqHz: 120, gainDb: 0 },
    { enabled: true, freqHz: 250, gainDb: 0, q: 1 },
    { enabled: true, freqHz: 1000, gainDb: 0, q: 1 },
    { enabled: true, freqHz: 3500, gainDb: 0, q: 1 },
    { enabled: true, freqHz: 8000, gainDb: 0 },
    { enabled: false, freqHz: 12000 },
  ],
});

/** Example profiles: the built-in starting point and two of the player's own. */
export const VENUE_PROFILES: VenueProfile[] = [
  { id: 'flat', name: 'Flat', builtIn: true, eq: flat() },
  {
    id: 'small',
    name: 'Small room',
    eq: {
      ...flat(),
      bands: flat().bands.map((b, i) =>
        i === 0
          ? { ...b, enabled: true, freqHz: 100 }
          : i === 2
            ? { ...b, gainDb: -2.5, q: 1.4 }
            : b,
      ),
    },
  },
  {
    id: 'friday',
    name: 'Friday gig',
    eq: {
      trimDb: -1.5,
      bands: flat().bands.map((b, i) =>
        i === 0
          ? { ...b, enabled: true, freqHz: 80 }
          : i === 4
            ? { ...b, gainDb: 3, q: 0.9 }
            : i === 5
              ? { ...b, gainDb: 2 }
              : i === 6
                ? { ...b, enabled: true, freqHz: 11000 }
                : b,
      ),
    },
  },
];
