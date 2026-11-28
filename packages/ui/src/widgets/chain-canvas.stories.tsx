import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, userEvent, within } from 'storybook/test';

import {
  branchBlock,
  type ChainGraph,
  insertBlock,
  moveBlock,
} from '../lib/chain-graph';
import { ChainCanvas } from './chain-canvas';

/**
 * The chain drawn as a map. Try: drag to pan, ⌘-scroll or pinch to zoom, click
 * a block to centre it, press the + on a connection, drag a block onto a
 * connection, and switch to the list view. View-only shows what a preset
 * whose routing cannot be edited looks like.
 */
const meta: Meta = {
  title: 'Widgets/Chain canvas',
  parameters: { layout: 'fullscreen' },
};
export default meta;
type Story = StoryObj;

const CHOICES = [
  { glyph: 'od' as const, name: 'Overdrive' },
  { glyph: 'comp' as const, name: 'Compressor' },
  { glyph: 'chorus' as const, name: 'Chorus' },
  { glyph: 'delay' as const, name: 'Delay' },
  { glyph: 'reverb' as const, name: 'Reverb' },
  { glyph: 'trem' as const, name: 'Tremolo' },
];

const SERIAL: ChainGraph = {
  nodes: [
    { id: 'in', kind: 'cap', name: 'IN', col: 0, row: 0 },
    { id: 'gate', kind: 'block', glyph: 'gate', name: 'Gate', col: 1, row: 0 },
    {
      id: 'amp',
      kind: 'block',
      glyph: 'amp',
      name: 'Fender Super Reverb 1977',
      col: 2,
      row: 0,
    },
    {
      id: 'delay',
      kind: 'block',
      glyph: 'delay',
      name: 'Delay',
      col: 3,
      row: 0,
    },
    {
      id: 'verb',
      kind: 'block',
      glyph: 'reverb',
      name: 'Reverb',
      col: 4,
      row: 0,
    },
    { id: 'out', kind: 'cap', name: 'OUT', col: 5, row: 0 },
  ],
  edges: [
    ['in', 'gate'],
    ['gate', 'amp'],
    ['amp', 'delay'],
    ['delay', 'verb'],
    ['verb', 'out'],
  ],
};

function Editable({ start }: { start: ChainGraph }) {
  const [graph, setGraph] = useState(start);
  const [selected, setSelected] = useState<string | null>(null);
  const id = () => `n${Date.now()}`;
  return (
    <div className="h-screen bg-background">
      <ChainCanvas
        graph={graph}
        selected={selected}
        onSelect={setSelected}
        choices={CHOICES}
        onInsert={(edge, c) => {
          const n = id();
          setGraph((g) => insertBlock(g, edge, c, n));
          setSelected(n);
        }}
        onBranch={(edge, c) => {
          const n = id();
          setGraph((g) => branchBlock(g, edge, c, n));
          setSelected(n);
        }}
        onMove={(block, edge) => setGraph((g) => moveBlock(g, block, edge))}
      />
    </div>
  );
}

/** A plain chain. It fits and stays still; edit it with the + and by dragging. */
export const Serial: Story = { render: () => <Editable start={SERIAL} /> };

/** A preset whose routing cannot be edited: drawn, selectable, no + and no drag. */
export const ViewOnly: Story = {
  render: () => (
    <div className="h-screen bg-background">
      <ChainCanvas
        graph={SERIAL}
        selected="amp"
        onSelect={() => undefined}
        readOnlyNote="This preset’s routing cannot be edited here."
      />
    </div>
  ),
};

/**
 * A TONE3000 block's free position: a small round + between blocks, as
 * Storybook draws every place to add. Never a card with a light, which would
 * read as a block called "Add".
 */
export const FreeSlot: Story = {
  render: function Render() {
    const [chosen, setChosen] = useState<string | null>(null);
    return (
      <div className="grid h-screen grid-rows-[minmax(0,1fr)_auto] bg-background">
        <ChainCanvas
          graph={{
            nodes: [
              { id: 'in', kind: 'cap', name: 'IN', col: 0, row: 0 },
              {
                id: 'amp',
                kind: 'block',
                glyph: 'amp',
                name: 'Mesa 90s Dual Rectifier',
                col: 1,
                row: 0,
              },
              {
                id: 'free',
                kind: 'slot',
                name: 'Add a block here',
                col: 2,
                row: 0,
              },
              {
                id: 'verb',
                kind: 'block',
                glyph: 'reverb',
                name: 'Hall reverb',
                col: 3,
                row: 0,
              },
              { id: 'out', kind: 'cap', name: 'OUT', col: 4, row: 0 },
            ],
            edges: [
              ['in', 'amp'],
              ['amp', 'free'],
              ['free', 'verb'],
              ['verb', 'out'],
            ],
          }}
          selected={null}
          onSelect={setChosen}
        />
        <p className="m-0 p-3 text-sm" role="status">
          {chosen === 'free' ? 'Choosing a block for the free position…' : ''}
        </p>
      </div>
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      canvas.getByRole('button', { name: 'Add a block here' }),
    );
    await expect(canvas.getByRole('status')).toHaveTextContent(
      'Choosing a block for the free position',
    );
  },
};
