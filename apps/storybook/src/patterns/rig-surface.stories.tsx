import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Caption } from '../components/ui/text';
import {
  BlockFullEditor,
  BlockQuickEditor,
  type BlockModel,
} from '../widgets/block-editor';
import { RouteView } from '../widgets/route-view';
import { PARALLEL_ROUTE, SCENES, SERIAL, SERIAL_ROUTE } from './rig.fixtures';
import { RigSurface, type RigRoute } from './rig-surface';
import { useRigDemo } from './use-rig-demo';

/**
 * The rig: shape a sound. Try: hold a block to hear the rig without it;
 * drag a delay's repeats or an amp's tone points; change something and
 * flip Edited / Saved; open the change list; press Edit, then hold a block
 * and drop it on "Parallel" beside another; tap a Split for branch levels;
 * switch the viewport to iPhone 16 for the top-to-bottom route.
 */
const meta: Meta = {
  title: 'Patterns/Rig surface',
  parameters: { layout: 'fullscreen' },
};
export default meta;

function Rig({ initial }: { initial: RigRoute }) {
  const rig = useRigDemo(initial);
  return (
    <RigSurface
      presetName="Rhythm section"
      playing
      route={rig.route}
      saved={rig.saved}
      onRoute={rig.onRoute}
      versions={rig.versions}
      currentVersion={rig.current}
      onVersion={rig.onVersion}
      onSaveVersion={rig.onSaveVersion}
      onSaveVersionAs={rig.onSaveVersionAs}
      onMakeDefault={rig.onMakeDefault}
      scenes={SCENES}
      activeScene={rig.scene}
      onScene={rig.onScene}
      sceneChanged={rig.sceneChanged}
      levels={rig.levels}
      inputLevel={rig.input}
      onAudition={rig.onAudition}
      onAdd={rig.onAdd}
    />
  );
}

export const Serial: StoryObj = {
  render: () => <Rig initial={SERIAL_ROUTE} />,
};
export const SplitAndJoin: StoryObj = {
  name: 'Split, join, split again (QC style)',
  render: () => <Rig initial={PARALLEL_ROUTE} />,
};

const LEVELS = {
  gate: -24,
  ts9: -18,
  'amp-a': -9,
  'cab-a': -14,
  'amp-b': -8,
  'cab-b': -13,
  echo: -12,
  bloom: -15,
};

function Vertical({ editing = false }: { editing?: boolean }) {
  const [route, setRoute] = useState<RigRoute>(
    editing ? SERIAL_ROUTE : PARALLEL_ROUTE,
  );
  const [selected, setSelected] = useState<string | null>('amp-a');
  return (
    <div className="mx-auto grid max-w-[393px] gap-2 border-x border-border">
      <RouteView
        route={route}
        onChange={setRoute}
        selected={selected}
        onSelect={setSelected}
        orientation="vertical"
        editing={editing}
        onAdd={editing ? () => {} : undefined}
        levels={editing ? undefined : LEVELS}
        inputLevel={editing ? undefined : -26}
      />
      {editing && (
        <Caption className="px-page">
          Hold a block, then drop it in a gap or on “Parallel” beside another
          block.
        </Caption>
      )}
    </div>
  );
}

export const PhoneRoute: StoryObj = {
  name: 'Route on a phone (top to bottom)',
  render: () => <Vertical />,
};
export const PhoneRouteEditing: StoryObj = {
  name: 'Route on a phone, editing',
  render: () => <Vertical editing />,
};

function setControl(
  block: BlockModel,
  control: string,
  value: number,
): BlockModel {
  return {
    ...block,
    controls: block.controls.map((c) =>
      c.id === control ? { ...c, value } : c,
    ),
  };
}

function Editors() {
  const [blocks, setBlocks] = useState(SERIAL[0]!.blocks);
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
              setBlocks((all) =>
                all.map((b) =>
                  b.id === block.id ? setControl(b, control, value) : b,
                ),
              )
            }
            onToggle={(on) =>
              setBlocks((all) =>
                all.map((b) => (b.id === block.id ? { ...b, on } : b)),
              )
            }
            onAll={() => {}}
          />
        </div>
      ))}
    </div>
  );
}

export const QuickEditors: StoryObj = {
  name: 'Quick editor, every kind (drag the drawings)',
  parameters: { layout: 'padded' },
  render: () => <Editors />,
};

function PhoneEditor() {
  const [block, setBlock] = useState(
    SERIAL[0]!.blocks.find((b) => b.id === 'echo')!,
  );
  return (
    <div className="mx-auto grid max-w-[393px] gap-3 rounded-t-lg border border-border bg-raised p-4 shadow-raised">
      <BlockQuickEditor
        layout="sheet"
        block={block}
        onControl={(control, value) =>
          setBlock((b) => setControl(b, control, value))
        }
        onToggle={(on) => setBlock((b) => ({ ...b, on }))}
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

function Full() {
  const [block, setBlock] = useState(
    SERIAL[0]!.blocks.find((b) => b.id === 'echo')!,
  );
  return (
    <div className="max-w-md">
      <BlockFullEditor
        block={block}
        onControl={(control, value) =>
          setBlock((b) => setControl(b, control, value))
        }
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
