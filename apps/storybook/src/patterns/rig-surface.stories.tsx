import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Caption } from '@/components/ui/text';
import {
  BlockQuickEditor,
  BlockFullEditor,
  type BlockModel,
} from '@/widgets/block-editor';
import { Chain } from '@/widgets/chain';
import { NEW_BLOCK, PARALLEL, SCENES, SERIAL } from './rig.fixtures';
import { previewOf } from '@/lib/preview';
import { RigSurface, type RigLane } from './rig-surface';

/**
 * The rig view per D-4: one drawing for playing and editing, serial and
 * parallel, with the block editor anchored to the chain. Compare with
 * Baseline › Current chain view.
 */
const meta: Meta = {
  title: 'Patterns/Rig surface',
  parameters: { layout: 'fullscreen' },
};
export default meta;

function moveBlock(lanes: RigLane[], id: string, lane: number, index: number) {
  const next = lanes.map((l) => ({ ...l, blocks: [...l.blocks] }));
  const from = next.findIndex((l) => l.blocks.some((b) => b.id === id));
  if (from < 0) return lanes;
  const at = next[from]!.blocks.findIndex((b) => b.id === id);
  const [block] = next[from]!.blocks.splice(at, 1);
  const target = from === lane && at < index ? index - 1 : index;
  next[lane]?.blocks.splice(target, 0, block!);
  return next;
}

function useRig(initial: RigLane[]) {
  const [lanes, setLanes] = useState(initial);
  const [unsaved, setUnsaved] = useState(true);
  const update = (id: string, change: (block: BlockModel) => BlockModel) =>
    setLanes((all) =>
      all.map((l) => ({
        ...l,
        blocks: l.blocks.map((b) => (b.id === id ? change(b) : b)),
      })),
    );
  return {
    lanes,
    unsaved,
    setUnsaved,
    onControl: (id: string, control: string, value: number) => {
      update(id, (b) => ({
        ...b,
        unsaved: true,
        controls: b.controls.map((c) =>
          c.id === control ? { ...c, value } : c,
        ),
      }));
      setUnsaved(true);
    },
    onToggleBlock: (id: string, on: boolean) =>
      update(id, (b) => ({ ...b, on })),
    onSource: (id: string, value: string | null) =>
      update(id, (b) => {
        const option = b.source?.options.find((o) => o.value === value);
        return b.source && option
          ? {
              ...b,
              label: option.label,
              source: { ...b.source, value: option.value },
            }
          : b;
      }),
    onAdd: (lane: number, index: number) =>
      setLanes((all) =>
        all.map((l, i) =>
          i === lane
            ? {
                ...l,
                blocks: [
                  ...l.blocks.slice(0, index),
                  NEW_BLOCK(),
                  ...l.blocks.slice(index),
                ],
              }
            : l,
        ),
      ),
    onMove: (id: string, lane: number, index: number) =>
      setLanes((all) => moveBlock(all, id, lane, index)),
  };
}

function Rig({
  initial,
  parallel,
  playing,
}: {
  initial: RigLane[];
  parallel?: boolean;
  playing?: boolean;
}) {
  const rig = useRig(initial);
  const [scene, setScene] = useState<string | null>('b');
  return (
    <RigSurface
      presetName="Rhythm section"
      playing={playing}
      unsaved={rig.unsaved}
      lanes={rig.lanes}
      parallel={parallel}
      scenes={SCENES}
      activeScene={scene}
      onControl={rig.onControl}
      onToggleBlock={rig.onToggleBlock}
      onSource={rig.onSource}
      onAdd={rig.onAdd}
      onMove={rig.onMove}
      onScene={setScene}
      onSave={() => rig.setUnsaved(false)}
      onRevert={() => rig.setUnsaved(false)}
    />
  );
}

export const Serial: StoryObj = {
  render: () => <Rig initial={SERIAL} playing />,
};
export const Parallel: StoryObj = {
  render: () => <Rig initial={PARALLEL} parallel playing />,
};
export const Editing: StoryObj = {
  render: () => (
    <div className="grid gap-4">
      <Rig initial={SERIAL} />
      <Caption className="px-page">
        Press Edit: a + appears in every gap (a popover with the catalogue in
        the product), and a long press lifts a block to drag it; Shift+arrows
        move the focused block.
      </Caption>
    </div>
  ),
};

function Editors() {
  const rig = useRig(SERIAL);
  const blocks = rig.lanes[0]!.blocks;
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      {blocks.map((block) => (
        <div
          key={block.id}
          className="rounded-lg border border-border bg-raised p-3 shadow-raised"
        >
          <BlockQuickEditor
            block={block}
            onControl={(control, value) =>
              rig.onControl(block.id, control, value)
            }
            onToggle={(on) => rig.onToggleBlock(block.id, on)}
            onSource={(value) => rig.onSource(block.id, value)}
            onAll={() => {}}
          />
        </div>
      ))}
    </div>
  );
}

export const QuickEditors: StoryObj = {
  name: 'Quick editor, every kind',
  parameters: { layout: 'padded' },
  render: () => <Editors />,
};

function Full() {
  const rig = useRig(SERIAL);
  const block = rig.lanes[0]!.blocks.find((b) => b.id === 'echo')!;
  return (
    <div className="max-w-md">
      <BlockFullEditor
        block={block}
        onControl={(control, value) => rig.onControl(block.id, control, value)}
        onReset={() => {}}
      />
    </div>
  );
}

export const FullEditor: StoryObj = {
  name: 'Full editor (delay)',
  parameters: { layout: 'padded' },
  render: () => <Full />,
};

const withPreview = (lanes: RigLane[]) =>
  lanes.map((l) => ({
    ...l,
    blocks: l.blocks.map((b) => ({ ...b, preview: previewOf(b) })),
  }));

export const ChainAlone: StoryObj = {
  name: 'Chain in every state',
  parameters: { layout: 'padded' },
  render: () => (
    <div className="grid max-w-4xl gap-6">
      <Chain lanes={withPreview(SERIAL)} selected="amp" onSelect={() => {}} />
      <Chain
        lanes={withPreview(SERIAL)}
        selected="echo"
        onSelect={() => {}}
        size="lg"
      />
      <Chain
        lanes={withPreview(PARALLEL)}
        parallel
        selected="amp-b"
        onSelect={() => {}}
      />
      <Chain
        lanes={[{ id: 'empty', blocks: [] }]}
        selected={null}
        onSelect={() => {}}
        editing
        onAdd={() => {}}
      />
      <Chain
        lanes={withPreview(SERIAL)}
        selected="amp"
        onSelect={() => {}}
        disabled
      />
    </div>
  ),
};

function PhoneEditor() {
  const rig = useRig(SERIAL);
  const block = rig.lanes[0]!.blocks.find((b) => b.id === 'echo')!;
  return (
    <div className="mx-auto grid max-w-[393px] gap-3 rounded-t-lg border border-border bg-raised p-4 shadow-raised">
      <BlockQuickEditor
        layout="sheet"
        block={block}
        onControl={(control, value) => rig.onControl(block.id, control, value)}
        onToggle={(on) => rig.onToggleBlock(block.id, on)}
        onAll={() => {}}
      />
      <Caption>
        On phones the quick editor sits in a bottom sheet with full-width
        sliders, so a thumb sets the delay without the keyboard covering the
        screen.
      </Caption>
    </div>
  );
}

export const QuickEditorPhone: StoryObj = {
  name: 'Quick editor on a phone (sheet)',
  parameters: { layout: 'padded' },
  render: () => <PhoneEditor />,
};
