import type { Named } from './switch-layouts';

/** Example lists for the switch layout stories. */
export const LAYOUT_LISTS: {
  blocks: Named[];
  scenes: Named[];
  presets: Named[];
} = {
  blocks: [
    { id: 'ts9', name: 'TS9' },
    { id: 'motion', name: 'Motion' },
    { id: 'echo', name: 'Echo' },
    { id: 'bloom', name: 'Bloom' },
  ],
  scenes: [
    { id: 'verse', name: 'Verse' },
    { id: 'chorus', name: 'Chorus' },
    { id: 'lead', name: 'Lead' },
    { id: 'swells', name: 'Swells' },
  ],
  presets: [
    { id: 'rhythm', name: 'Rhythm section' },
    { id: 'crunch', name: 'Brown Crunch' },
    { id: 'worship', name: 'Worship rig' },
    { id: 'ambient', name: 'Ambient pad' },
  ],
};
