import {
  Broadcast,
  Gear,
  Info,
  Monitor,
  Plug,
  SlidersHorizontal,
  SpeakerHifi,
  UserCircle,
  Wrench,
} from '@phosphor-icons/react';
import type { Section } from '@/patterns/workspace';

export const SETTINGS_SECTIONS: Section[] = [
  { id: 'audio', label: 'Audio', icon: <SpeakerHifi /> },
  { id: 'connections', label: 'Network', icon: <Broadcast /> },
  { id: 'accounts', label: 'Accounts', icon: <UserCircle /> },
  { id: 'midi', label: 'MIDI', icon: <Plug /> },
  { id: 'effects', label: 'Effects', icon: <SlidersHorizontal /> },
  { id: 'display', label: 'Display', icon: <Monitor /> },
  { id: 'device', label: 'Device', icon: <Gear /> },
  { id: 'maintenance', label: 'Maintenance', icon: <Wrench /> },
  { id: 'about', label: 'About', icon: <Info /> },
];
