/** An LV2 plugin pack Oxidal has qualified but does not ship. */
export type Pack = {
  id: string;
  name: string;
  website: string;
  licence: string;
  effects: number;
  sizeMib: number;
  qualification: string;
  installed: boolean;
  usedBy: string[];
};

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
