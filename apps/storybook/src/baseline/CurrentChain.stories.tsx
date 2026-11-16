import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import {
  Lightning,
  SpeakerHifi,
  Waveform,
  WaveSine,
} from '@phosphor-icons/react';
import { Caption } from '@/components/ui/text';
import { Chain } from '@/widgets/chain';
import { PARALLEL, SERIAL } from '@/patterns/rig.fixtures';
import { previewOf } from '@/lib/preview';
// The product's current chain view, drawn with its own CSS, for comparison.
import { ChainView } from '../../../web/src/ChainView';
import type { RigLaneVM } from '../../../web/src/rigChain';

/**
 * The chain as the product draws it today (`apps/web/src/ChainView.tsx`)
 * beside the new one, with the same rig. The owner judges D-4 here.
 */
const meta: Meta = {
  title: 'Baseline/Current chain view',
  parameters: { layout: 'padded' },
};
export default meta;

const FACES = {
  amp: <SpeakerHifi aria-hidden="true" />,
  cab: <Waveform aria-hidden="true" />,
  pedal: <Lightning aria-hidden="true" />,
  time: <WaveSine aria-hidden="true" />,
  mod: <WaveSine aria-hidden="true" />,
  lv2: <Lightning aria-hidden="true" />,
} as const;

function toCurrent(lanes: typeof SERIAL): RigLaneVM[] {
  return lanes.map((lane) => ({
    id: lane.id,
    input: 'in',
    name: lane.name,
    blocks: lane.blocks.map((block) => ({
      id: block.id,
      label: block.label,
      kind: block.kind,
      on: block.on,
      face: FACES[block.kind],
    })),
  }));
}

function SideBySide({
  lanes,
  parallel,
}: {
  lanes: typeof SERIAL;
  parallel?: boolean;
}) {
  const [selected, setSelected] = useState<string>(lanes[0]!.blocks[0]!.id);
  return (
    <div className="grid gap-8">
      <div className="grid gap-2">
        <Caption className="small-caps">Current (apps/web ChainView)</Caption>
        <ChainView
          lanes={toCurrent(lanes)}
          parallel={parallel}
          selected={selected}
          onSelect={setSelected}
          label="Signal chain"
        />
      </div>
      <div className="grid gap-2">
        <Caption className="small-caps">New (widgets/chain)</Caption>
        <Chain
          lanes={lanes.map((lane) => ({
            ...lane,
            blocks: lane.blocks.map((block) => ({
              ...block,
              preview: previewOf(block),
            })),
          }))}
          parallel={parallel}
          selected={selected}
          onSelect={setSelected}
        />
      </div>
    </div>
  );
}

export const Serial: StoryObj = { render: () => <SideBySide lanes={SERIAL} /> };
export const Parallel: StoryObj = {
  render: () => <SideBySide lanes={PARALLEL} parallel />,
};
