import {
  Broadcast,
  Gear,
  Info,
  Monitor,
  Plug,
  PuzzlePiece,
  Waveform,
  SlidersHorizontal,
  SpeakerHifi,
  UserCircle,
  Wrench,
} from '@phosphor-icons/react';
import type { Section } from '../patterns/workspace';

export const SETTINGS_SECTIONS: Section[] = [
  { id: 'audio', label: 'Audio', icon: <SpeakerHifi /> },
  { id: 'nam', label: 'NAM engine', icon: <Waveform /> },
  { id: 'effects', label: 'Effects', icon: <SlidersHorizontal /> },
  { id: 'plugins', label: 'LV2', icon: <PuzzlePiece /> },
  { id: 'midi', label: 'MIDI', icon: <Plug /> },
  { id: 'connections', label: 'Network', icon: <Broadcast /> },
  { id: 'accounts', label: 'Accounts', icon: <UserCircle /> },
  { id: 'display', label: 'Display', icon: <Monitor /> },
  { id: 'device', label: 'Device', icon: <Gear /> },
  { id: 'maintenance', label: 'Maintenance', icon: <Wrench /> },
  { id: 'about', label: 'About', icon: <Info /> },
];
