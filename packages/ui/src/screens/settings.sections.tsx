import {
  Broadcast,
  CheckCircle,
  Gear,
  Info,
  Monitor,
  Plug,
  PuzzlePiece,
  SlidersHorizontal,
  SpeakerHifi,
  UserCircle,
  Waveform,
  Wrench,
} from '@phosphor-icons/react';

import type { Section } from '../patterns/workspace';

export const SETTINGS_SECTIONS: Section[] = [
  {
    id: 'essentials',
    label: 'Before you play',
    icon: <CheckCircle />,
    description:
      'The few things that decide whether a gig goes well, in one place: what you will hear, what your feet control, and what to fix first. Everything else is in the pages below.',
  },
  {
    id: 'audio',
    label: 'Audio',
    icon: <SpeakerHifi />,
    description:
      'The audio interface, its sample rate and buffer, and what plays when the device starts. A change restarts audio for a moment.',
  },
  {
    id: 'nam',
    label: 'NAM engine',
    icon: <Waveform />,
    description:
      'The engine that plays every NAM capture, from your files or TONE3000. These settings are for this unit: kept across presets, not saved in them.',
  },
  {
    id: 'effects',
    label: 'Effects',
    icon: <SlidersHorizontal />,
    description:
      'The effects that come with Oxidal: its own, written in Rust, and those that are part of the TONE3000 engine. They are always available in the block chooser.',
  },
  {
    id: 'plugins',
    label: 'LV2',
    icon: <PuzzlePiece />,
    description:
      'LV2 is the open standard for audio plugins on Linux. These packs are made by other people: Oxidal has tried them on the Pi but does not ship them. You choose what to install, each comes under its own licence, and you can remove it again.',
  },
  {
    id: 'midi',
    label: 'MIDI',
    icon: <Plug />,
    description:
      'Foot controllers and MIDI mapping. Any control can be learned; the default map covers scenes, presets, tap, tuner and Protect.',
  },
  {
    id: 'connections',
    label: 'Network',
    icon: <Broadcast />,
    description:
      "How screens reach the device: your Wi-Fi network, or the device's own hotspot when there is none.",
  },
  {
    id: 'accounts',
    label: 'Accounts',
    icon: <UserCircle />,
    description:
      'Accounts the device signs in to, such as TONE3000 for getting tones. Sign-in happens on the device; only a code reaches this screen.',
  },
  {
    id: 'display',
    label: 'Display',
    icon: <Monitor />,
    description:
      'How this screen looks: display mode for the stage, sunlight or e-paper, the status at the top, and keeping the screen awake.',
  },
  {
    id: 'device',
    label: 'Device',
    icon: <Gear />,
    description:
      'The Raspberry Pi itself: its name, temperature protection, storage and power.',
  },
  {
    id: 'maintenance',
    label: 'Maintenance',
    icon: <Wrench />,
    description:
      'Backups, updates, logs and recovery. Nothing here changes your sound.',
  },
  {
    id: 'about',
    label: 'About',
    icon: <Info />,
    description:
      'The Oxidal version, its licences, and the projects and people it builds on.',
  },
];
