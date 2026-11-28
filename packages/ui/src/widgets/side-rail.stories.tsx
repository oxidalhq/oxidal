import { ListNumbers, MusicNotes } from '@phosphor-icons/react';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { SideRail } from './side-rail';

/**
 * A panel beside the main work. It starts as a thin strip with a short
 * status; open it to peek over the work, pin it to dock it, move it to the
 * other side, or minimise it again. This browser remembers the choice.
 */
const meta: Meta = {
  title: 'Widgets/Side rail',
  parameters: { layout: 'fullscreen' },
};
export default meta;
type Story = StoryObj;

const SONGS = [
  'Slow Burn',
  'Harbour Lights',
  'Iron Pulse',
  'Low Tide',
  'Afterglow',
];

function Frame({
  side,
  defaultMode,
}: {
  side: 'left' | 'right';
  defaultMode?: 'min' | 'pinned';
}) {
  return (
    <div className="flex h-screen bg-background text-foreground">
      <SideRail
        id={`story-${side}-${defaultMode ?? 'min'}`}
        title={side === 'left' ? 'Presets and set list' : 'Backing and stems'}
        icon={side === 'left' ? <ListNumbers /> : <MusicNotes />}
        status={side === 'left' ? '3/5' : '1:12'}
        side={side}
        defaultMode={defaultMode}
      >
        <ul className="m-0 grid list-none gap-1 p-3">
          {SONGS.map((s, i) => (
            <li
              key={s}
              className="rounded-md px-2 py-1.5 text-sm hover:bg-accent"
            >
              <span className="mr-2 font-mono text-xs text-muted-foreground">
                {i + 1}
              </span>
              {s}
            </li>
          ))}
        </ul>
      </SideRail>
      <main className="flex-1 p-6 text-sm text-muted-foreground">
        The main work. Open the strip to peek, pin to dock, or move the panel to
        the other side.
      </main>
    </div>
  );
}

/** Minimised on the left with its status; open it to peek over the work. */
export const Minimised: Story = { render: () => <Frame side="left" /> };

/** Pinned open: it pushes the work over instead of covering it. */
export const Pinned: Story = {
  render: () => <Frame side="left" defaultMode="pinned" />,
};

/** The same panel on the right. */
export const OnTheRight: Story = { render: () => <Frame side="right" /> };
