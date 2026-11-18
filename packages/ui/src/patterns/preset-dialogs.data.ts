import type { PresetSummary } from './preset-dialogs';

/** An example preset for the preset dialog stories. */
export const BROWN_CRUNCH: PresetSummary = {
  name: 'Brown Crunch',
  summary: 'Mine · 5 blocks · 3 scenes · changed 14 Nov',
  versions: [
    { name: 'Default', caption: 'Saved at home · 12 Nov', isDefault: true },
    { name: 'Friday gig', caption: 'Saved at the venue · 14 Nov' },
  ],
  usedIn: ['Friday set, song 4', 'Rehearsal set, song 2'],
  sources: [
    {
      name: 'Plexi 50',
      caption: 'NAM A2 · by Jane Capture · CC BY 4.0',
      tone3000: true,
    },
    { name: '4×12 Greenback', caption: 'IR · yours' },
  ],
};
