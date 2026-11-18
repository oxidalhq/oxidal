import { DotsThree, Play } from '@phosphor-icons/react';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { Badge, Led } from './badge';
import { Button } from './button';
import { Card, CardFooter, CardHeader, CardTitle } from './card';
import { List, ListRow } from './list-row';
import { Separator } from './separator';
import { Caption, Readout } from './text';
import { Tooltip, TooltipProvider } from './tooltip';

/**
 * Card: a panel on the page. List and ListRow: similar things in a column,
 * each a touch target. Separator: a rule between groups. Tooltip: the name
 * of an icon-only control.
 */
const meta: Meta = {
  title: 'Components/Card, list, separator, tooltip',
  parameters: { layout: 'padded' },
};
export default meta;

export const Cards: StoryObj = {
  render: () => (
    <div className="grid max-w-md gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Audio buffer</CardTitle>
          <Badge tone="live">Running</Badge>
        </CardHeader>
        <div className="flex items-baseline gap-4">
          <Readout size="lg">96 × 3</Readout>
          <Caption>6 ms · 0 xruns in 12 min</Caption>
        </div>
        <CardFooter>
          <Button variant="outline">Buffer finder…</Button>
          <Button variant="ghost">Audio setup</Button>
        </CardFooter>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Audio playback unavailable</CardTitle>
        </CardHeader>
        <p className="m-0 text-sm text-muted-foreground">
          This device cannot play audio right now. You can still browse and edit
          presets; check Audio setup if an interface should be connected.
        </p>
        <CardFooter>
          <Button>Browse presets</Button>
          <Button variant="outline">Audio setup</Button>
        </CardFooter>
      </Card>
    </div>
  ),
};

const TRACKS = [
  ['Iron Pulse', '3:42 · 6 stems', 'playing'],
  ['Slow Burn', '4:10 · 4 stems', 'cued'],
  ['Glass Room', '2:58', ''],
  ['Northern Lights (rehearsal mix, vocals off)', '5:21 · mix', ''],
] as const;

export const Lists: StoryObj = {
  render: () => (
    <TooltipProvider>
      <List className="max-w-xl">
        {TRACKS.map(([title, caption, state]) => (
          <ListRow
            key={title}
            title={title}
            caption={caption}
            selected={state === 'playing'}
            onClick={() => {}}
            leading={
              <Button
                size="icon-sm"
                variant="outline"
                aria-label={`Play ${title}`}
                onClick={(event) => event.stopPropagation()}
                className={state === 'playing' ? 'border-background' : ''}
              >
                <Play weight="fill" />
              </Button>
            }
            trailing={
              <>
                {state === 'playing' && <Badge tone="live">Playing</Badge>}
                {state === 'cued' && <Badge>Cued</Badge>}
                <Tooltip content="More actions">
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`More actions for ${title}`}
                    onClick={(event) => event.stopPropagation()}
                  >
                    <DotsThree weight="bold" />
                  </Button>
                </Tooltip>
              </>
            }
          />
        ))}
      </List>
    </TooltipProvider>
  ),
};

export const BlockRows: StoryObj = {
  name: 'List rows with LEDs',
  render: () => (
    <List className="max-w-md">
      <ListRow leading={<Led kind="pedal" />} title="TS9" caption="Drive" />
      <ListRow
        leading={<Led kind="amp" />}
        title="Plexi 50"
        caption="Amp · NAM"
        trailing={<Badge tone="warning">Unsaved</Badge>}
      />
      <ListRow
        leading={<Led kind="cab" />}
        title="4×12 Greenback"
        caption="Cabinet · IR"
      />
      <ListRow
        leading={<Led kind="time" on={false} />}
        title="Echo"
        caption="Delay · bypassed"
        trailing={<Badge>Off</Badge>}
      />
    </List>
  ),
};

export const Separators: StoryObj = {
  render: () => (
    <div className="grid max-w-md gap-4">
      <p className="m-0 text-sm">Above the rule</p>
      <Separator />
      <p className="m-0 text-sm">Below the rule</p>
      <Separator label="Media" />
      <p className="m-0 text-sm">
        A labelled rule names the group that follows.
      </p>
      <div className="flex h-8 items-center gap-3">
        <span className="text-sm">Left</span>
        <Separator orientation="vertical" />
        <span className="text-sm">Right</span>
      </div>
    </div>
  ),
};
