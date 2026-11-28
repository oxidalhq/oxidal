import {
  ENGINE_EFFECTS as ENGINE_EFFECT_LIST,
  oxidalEffectsFromCatalogue,
} from '../lib/oxidal-effects';
import type { BuiltInEffect, NamEngine, Pack } from './engine-settings';
import OXIDAL_CATALOGUE from './oxidal-effects.fixture.json';

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
/** Settings › Effects from the device's own catalogue, as the app reads it. */
export const OWN_EFFECTS: BuiltInEffect[] =
  oxidalEffectsFromCatalogue(OXIDAL_CATALOGUE);
export const ENGINE_EFFECTS: BuiltInEffect[] = [...ENGINE_EFFECT_LIST];

export const NAM_ENGINE: NamEngine = {
  loudness: '-18',
  calibrate: true,
  oversampling: '2',
  size: 'standard',
  allCores: true,
  sleep: true,
  pitch: true,
};
