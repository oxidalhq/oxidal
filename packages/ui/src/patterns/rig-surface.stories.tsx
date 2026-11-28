import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, userEvent, waitFor, within } from 'storybook/test';

import { Caption } from '../components/ui/text';
import { Screen } from '../screens/shell';
import {
  BlockFullEditor,
  type BlockModel,
  BlockQuickEditor,
} from '../widgets/block-editor';
import { RouteView } from '../widgets/route-view';
import { FOUR_JOBS, FOUR_SCENES } from '../widgets/scene-editor.fixtures';
import { bigRig } from './big-rig.fixtures';
import { EFFECTS } from './block-chooser.data';
import { NamBlockToolsDemo } from './nam-block.demo';
import { PARALLEL_ROUTE, SCENES, SERIAL, SERIAL_ROUTE } from './rig.fixtures';
import { type RigRoute, RigSurface } from './rig-surface';
import { useModelDownloads } from './swap.demo';
import { BLOCK_TYPES, MODELS } from './swap.fixtures';
import { useRigDemo } from './use-rig.demo';

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

function Rig({
  initial,
  swap = false,
  name = 'Rhythm section',
  scenes = SCENES,
  meters = true,
}: {
  initial: RigRoute;
  swap?: boolean;
  name?: string;
  scenes?: typeof SCENES;
  meters?: boolean;
}) {
  const rig = useRigDemo(initial);
  const store = useModelDownloads(MODELS);
  return (
    <RigSurface
      chainView="map"
      className="h-dvh"
      blockTools={(b) => b.kind === 'amp' && <NamBlockToolsDemo />}
      presetName={name}
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
      scenes={scenes}
      activeScene={rig.scene}
      onScene={rig.onScene}
      sceneChanged={rig.sceneChanged}
      levels={meters ? rig.levels : undefined}
      inputLevel={meters ? rig.input : undefined}
      onAudition={rig.onAudition}
      onAdd={rig.onAdd}
      models={swap ? store.models : undefined}
      downloads={store.downloads}
      onGetModel={store.onGet}
      catalogue={swap ? store.catalogue : undefined}
      blockTypes={swap ? BLOCK_TYPES : undefined}
      effects={swap ? EFFECTS : undefined}
    />
  );
}

export const Serial: StoryObj<typeof Rig> = {
  args: {
    initial: SERIAL_ROUTE,
    name: 'Rhythm section',
    scenes: SCENES,
    meters: true,
  },
  render: ({ initial, name, scenes, meters }) => (
    <Rig
      key={JSON.stringify(initial)}
      initial={initial}
      name={name}
      scenes={scenes}
      meters={meters}
    />
  ),
};
/** Replay a device route in the approved screen shell for visual comparison. */
export const DeviceRoute: StoryObj<typeof Rig> = {
  args: {
    initial: SERIAL_ROUTE,
    name: 'Rhythm section',
    scenes: [],
    meters: false,
  },
  render: ({ initial, name, scenes, meters }) => (
    <Screen destination="rig" playing={name} status="detailed">
      <Rig
        key={JSON.stringify(initial)}
        initial={initial}
        name={name}
        scenes={scenes}
        meters={meters}
        swap
      />
    </Screen>
  ),
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

/**
 * The tweak-anywhere flow: change the amp's gain, hear the saved version,
 * see the change listed, and keep it as a new version. On a laptop the
 * gain is in the strip under the route; on a phone it is in the sheet.
 */
Serial.play = async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  const page = within(canvasElement.ownerDocument.body);
  const phone = canvasElement.ownerDocument.defaultView!.innerWidth < 768;
  if (phone) {
    await userEvent.click(canvas.getByRole('button', { name: /^Plexi 50/ }));
    const sheet = await page.findByRole('dialog');
    const gain = within(sheet)
      .getAllByRole('slider', { name: 'Input gain' })
      .at(-1)!;
    gain.focus();
    await userEvent.keyboard('{ArrowRight}');
    await userEvent.keyboard('{Escape}');
  } else {
    const gain = canvas.getByRole('slider', { name: 'Plexi 50 Input gain' });
    gain.focus();
    await userEvent.keyboard('{ArrowUp}');
  }
  const changes = await canvas.findByRole('button', { name: /1 change/ });
  await userEvent.click(canvas.getByRole('radio', { name: 'Saved' }));
  await expect(canvas.getByText('Hearing the saved version')).toBeVisible();
  await userEvent.click(canvas.getByRole('radio', { name: 'Edited' }));
  await userEvent.click(changes);
  await expect(await page.findByText(/Plexi 50 · Input gain/)).toBeVisible();
  await userEvent.keyboard('{Escape}');
  await userEvent.click(canvas.getByRole('button', { name: /Default/ }));
  await userEvent.click(
    await page.findByRole('button', { name: 'Save as a new version…' }),
  );
  await userEvent.click(
    await page.findByRole('button', { name: 'Friday gig' }),
  );
  await userEvent.click(page.getByRole('button', { name: 'Save version' }));
  await waitFor(() =>
    expect(canvas.getByRole('button', { name: /Friday gig/ })).toBeVisible(),
  );
  await expect(canvas.queryByRole('button', { name: /1 change/ })).toBeNull();
};

/**
 * Tone chasing on a big rig: seven amp branches, nested splits, a shared
 * delay and a reverb split. Select any block and press Change… to try
 * other models from the device or TONE3000, or turn it into another type
 * (a delay into a reverb). It plays at once; Back returns to what it was.
 */
export const ToneChasing: StoryObj = {
  name: 'Complex chain · tone chasing',
  render: () => <Rig initial={bigRig(7)} swap name="Stage rig" />,
};

ToneChasing.play = async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  const page = within(canvasElement.ownerDocument.body);
  const phone = canvasElement.ownerDocument.defaultView!.innerWidth < 768;
  const change = async (name: RegExp, label: string) => {
    await userEvent.click(canvas.getAllByRole('button', { name })[0]!);
    if (phone) {
      const sheet = await page.findByRole('dialog');
      await userEvent.click(
        within(sheet).getByRole('button', { name: /Change…/ }),
      );
    } else {
      await userEvent.click(
        canvas.getByRole('button', { name: `Change ${label}…` }),
      );
    }
    return within(await page.findByRole('dialog', { name: `Change ${label}` }));
  };

  // Swap the clean amp for another capture, fetch one from TONE3000, then go back.
  let sheet = await change(/^Twin clean/, 'Twin clean');
  await userEvent.click(
    sheet.getByRole('button', { name: 'Try AC30 top boost' }),
  );
  await expect(
    canvas.getAllByRole('button', {
      name: /^AC30 top boost/,
      hidden: true,
    }).length,
  ).toBeGreaterThan(1);
  await expect(
    sheet.getByText(/AC30 top boost plays 2\.5 dB quieter to match Twin clean/),
  ).toBeVisible();
  await userEvent.click(
    sheet.getByRole('button', { name: 'Try High gain lead' }),
  );
  await expect(
    await sheet.findByRole(
      'button',
      { name: 'AC30 top boost' },
      { timeout: 3000 },
    ),
  ).toBeVisible();
  await expect(
    sheet.getByRole('button', { name: 'High gain lead', pressed: true }),
  ).toBeVisible();
  await userEvent.click(
    sheet.getByRole('button', { name: /Back to Twin clean/ }),
  );
  await userEvent.click(sheet.getByRole('button', { name: 'Done' }));
  await waitFor(() => expect(page.queryByRole('dialog')).toBeNull());

  // Turn the delay into a shimmer reverb in the same place.
  sheet = await change(/^Echo/, 'Echo');
  await userEvent.click(sheet.getByRole('button', { name: /^Shimmer/ }));
  await userEvent.click(sheet.getByRole('button', { name: 'Keep' }));
  await waitFor(() => expect(page.queryByRole('dialog')).toBeNull());
  await expect(
    canvas.getAllByRole('button', { name: /^Shimmer/ }).length,
  ).toBeGreaterThan(0);
};

function ScenesRig() {
  const rig = useRigDemo(FOUR_JOBS);
  const [scene, setScene] = useState('verse');
  return (
    <RigSurface
      chainView="map"
      className="h-dvh"
      blockTools={(b) => b.kind === 'amp' && <NamBlockToolsDemo />}
      presetName="Worship rig"
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
      scenes={FOUR_SCENES.map((s, i) => ({ ...s, number: i + 1 }))}
      defaultSceneSettings={FOUR_SCENES}
      savedSceneSettings={FOUR_SCENES}
      activeScene={scene}
      onScene={setScene}
      levels={rig.levels}
      inputLevel={rig.input}
      models={MODELS}
      effects={EFFECTS}
    />
  );
}

/**
 * Two ways to edit a scene. Edit scenes… opens the grid: every block and
 * branch against every scene (here Lead is brought in under Chorus). Or
 * choose This scene and work in the chain: on or off and branch levels go
 * to the playing scene.
 */
export const EditingScenes: StoryObj = {
  name: 'Editing scenes',
  render: () => <ScenesRig />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const page = within(canvasElement.ownerDocument.body);
    // Where changes go shows on the chain bar once something has changed.
    await expect(
      canvas.queryByRole('button', { name: /^Changes: whole preset/ }),
    ).toBeNull();
    await userEvent.click(canvas.getByRole('button', { name: 'Edit scenes' }));
    const grid = within(
      await page.findByRole('dialog', { name: 'Edit scenes' }),
    );
    await userEvent.click(
      grid.getByRole('switch', { name: 'Lead branch in Chorus' }),
    );
    await userEvent.keyboard('{Escape}');
    await userEvent.click(
      await canvas.findByRole('button', { name: /^Changes: whole preset/ }),
    );
    await userEvent.click(
      await page.findByRole('button', { name: 'Edit scenes…' }),
    );
    const sheet = within(
      await page.findByRole('dialog', { name: 'Edit scenes' }),
    );
    const lead = sheet.getByRole('switch', { name: 'Lead branch in Chorus' });
    await expect(lead).toHaveAttribute('aria-checked', 'true');
    await userEvent.keyboard('{Escape}');

    // The same thing from the chain: This scene, then switch a block off.
    await userEvent.click(
      canvas.getByRole('button', { name: /^Changes: whole preset/ }),
    );
    await userEvent.click(
      await page.findByRole('radio', { name: 'This scene' }),
    );
    await expect(
      await canvas.findByRole('button', { name: /^Changes: Verse only/ }),
    ).toBeVisible();
  },
};

/**
 * Any block can be removed, the first one included, and moved to any line
 * or branch: from its ⋯ in Edit (or the docked panel), or by holding and
 * dragging it in Edit.
 */
export const MoveAndRemove: StoryObj = {
  name: 'Move a block between branches, remove the first',
  render: () => <ScenesRig />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const page = within(canvasElement.ownerDocument.body);
    await userEvent.click(canvas.getByRole('button', { name: 'Edit' }));
    await userEvent.click(
      canvas.getAllByRole('button', { name: /^Echo long/ })[0]!,
    );
    const toolbar = within(
      canvas.getByRole('toolbar', { name: 'Edit Echo long' }),
    );
    await userEvent.click(
      toolbar.getByRole('button', { name: 'More for Echo long' }),
    );
    await userEvent.click(
      await page.findByRole('menuitem', { name: 'Move to…' }),
    );
    const move = within(
      await page.findByRole('dialog', { name: 'Move Echo long' }),
    );
    await userEvent.click(move.getByRole('combobox', { name: 'Move to' }));
    await userEvent.click(
      await page.findByRole('option', { name: 'Branch Lead' }),
    );
    await userEvent.click(move.getByRole('button', { name: 'Move' }));
    await waitFor(() =>
      expect(page.queryByRole('dialog', { name: 'Move Echo long' })).toBeNull(),
    );

    await userEvent.click(canvas.getAllByRole('button', { name: /^Gate/ })[0]!);
    await userEvent.click(
      within(canvas.getByRole('toolbar', { name: 'Edit Gate' })).getByRole(
        'button',
        { name: 'Remove' },
      ),
    );
    await userEvent.click(
      within(
        await page.findByRole('dialog', { name: 'Remove Gate?' }),
      ).getByRole('button', { name: 'Remove' }),
    );
    await waitFor(() =>
      expect(canvas.queryByRole('button', { name: /^Gate/ })).toBeNull(),
    );
  },
};

/**
 * Tone chasing without leaving the rig: step to the next amp model in the
 * block panel (loudness matched), then one tap back to where it started.
 * On phones the same lives in the block's Change… sheet.
 */
export const StepThroughModels: StoryObj = {
  name: 'Step through amp models',
  render: () => <Rig initial={SERIAL_ROUTE} swap />,
  play: async ({ canvasElement }) => {
    if (canvasElement.ownerDocument.defaultView!.innerWidth < 768) return;
    const canvas = within(canvasElement);
    await userEvent.click(
      canvas.getAllByRole('button', { name: /^Plexi 50/ })[0]!,
    );
    const stepper = within(
      canvas.getByRole('group', { name: 'Try another amp model' }),
    );
    await userEvent.click(stepper.getByRole('button', { name: 'Next model' }));
    await expect(
      canvas.getByRole('heading', { name: 'JCM 800 crunch' }),
    ).toBeVisible();
    await userEvent.click(
      stepper.getByRole('button', { name: 'Back to Plexi 50' }),
    );
    await expect(
      canvas.getByRole('heading', { name: 'Plexi 50' }),
    ).toBeVisible();
  },
};

/** The block panel folds to one line, so the rig has the room while you scroll. */
export const MinimiseControls: StoryObj = {
  name: 'Minimise the block panel',
  render: () => <Rig initial={SERIAL_ROUTE} />,
  play: async ({ canvasElement }) => {
    if (canvasElement.ownerDocument.defaultView!.innerWidth < 768) return;
    const canvas = within(canvasElement);
    await userEvent.click(
      canvas.getByRole('button', { name: 'Minimise controls' }),
    );
    const show = await canvas.findByRole('button', { name: 'Show controls' });
    await expect(
      canvas.queryByRole('button', { name: /^All controls/ }),
    ).not.toBeInTheDocument();
    await userEvent.click(show);
    await expect(
      await canvas.findByRole('button', { name: 'Minimise controls' }),
    ).toBeVisible();
  },
};
