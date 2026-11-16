import type { EffectChoice } from './block-chooser';
import { delay, drive, gate, mod, reverb } from './rig.fixtures';

const named =
  (label: string, caption: string) => (b: ReturnType<typeof drive>) => ({
    ...b,
    label,
    caption,
  });

/** Effects the chooser offers: Oxidal's own, the TONE3000 engine's, and LV2 (installed or not). */
export const EFFECTS: EffectChoice[] = [
  {
    id: 'bloom',
    label: 'Bloom reverb',
    kind: 'Reverb',
    from: 'oxidal',
    make: (id) => reverb(id, 'Reverb · Hall'),
  },
  {
    id: 'echo',
    label: 'Echo delay',
    kind: 'Delay',
    from: 'oxidal',
    make: (id) => ({ ...delay(id), on: true }),
  },
  {
    id: 'motion',
    label: 'Motion',
    kind: 'Modulation',
    from: 'oxidal',
    make: (id) => mod(id),
  },
  {
    id: 'sustain',
    label: 'Sustain',
    kind: 'Dynamics',
    from: 'oxidal',
    make: (id) => named('Sustain', 'Compressor')(gate(id)),
  },
  {
    id: 'hold',
    label: 'Hold',
    kind: 'Freeze',
    from: 'engine',
    make: (id) => named('Hold', 'Freeze')(mod(id)),
  },
  {
    id: 'swell',
    label: 'Swell',
    kind: 'Volume',
    from: 'engine',
    make: (id) => named('Swell', 'Volume swell')(mod(id)),
  },
  {
    id: 'pitch',
    label: 'Pitch',
    kind: 'Pitch',
    from: 'engine',
    make: (id) => named('Pitch', 'Pitch shift')(mod(id)),
  },
  {
    id: 'gx-ts',
    label: 'Tube Screamer',
    kind: 'Drive',
    from: 'lv2',
    pack: 'Guitarix',
    installed: true,
    make: (id) => named('Tube Screamer', 'Drive · Guitarix')(drive(id)),
  },
  {
    id: 'gx-fuzz',
    label: 'Fuzz Face',
    kind: 'Drive',
    from: 'lv2',
    pack: 'Guitarix',
    installed: true,
    make: (id) => named('Fuzz Face', 'Drive · Guitarix')(drive(id)),
  },
  {
    id: 'df-room',
    label: 'Dragonfly Room',
    kind: 'Reverb',
    from: 'lv2',
    pack: 'Dragonfly Reverb',
    installed: false,
    make: (id) => reverb(id, 'Reverb · Dragonfly'),
  },
];
