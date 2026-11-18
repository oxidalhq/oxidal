import {
  ArrowsDownUp,
  Copy,
  DotsThree,
  DownloadSimple,
  Faders,
  ListPlus,
  PencilSimple,
  Plus,
  Trash,
} from '@phosphor-icons/react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, userEvent, within } from 'storybook/test';

import { Badge } from './badge';
import { Button } from './button';
import { useConfirm } from './confirm';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTrigger,
} from './dialog';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from './popover';
import { Segment, SegmentedControl } from './segmented';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTrigger,
} from './sheet';
import { Caption, Label, Readout } from './text';

/**
 * The container ladder, one rung each: popover, dropdown menu, dialog,
 * confirm, sheet. Open each on the phone viewport too.
 */
const meta: Meta = {
  title: 'Components/Popover, menu, dialog, sheet',
  parameters: { layout: 'padded' },
};
export default meta;

export const PopoverAddBlock: StoryObj = {
  name: 'Popover: add a block',
  render: () => (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="icon" aria-label="Add block here">
          <Plus />
        </Button>
      </PopoverTrigger>
      <PopoverContent>
        <div className="grid gap-3">
          <Label htmlFor="block-search">Add a block</Label>
          <input
            id="block-search"
            className="min-h-touch rounded-lg border border-input bg-background px-3 text-sm"
            placeholder="Search effects…"
          />
          <div className="grid gap-1">
            {['TS9 Drive', 'Bloom Reverb', 'Echo Delay', 'Motion Chorus'].map(
              (name) => (
                <Button key={name} variant="ghost" className="justify-start">
                  {name}
                </Button>
              ),
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  ),
};

export const PopoverSort: StoryObj = {
  name: 'Popover: sort',
  render: () => (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline">
          <ArrowsDownUp /> Sort
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto">
        <SegmentedControl defaultValue="recent" aria-label="Sort by">
          <Segment value="recent">Recent</Segment>
          <Segment value="name">Name</Segment>
          <Segment value="length">Length</Segment>
        </SegmentedControl>
      </PopoverContent>
    </Popover>
  ),
};

export const Menu: StoryObj = {
  name: 'Dropdown menu: row actions',
  render: () => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon" aria-label="More actions">
          <DotsThree weight="bold" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuLabel>Iron Pulse</DropdownMenuLabel>
        <DropdownMenuItem>
          <PencilSimple /> Rename
        </DropdownMenuItem>
        <DropdownMenuItem>
          <Copy /> Duplicate
        </DropdownMenuItem>
        <DropdownMenuItem>
          <ListPlus /> Add to set list
        </DropdownMenuItem>
        <DropdownMenuItem>
          <DownloadSimple /> Download
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuCheckboxItem checked>
          Show artwork
        </DropdownMenuCheckboxItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem destructive>
          <Trash /> Delete…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  ),
};

export const DialogBuffer: StoryObj = {
  name: 'Dialog: a decision',
  render: () => (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline">Change buffer…</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader
          title="Change the audio buffer"
          description="Audio stops for about a second while the stream restarts."
        />
        <DialogBody>
          <div className="grid gap-1">
            <Label>Frames × periods</Label>
            <SegmentedControl defaultValue="96x3" aria-label="Buffer">
              <Segment value="48x2">48 × 2</Segment>
              <Segment value="96x3">96 × 3</Segment>
              <Segment value="128x3">128 × 3</Segment>
            </SegmentedControl>
            <Caption>
              96 × 3 is 6 ms. Smaller buffers may crackle on heavy presets.
            </Caption>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline">Cancel</Button>
          <Button>Apply</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ),
};

function ConfirmDemo() {
  const { ask, dialog } = useConfirm();
  const [result, setResult] = useState('');
  return (
    <div className="grid gap-3">
      <div className="flex gap-2">
        <Button
          variant="destructive"
          onClick={async () =>
            setResult(
              (await ask({
                title: 'Delete “Iron Pulse”?',
                body: 'Its stems and saved mixes are deleted with it. This cannot be undone.',
                confirm: 'Delete',
                destructive: true,
              }))
                ? 'Deleted'
                : 'Kept',
            )
          }
        >
          <Trash /> Delete…
        </Button>
        <Button
          variant="outline"
          onClick={async () =>
            setResult(
              (await ask({
                title: 'Play “Slow Burn”?',
                body: '“Iron Pulse” is playing. It stops and this mix starts.',
                confirm: 'Stop and play',
              }))
                ? 'Playing Slow Burn'
                : 'Still playing Iron Pulse',
            )
          }
        >
          Play Slow Burn
        </Button>
      </div>
      {result && <Caption>{result}</Caption>}
      {dialog}
    </div>
  );
}

export const Confirm: StoryObj = {
  name: 'Confirm: two answers',
  render: () => <ConfirmDemo />,
};

function SheetDemo({ side }: { side: 'auto' | 'bottom' | 'right' }) {
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="outline">
          <Faders /> Edit block ({side})
        </Button>
      </SheetTrigger>
      <SheetContent side={side} onOpenChange={setOpen}>
        <SheetHeader title="Plexi 50" description="Amp · NAM">
          <div className="mt-1 flex gap-1">
            <Badge tone="warning">Unsaved</Badge>
            <Badge>Scene 2</Badge>
          </div>
        </SheetHeader>
        <SheetBody>
          {['Gain', 'Bass', 'Mid', 'Treble', 'Presence', 'Level'].map(
            (name, index) => (
              <div key={name} className="grid gap-1">
                <div className="flex items-baseline justify-between">
                  <Label>{name}</Label>
                  <Readout size="sm">{(4 + index * 0.7).toFixed(1)}</Readout>
                </div>
                <div className="h-1.5 rounded-full bg-wire/40">
                  <div
                    className="h-1.5 rounded-full bg-foreground"
                    style={{ width: `${40 + index * 8}%` }}
                  />
                </div>
              </div>
            ),
          )}
        </SheetBody>
        <SheetFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Revert
          </Button>
          <Button onClick={() => setOpen(false)}>Save</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

export const Sheets: StoryObj = {
  name: 'Sheet: edit with context',
  render: () => (
    <div className="flex flex-wrap gap-2">
      <SheetDemo side="auto" />
      <SheetDemo side="bottom" />
      <SheetDemo side="right" />
    </div>
  ),
};

// Interaction tests: these run in Storybook's Interactions panel and in `pnpm test:stories`.
Confirm.play = async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  const page = within(canvasElement.ownerDocument.body);
  await userEvent.click(canvas.getByRole('button', { name: /Delete…/ }));
  const dialog = await page.findByRole('dialog', {
    name: 'Delete “Iron Pulse”?',
  });
  await expect(
    within(dialog).getByRole('button', { name: 'Cancel' }),
  ).toHaveFocus();
  await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
  await expect(await canvas.findByText('Deleted')).toBeVisible();
};

Menu.play = async ({ canvasElement }) => {
  const page = within(canvasElement.ownerDocument.body);
  await userEvent.click(
    within(canvasElement).getByRole('button', { name: 'More actions' }),
  );
  const items = await page.findAllByRole('menuitem');
  await expect(items.map((i) => i.textContent?.trim())).toEqual([
    'Rename',
    'Duplicate',
    'Add to set list',
    'Download',
    'Delete…',
  ]);
  await userEvent.keyboard('{Escape}');
};
