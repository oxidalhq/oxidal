import {
  Faders,
  Notebook,
  ListNumbers,
  Microphone,
  MusicNotes,
  Stack,
  User,
  Waveform,
} from '@phosphor-icons/react';
import type { Section } from '../patterns/workspace';

export const LIBRARY_SECTIONS: Section[] = [
  { id: 'mine', label: 'Mine', icon: <User />, count: 6 },
  { id: 'oxidal', label: 'Oxidal sounds', icon: <Stack />, count: 16 },
  { id: 'tone3000', label: 'TONE3000', icon: <Waveform /> },
  { id: 'setlist', label: 'Set list', icon: <ListNumbers />, count: 4 },
  { id: 'songbook', label: 'Songbook', icon: <Notebook />, count: 4 },
  { id: 'tones', label: 'Tones and IRs', icon: <Waveform />, count: 6 },
  { id: 'backing', label: 'Backing tracks', icon: <MusicNotes />, count: 4 },
  { id: 'stems', label: 'Stems', icon: <Faders />, count: 2 },
  { id: 'di', label: 'DI and reamps', icon: <Microphone />, count: 2 },
];
