import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { Caption } from '../components/ui/text';
import {
  BlockFullEditor,
  BlockQuickEditor,
  type BlockModel,
} from '../widgets/block-editor';
import { RouteView } from '../widgets/route-view';
import { PARALLEL_ROUTE, SCENES, SERIAL, SERIAL_ROUTE } from './rig.fixtures';
import { RigSurface, type RigRoute } from './rig-surface';
import { bigRig } from './big-rig.fixtures';
import { BLOCK_TYPES, MODELS } from './swap.fixtures';
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

function Rig({
  initial,
  swap = false,
  name = 'Rhythm section',
}: {
  initial: RigRoute;
  swap?: boolean;
  name?: string;
}) {
  const rig = useRigDemo(initial);
  return (
    <RigSurface
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
      scenes={SCENES}
      activeScene={rig.scene}
      onScene={rig.onScene}
      sceneChanged={rig.sceneChanged}
      levels={rig.levels}
      inputLevel={rig.input}
      onAudition={rig.onAudition}
      onAdd={rig.onAdd}
      models={swap ? MODELS : undefined}
      blockTypes={swap ? BLOCK_TYPES : undefined}
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
    const gain = within(sheet).getAllByRole('slider', { name: 'Gain' }).at(-1)!;
    gain.focus();
    await userEvent.keyboard('{ArrowRight}');
    await userEvent.keyboard('{Escape}');
  } else {
    const gain = canvas.getByRole('slider', { name: 'Plexi 50 Gain' });
    gain.focus();
    await userEvent.keyboard('{ArrowUp}');
  }
  const changes = await canvas.findByRole('button', { name: /1 change/ });
  await userEvent.click(canvas.getByRole('radio', { name: 'Saved' }));
  await expect(canvas.getByText('Hearing the saved version')).toBeVisible();
  await userEvent.click(canvas.getByRole('radio', { name: 'Edited' }));
  await userEvent.click(changes);
  await expect(await page.findByText(/Plexi 50 · Gain 6\.5 →/)).toBeVisible();
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
        canvas.getByRole('button', { name: `Change ${label}` }),
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
    sheet.getByRole('button', { name: 'Get and try High gain lead' }),
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
  await userEvent.click(sheet.getByRole('button', { name: 'Shimmer' }));
  await userEvent.click(sheet.getByRole('button', { name: 'Keep' }));
  await waitFor(() => expect(page.queryByRole('dialog')).toBeNull());
  await expect(
    canvas.getAllByRole('button', { name: /^Shimmer/ }).length,
  ).toBeGreaterThan(0);
};
