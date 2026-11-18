export type SetEntry = {
  preset: string;
  version: string;
  song?: string;
  bpm?: number;
};

/** The set list the stage stories play through. */
export const FRIDAY_SET: SetEntry[] = [
  { preset: 'Rhythm section', version: 'Friday gig', song: 'harbour', bpm: 96 },
  { preset: 'Ambient swell', version: 'Default', song: 'night', bpm: 84 },
  { preset: 'Lead boost', version: 'Default', bpm: 124 },
  { preset: 'Brown Crunch', version: 'Small room', song: 'glass', bpm: 124 },
  { preset: 'Neon Clean', version: 'Default', bpm: 110 },
  { preset: 'Cold Cathedral', version: 'Default', song: 'chime', bpm: 72 },
];
