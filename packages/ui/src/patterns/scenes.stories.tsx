import type { Meta, StoryObj } from '@storybook/react-vite';
import { useMemo, useState } from 'react';
import { expect, userEvent, within } from 'storybook/test';

import { Card, CardHeader, CardTitle } from '../components/ui/card';
import { Caption, Eyebrow, Title } from '../components/ui/text';
import { blocksOf, isSplit, type Step, updateBlock } from '../lib/route';
import { sceneColour } from '../lib/scene-colours';
import type { BlockModel } from '../widgets/block-editor';
import { RouteView } from '../widgets/route-view';
import { SceneManager } from '../widgets/scene-manager';
import { type SceneModel, THREE_SCENES, THREE_SOUNDS } from './scenes.fixtures';

/**
 * What a scene is, and how to make one. A scene belongs to one preset: one
 * rig. It does not combine separate presets — but one rig can carry several
 * complete chains side by side, and a scene picks which you hear and which
 * blocks are on. That is why a scene change has no gap and trails carry on,
 * while a preset change loads a different rig.
 */
const meta: Meta = {
  title: 'Patterns/Scenes',
  parameters: { layout: 'fullscreen' },
};
export default meta;

function apply(
  route: Step<BlockModel>[],
  scene: SceneModel | undefined,
): Step<BlockModel>[] {
  if (!scene) return route;
  let next = route;
  for (const [id, on] of Object.entries(scene.on))
    next = updateBlock(next, id, (b) => ({ ...b, on }));
  const withLevels = (steps: Step<BlockModel>[]): Step<BlockModel>[] =>
    steps.map((s) =>
      isSplit(s)
        ? {
            ...s,
            levels: scene.levels[s.id] ?? s.levels,
            branches: s.branches.map(withLevels),
          }
        : s,
    );
  return withLevels(next);
}

function ScenesDemo({ empty = false }: { empty?: boolean }) {
  const [scenes, setScenes] = useState<SceneModel[]>(empty ? [] : THREE_SCENES);
  const [active, setActive] = useState<string | null>(empty ? null : 'clean');
  const [saved, setSaved] = useState<Record<string, SceneModel>>(
    Object.fromEntries(THREE_SCENES.map((s) => [s.id, s])),
  );
  const scene = scenes.find((s) => s.id === active);
  const route = useMemo(() => apply(THREE_SOUNDS, scene), [scene]);
  const update = (id: string, change: (s: SceneModel) => SceneModel) =>
    setScenes((all) => all.map((s) => (s.id === id ? change(s) : s)));
  const capture = (): SceneModel => {
    const on = Object.fromEntries(blocksOf(route).map((b) => [b.id, b.on]));
    const split = route.find(isSplit);
    return {
      id: `scene-${Date.now()}`,
      name: '',
      on,
      levels: split ? { [split.id]: split.levels ?? [] } : {},
    };
  };
  return (
    <div className="grid gap-4 py-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <section className="grid min-w-0 content-start gap-3">
        <div className="grid gap-0.5 px-page">
          <Eyebrow>One preset · one rig</Eyebrow>
          <Title size="md">Three sounds in one preset</Title>
          <Caption>
            {scene
              ? `Scene ${scene.name}: dimmed branches are silent in this scene.`
              : 'No scenes yet: everything you hear is the preset itself.'}{' '}
            In this example, tap a block to turn it on or off in the playing
            scene.
          </Caption>
        </div>
        <RouteView
          route={route}
          sceneColour={scene ? sceneColour(scenes.indexOf(scene)) : undefined}
          onChange={() => {}}
          onSelect={(id) => {
            if (!scene) return;
            const block = blocksOf(route).find((b) => b.id === id);
            if (block)
              update(scene.id, (s) => ({
                ...s,
                edited: true,
                on: { ...s.on, [id]: !block.on },
              }));
          }}
          selected={null}
        />
        <div className="px-page">
          <SceneManager
            scenes={scenes}
            active={active}
            onSelect={setActive}
            onAdd={(name, from) => {
              const base =
                from === 'current'
                  ? capture()
                  : { ...scenes.find((s) => s.id === from)! };
              const created = {
                ...base,
                id: `scene-${Date.now()}`,
                name,
                edited: false,
              };
              setScenes((all) => [...all, created]);
              setSaved((all) => ({ ...all, [created.id]: created }));
              setActive(created.id);
            }}
            onRename={(id, name) => update(id, (s) => ({ ...s, name }))}
            onDuplicate={(id) => {
              const source = scenes.find((s) => s.id === id)!;
              const copy = {
                ...source,
                id: `scene-${Date.now()}`,
                name: `${source.name} copy`,
                edited: false,
              };
              setScenes((all) => [
                ...all.slice(0, all.indexOf(source) + 1),
                copy,
                ...all.slice(all.indexOf(source) + 1),
              ]);
              setSaved((all) => ({ ...all, [copy.id]: copy }));
            }}
            onUpdate={(id) => {
              const kept = {
                ...scenes.find((s) => s.id === id)!,
                edited: false,
              };
              update(id, () => kept);
              setSaved((all) => ({ ...all, [id]: kept }));
            }}
            onRevert={(id) =>
              update(id, (s) => ({ ...(saved[id] ?? s), edited: false }))
            }
            onDelete={(id) => {
              setScenes((all) => all.filter((s) => s.id !== id));
              if (active === id)
                setActive(scenes.find((s) => s.id !== id)?.id ?? null);
            }}
            onMove={(id, by) =>
              setScenes((all) => {
                const at = all.findIndex((s) => s.id === id);
                const next = [...all];
                const [moved] = next.splice(at, 1);
                next.splice(at + by, 0, moved!);
                return next;
              })
            }
          />
        </div>
      </section>
      <Card className="mx-page h-fit lg:mx-0 lg:mr-page">
        <CardHeader>
          <CardTitle>Scene, preset, version</CardTitle>
        </CardHeader>
        <dl className="m-0 grid gap-3 text-sm">
          <div>
            <dt className="font-semibold">Scene</dt>
            <dd className="m-0 text-muted-foreground">
              A sound inside one preset: which blocks and branches are on, their
              levels and values. Switches with no gap; delay and reverb trails
              carry on. Use for verse, chorus, solo.
            </dd>
          </div>
          <div>
            <dt className="font-semibold">Preset</dt>
            <dd className="m-0 text-muted-foreground">
              A whole rig. Switching presets loads a different rig; prepare the
              next one in the set list so it switches cleanly. Use for different
              songs.
            </dd>
          </div>
          <div>
            <dt className="font-semibold">Version</dt>
            <dd className="m-0 text-muted-foreground">
              The same preset tuned for a place: Default, Friday gig, Small
              room. Its scenes come with it.
            </dd>
          </div>
        </dl>
        <Caption className="text-xs">
          Quad Cortex and Helix call these scenes and snapshots; Kemper's
          performance slots are closer to presets.
        </Caption>
      </Card>
    </div>
  );
}

export const WhatASceneIs: StoryObj = {
  name: 'What a scene is (one rig, three sounds)',
  render: () => <ScenesDemo />,
};

export const NoScenesYet: StoryObj = {
  name: 'No scenes yet',
  render: () => <ScenesDemo empty />,
};

/** Make a scene from what you hear, change it, keep the change, then delete it. */
WhatASceneIs.play = async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  const page = within(canvasElement.ownerDocument.body);
  await userEvent.click(canvas.getByRole('button', { name: /^Scene 3 Lead/ }));
  await expect(canvasElement.querySelectorAll('[data-silent]')).toHaveLength(2);
  await userEvent.click(canvas.getByRole('button', { name: /^Bloom/ }));
  await expect(
    await canvas.findByText(/has changes you have not kept/),
  ).toBeVisible();
  await userEvent.click(canvas.getByRole('button', { name: 'Update scene' }));
  await expect(canvas.queryByText(/has changes you have not kept/)).toBeNull();
  await userEvent.click(canvas.getByRole('button', { name: 'Scene' }));
  const add = await page.findByRole('dialog', { name: 'Add a scene' });
  await userEvent.click(within(add).getByRole('button', { name: 'Add scene' }));
  await expect(
    await canvas.findByRole('button', { name: /^Scene 5 Solo/ }),
  ).toHaveAttribute('aria-pressed', 'true');
  await userEvent.click(canvas.getByRole('button', { name: 'More for Solo' }));
  await userEvent.click(await page.findByRole('menuitem', { name: 'Delete…' }));
  await userEvent.click(await page.findByRole('button', { name: 'Delete' }));
  await expect(canvas.queryByRole('button', { name: /Solo/ })).toBeNull();
};
