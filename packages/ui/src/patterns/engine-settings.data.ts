import type { BuiltInEffect, NamEngine, Pack } from './engine-settings';

/** Example packs; the device lists the real catalogue and its qualification. */
export const PACKS: Pack[] = [
  {
    id: 'guitarix',
    name: 'Guitarix',
    website: 'https://guitarix.org',
    licence: 'GPL-3.0',
    effects: 18,
    sizeMib: 24,
    qualification: 'qualified on Pi 5',
    installed: true,
    usedBy: ['Brown Crunch', 'Lead boost'],
  },
  {
    id: 'dragonfly',
    name: 'Dragonfly Reverb',
    website: 'https://michaelwillis.github.io/dragonfly-reverb/',
    licence: 'GPL-3.0',
    effects: 4,
    sizeMib: 6,
    qualification: 'qualified on Pi 5',
    installed: false,
    usedBy: [],
  },
  {
    id: 'x42',
    name: 'x42 plugins',
    website: 'https://x42-plugins.com',
    licence: 'GPL-2.0',
    effects: 9,
    sizeMib: 11,
    qualification: 'some effects qualified',
    installed: false,
    usedBy: [],
  },
];

/** Oxidal's own effects and the TONE3000 engine's, as built in today. */
export const OWN_EFFECTS: BuiltInEffect[] = [
  'Bloom reverb',
  'Echo delay',
  'Motion',
  'Moment',
  'Sustain',
].map((name) => ({ name, caption: "Oxidal's own · Rust · built in" }));
export const ENGINE_EFFECTS: BuiltInEffect[] = [
  ['Hold', 'Freezes a note'],
  ['Swell', 'Volume swells'],
  ['Pitch', 'Pitch shift; needs the pitch engine on in NAM engine'],
].map(([name, what]) => ({
  name: name!,
  caption: `${what} · part of the TONE3000 engine`,
}));

export const NAM_ENGINE: NamEngine = {
  loudness: '-18',
  calibrate: true,
  oversampling: '2',
  size: 'standard',
  allCores: true,
  sleep: true,
  pitch: true,
};
