import {
  ListNumbers,
  MusicNotes,
  Notebook,
  Notepad,
  Waveform,
} from '@phosphor-icons/react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, userEvent, within } from 'storybook/test';

import { Caption } from '../components/ui/text';
import { type DockLayout, layoutOf } from '../lib/dock-layout';
import { MiniPlayer } from '../widgets/mini-player';
import { DockSheet, type DockTool, DockZones } from './dock-zones';

/**
 * Tools kept beside the chain in three zones: left, right and bottom. Tools
 * show as tabs or split; drag a tab, or use its menu, to move it; fold a
 * zone to faint icons; float a tool on its own. A phone shows the same
 * tools as tabs in one bottom sheet, with the mini player above the tabs.
 */
const meta: Meta = {
  title: 'Patterns/Dock zones',
  parameters: { layout: 'fullscreen' },
};
export default meta;

const say = (text: string) => <Caption>{text}</Caption>;

const TOOLS: DockTool[] = [
  {
    id: 'player',
    title: 'Player',
    icon: <MusicNotes />,
    content: ({ wide }) =>
      say(
        wide
          ? 'The backing track, laid out across the bottom zone.'
          : 'The backing track.',
      ),
    running: 'Slow Burn is playing',
  },
  {
    id: 'stems',
    title: 'Stems',
    icon: <Waveform />,
    content: say('The stem mixer and a split in progress.'),
    running: 'Splitting Glass Room, 64%',
  },
  {
    id: 'sheet',
    title: 'Sheet',
    icon: <Notebook />,
    content: say('The linked chord sheet, to read or write.'),
  },
  {
    id: 'notes',
    title: 'Notes',
    icon: <Notepad />,
    content: say('Notes for the song and the preset.'),
  },
  {
    id: 'setlist',
    title: 'Set list',
    icon: <ListNumbers />,
    content: say('Tonight’s set list.'),
  },
];

function Dock({ initial }: { initial: DockLayout }) {
  const [layout, setLayout] = useState(initial);
  return (
    <div className="h-dvh bg-background text-foreground">
      <DockZones tools={TOOLS} layout={layout} onLayout={setLayout}>
        {({ bottom }) => (
          <>
            <main className="grid min-h-0 flex-1 place-items-center p-page">
              {say('The chain sits here.')}
            </main>
            {bottom}
          </>
        )}
      </DockZones>
    </div>
  );
}

const MULTI = layoutOf(
  { left: ['sheet', 'notes'], right: ['stems'], bottom: ['player'] },
  { left: { split: true } },
);

export const Zones: StoryObj = {
  name: 'Left, right and bottom',
  render: () => <Dock initial={MULTI} />,
};

export const Folded: StoryObj = {
  name: 'Folded to faint icons',
  render: () => (
    <Dock
      initial={layoutOf(
        { left: ['sheet', 'notes'], right: ['stems'], bottom: ['player'] },
        { left: { collapsed: true }, right: { collapsed: true } },
      )}
    />
  ),
};

export const Floating: StoryObj = {
  name: 'A tool floating on its own',
  render: () => (
    <Dock
      initial={layoutOf({ right: ['stems'] }, {}, [
        { id: 'notes', x: 360, y: 120 },
      ])}
    />
  ),
};

/** Move Notes to the bottom with its menu, the way a keyboard or a touch screen does. */
export const MoveByMenu: StoryObj = {
  name: 'Move a tool with its menu',
  render: () => <Dock initial={MULTI} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const body = within(canvasElement.ownerDocument.body);
    await userEvent.click(
      canvas.getByRole('button', { name: 'Notes: where to keep it' }),
    );
    await userEvent.click(
      await body.findByRole('menuitem', { name: /Dock bottom/ }),
    );
    const bottom = canvas.getByRole('region', { name: 'Bottom dock' });
    await expect(
      within(bottom).getByRole('tab', { name: /Notes/ }),
    ).toHaveAttribute('aria-selected', 'true');
  },
};

export const PhoneSheet: StoryObj = {
  name: 'Phone: one sheet with tabs and the mini player',
  globals: { viewport: { value: 'iphoneXr', isRotated: false } },
  render: function Render() {
    const [open, setOpen] = useState(false);
    const [active, setActive] = useState('player');
    return (
      <div className="flex h-dvh flex-col bg-background text-foreground">
        <main className="grid min-h-0 flex-1 place-items-center p-page">
          {say('The chain sits here.')}
        </main>
        <MiniPlayer
          title="Slow Burn"
          position="1:12"
          duration="3:42"
          progress={0.32}
          playing
          onPlay={() => undefined}
          onPause={() => undefined}
          onOpen={() => setOpen(true)}
          note="Splitting 64%"
        />
        <DockSheet
          title="Slow Burn"
          description="Rehearsal mix · 96 BPM · 6 stems"
          tools={TOOLS}
          open={open}
          onOpenChange={setOpen}
          active={active}
          onActive={setActive}
        />
      </div>
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const body = within(canvasElement.ownerDocument.body);
    await userEvent.click(canvas.getByRole('button', { name: /Slow Burn/ }));
    const sheet = within(
      await body.findByRole('dialog', { name: 'Slow Burn' }),
    );
    await userEvent.click(sheet.getByRole('tab', { name: 'Notes' }));
    await expect(
      sheet.getByText('Notes for the song and the preset.'),
    ).toBeVisible();
  },
};
