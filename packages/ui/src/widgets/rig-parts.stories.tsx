import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';
import { sceneColour } from '../lib/scene-colours';
import { Button } from '../components/ui/button';
import { StableLabel } from '../components/ui/stable-label';
import { ChainBlock, ChainPort, type ChainBlockModel } from './chain';
import { ScenePads } from './scene-pad';

/**
 * The small parts the rig is built from, on their own: the chain block in
 * every state, ports, scene pads with their colours, and the label that
 * keeps its width. Every state keeps the same size, so switching a block,
 * a scene or a label never moves anything around it.
 */
const meta: Meta = {
  title: 'Widgets/Rig parts',
  parameters: { layout: 'padded' },
};
export default meta;

const TS9: ChainBlockModel = {
  id: 'ts9',
  label: 'TS9 tight',
  kind: 'pedal',
  caption: 'Drive · low gain',
  on: true,
  preview: '4.0 · 6.0',
};

const STATES: { name: string; block: ChainBlockModel; props?: object }[] = [
  { name: 'On', block: TS9 },
  { name: 'Off', block: { ...TS9, on: false } },
  { name: 'Unsaved', block: { ...TS9, unsaved: true } },
  { name: 'Selected', block: TS9, props: { selected: true } },
  {
    name: 'Selected and off',
    block: { ...TS9, on: false },
    props: { selected: true },
  },
  {
    name: 'Changed by this scene',
    block: TS9,
    props: { sceneMark: true },
  },
  {
    name: 'In the playing scene',
    block: TS9,
    props: { tint: sceneColour(1) },
  },
  { name: 'Disabled', block: TS9, props: { disabled: true } },
];

/** Every state of one block, side by side: all the same size. */
export const ChainBlockStates: StoryObj = {
  name: 'Chain block, every state',
  render: () => (
    <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(12rem,1fr))] gap-x-4 gap-y-6 p-0 pt-2">
      {STATES.map((s) => (
        <li key={s.name} className="grid justify-items-start gap-1.5">
          <span className="small-caps text-xs text-muted-foreground">
            {s.name}
          </span>
          <ChainBlock block={s.block} onSelect={() => {}} {...s.props} />
        </li>
      ))}
      <li className="grid justify-items-start gap-1.5">
        <span className="small-caps text-xs text-muted-foreground">Ports</span>
        <span className="flex gap-2">
          <ChainPort label="In" />
          <ChainPort label="Out" />
        </span>
      </li>
    </ul>
  ),
  play: async ({ canvasElement }) => {
    const blocks = [
      ...canvasElement.querySelectorAll<HTMLElement>('[data-slot=chain-block]'),
    ];
    const sizes = new Set(
      blocks.map((b) => {
        const r = b.getBoundingClientRect();
        return `${Math.round(r.width)}×${Math.round(r.height)}`;
      }),
    );
    await expect([...sizes]).toHaveLength(1);
  },
};

function Switching() {
  const [on, setOn] = useState(true);
  const [unsaved, setUnsaved] = useState(false);
  const [selected, setSelected] = useState(false);
  const [mark, setMark] = useState(false);
  return (
    <div className="grid justify-items-start gap-3">
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => setOn(!on)}>
          Switch on or off
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setUnsaved(!unsaved)}
        >
          Unsaved or saved
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setSelected(!selected)}
        >
          Select
        </Button>
        <Button size="sm" variant="outline" onClick={() => setMark(!mark)}>
          Scene mark
        </Button>
      </div>
      <ChainBlock
        block={{ ...TS9, on, unsaved }}
        selected={selected}
        sceneMark={mark}
        onSelect={() => setSelected(!selected)}
      />
    </div>
  );
}

/** Switch a block through its states: its size never changes. */
export const SteadySize: StoryObj = {
  name: 'Chain block keeps its size',
  render: () => <Switching />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const block = canvasElement.querySelector<HTMLElement>(
      '[data-slot=chain-block]',
    )!;
    const size = () => {
      const r = block.getBoundingClientRect();
      return [Math.round(r.width), Math.round(r.height)];
    };
    const start = size();
    for (const name of [
      'Switch on or off',
      'Unsaved or saved',
      'Select',
      'Scene mark',
      'Switch on or off',
    ]) {
      await userEvent.click(canvas.getByRole('button', { name }));
      await expect(size()).toEqual(start);
    }
  },
};

function Labels() {
  const [on, setOn] = useState(true);
  return (
    <div className="grid justify-items-start gap-2">
      <span className="flex items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => setOn(!on)}>
          <StableLabel
            value={on ? 'Bypass' : 'Bypassed'}
            options={['Bypass', 'Bypassed']}
          />
        </Button>
        <span data-slot="neighbour" className="text-sm">
          Next to it
        </span>
      </span>
    </div>
  );
}

/** A label that changes wording keeps the width of its longest wording. */
export const SteadyLabel: StoryObj = {
  name: 'Stable label',
  render: () => <Labels />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const neighbour = canvasElement.querySelector('[data-slot=neighbour]')!;
    const x = neighbour.getBoundingClientRect().left;
    await userEvent.click(canvas.getByRole('button', { name: 'Bypass' }));
    await expect(
      canvas.getByRole('button', { name: 'Bypassed' }),
    ).toBeVisible();
    await expect(neighbour.getBoundingClientRect().left).toBe(x);
  },
};

/** Each scene gets a colour in order; the chain uses the playing scene's. */
export const SceneColours: StoryObj = {
  name: 'Scene colours',
  render: () => (
    <ScenePads
      scenes={['Verse', 'Chorus', 'Lead', 'Swells', 'Bridge', 'Outro'].map(
        (name, i) => ({
          id: name,
          name,
          number: i + 1,
          colour: sceneColour(i),
        }),
      )}
      active="Chorus"
      onSelect={() => {}}
    />
  ),
};
