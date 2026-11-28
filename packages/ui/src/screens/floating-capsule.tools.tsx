import {
  Faders,
  Info,
  Monitor,
  Notebook,
  Play,
  Power,
  Repeat,
  Waveform,
  Wrench,
} from '@phosphor-icons/react';

import type { DockTool } from '../patterns/dock-zones';
import type { CapsuleMenuItem } from '../patterns/floating-capsule';
import type { Backing } from './floating-capsule.hooks';
import {
  type DockToolId,
  ToolBody,
  ToolIcon,
} from './floating-capsule.media.demo';

/**
 * Sample data for the C2 stories: the ☰ menu's items and the tools offered
 * to the dock, filled from the example backing track. The app builds the
 * same shapes from its own actions, media, stems, songbook and set list.
 */

export const TOOL_ORDER: DockToolId[] = [
  'player',
  'stems',
  'sheet',
  'notes',
  'setlist',
];

const TITLES: Record<DockToolId, string> = {
  player: 'Player',
  stems: 'Stems',
  sheet: 'Sheet',
  notes: 'Notes',
  setlist: 'Set list',
};

/** The tools, with a light on the ones still working (a track playing, a split). */
export function sampleDockTools(media: Backing): DockTool[] {
  return TOOL_ORDER.map((id) => ({
    id,
    title: TITLES[id],
    icon: <ToolIcon tool={id} />,
    content: ({ wide }) => <ToolBody tool={id} media={media} wide={wide} />,
    running:
      id === 'player' && media.playing
        ? `${media.title} is playing`
        : id === 'stems' && media.split
          ? `Splitting ${media.split.song}, ${media.split.progress}%`
          : undefined,
  }));
}

/** The ☰ menu, as the app has it; Player, Stems and Sheet open in the dock. */
export function sampleMenu(
  open: (tool: DockToolId) => void,
): CapsuleMenuItem[][] {
  const none = () => undefined;
  return [
    [
      { id: 'tools', label: 'Tools', icon: <Wrench />, onSelect: none },
      {
        id: 'display',
        label: 'Display mode',
        icon: <Monitor />,
        onSelect: none,
      },
    ],
    [
      {
        id: 'restart-audio',
        label: 'Restart audio',
        icon: <Waveform />,
        onSelect: none,
      },
      {
        id: 'restart-device',
        label: 'Restart device',
        icon: <Repeat />,
        onSelect: none,
      },
      {
        id: 'shut-down',
        label: 'Shut down device',
        icon: <Power />,
        onSelect: none,
        destructive: true,
      },
    ],
    [
      {
        id: 'player',
        label: 'Player',
        icon: <Play />,
        onSelect: () => open('player'),
      },
      {
        id: 'stems',
        label: 'Stems',
        icon: <Faders />,
        onSelect: () => open('stems'),
      },
      {
        id: 'sheet',
        label: 'Sheet',
        icon: <Notebook />,
        onSelect: () => open('sheet'),
      },
    ],
    [{ id: 'about', label: 'About', icon: <Info />, onSelect: none }],
  ];
}
