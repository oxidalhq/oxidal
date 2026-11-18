import {
  Faders,
  ListNumbers,
  Microphone,
  MusicNotes,
  Notebook,
  Stack,
  User,
  Waveform,
} from '@phosphor-icons/react';

import type { Section } from '../patterns/workspace';

export const LIBRARY_SECTIONS: Section[] = [
  {
    id: 'mine',
    description:
      'Your presets. Play one, keep versions of it for different rooms, and add it to a set list.',
    label: 'Mine',
    icon: <User />,
    count: 6,
  },
  {
    id: 'oxidal',
    description:
      'Finished sounds that come with Oxidal. Try one, then save a copy to Mine to change it.',
    label: 'Oxidal sounds',
    icon: <Stack />,
    count: 16,
  },
  {
    id: 'tone3000',
    description:
      'Search TONE3000, hear a tone through your rig and keep the ones you like. Each tone shows its creator and licence.',
    label: 'TONE3000',
    icon: <Waveform />,
  },
  {
    id: 'setlist',
    description:
      'The songs of a gig, in order. Each entry names a preset, a scene and a backing track; a footswitch steps through them.',
    label: 'Set list',
    icon: <ListNumbers />,
    count: 4,
  },
  {
    id: 'songbook',
    description:
      'Chord sheets and lyrics for your songs. A sheet can follow its backing track on stage.',
    label: 'Songbook',
    icon: <Notebook />,
    count: 4,
  },
  {
    id: 'tones',
    description:
      'NAM captures and cab IRs on this device: your own files and the tones you kept from TONE3000.',
    label: 'Tones and IRs',
    icon: <Waveform />,
    count: 6,
  },
  {
    id: 'backing',
    description:
      'Tracks to play along with. A track can be split into stems, slowed down, looped and linked to a preset.',
    label: 'Backing tracks',
    icon: <MusicNotes />,
    count: 4,
  },
  {
    id: 'stems',
    description:
      'Songs split into instruments. Mute your own part, save the mix and use it as a backing track.',
    label: 'Stems',
    icon: <Faders />,
    count: 2,
  },
  {
    id: 'di',
    description:
      'Dry recordings of your guitar. Play one back through any preset to compare tones without playing again.',
    label: 'DI and reamps',
    icon: <Microphone />,
    count: 2,
  },
];
