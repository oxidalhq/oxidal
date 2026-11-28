import { Gear, ListNumbers, MusicNote, Waveform } from '@phosphor-icons/react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { Button } from '../components/ui/button';
import { CommandSearch, type SearchGroup } from './command-search';

/**
 * One search for presets, songs, scenes, screens and actions. Open it with
 * the button or ⌘K. Type to filter, arrow keys to move, Enter to choose,
 * Escape to close.
 */
const meta: Meta = {
  title: 'Widgets/Command search',
  parameters: { layout: 'fullscreen' },
};
export default meta;
type Story = StoryObj;

const GROUPS: SearchGroup[] = [
  {
    title: 'Set list',
    items: [
      {
        id: 's1',
        label: 'Slow Burn',
        hint: 'Set list 1',
        icon: <ListNumbers />,
        onChoose: () => undefined,
      },
      {
        id: 's2',
        label: 'Harbour Lights',
        hint: 'Set list 2',
        icon: <ListNumbers />,
        onChoose: () => undefined,
      },
    ],
  },
  {
    title: 'Presets',
    items: [
      {
        id: 'p1',
        label: 'Harmonic Tremolo',
        hint: 'Mine · 6 scenes',
        icon: <MusicNote />,
        onChoose: () => undefined,
      },
      {
        id: 'p2',
        label: 'Fender Super Reverb 1977',
        hint: 'TONE3000 · NAM chain',
        icon: <MusicNote />,
        onChoose: () => undefined,
      },
    ],
  },
  {
    title: 'Scenes',
    items: [
      {
        id: 'c1',
        label: 'Scene 1: Clean',
        icon: <Waveform />,
        onChoose: () => undefined,
      },
      {
        id: 'c2',
        label: 'Scene 2: Tremolo',
        icon: <Waveform />,
        onChoose: () => undefined,
      },
    ],
  },
  {
    title: 'Screens and actions',
    items: [
      {
        id: 'g',
        label: 'Settings',
        hint: 'Audio, MIDI, network',
        icon: <Gear />,
        onChoose: () => undefined,
      },
    ],
  },
];

function Demo() {
  const [open, setOpen] = useState(true);
  return (
    <div className="h-screen bg-background p-6">
      <Button onClick={() => setOpen(true)}>Search ⌘K</Button>
      <CommandSearch open={open} onOpenChange={setOpen} groups={GROUPS} />
    </div>
  );
}

/** Open, with every group listed. */
export const Open: Story = { render: () => <Demo /> };
