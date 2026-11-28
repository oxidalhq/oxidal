import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, userEvent, within } from 'storybook/test';

import { Segment, SegmentedControl } from '../components/ui/segmented';
import { Caption, Eyebrow, Title } from '../components/ui/text';
import { glyphForBlock } from '../lib/block-glyphs';
import { useChainCanvasControl } from '../lib/chain-canvas-control';
import {
  blocksOf,
  isSplit,
  type Split,
  type Step,
  updateBlock,
} from '../lib/route';
import { routeGraph } from '../lib/route-graph';
import { sceneColour } from '../lib/scene-colours';
import { useVerticalRig } from '../lib/use-media';
import type { BlockModel } from '../widgets/block-editor';
import { ChainCanvas } from '../widgets/chain-canvas';
import { PanZoom } from '../widgets/pan-zoom';
import { RouteView } from '../widgets/route-view';
import { ScenePads } from '../widgets/scene-pad';
import {
  type BigScene,
  type Branch,
  BRANCH_COUNTS,
  type BranchCount,
  branchesOf,
  branchFor,
  type CaptureSize,
  ESTIMATE,
  LIMIT,
  rigOf,
  scenesFor,
  SHARED_ESTIMATE,
  SILENT,
} from './big-rig.fixtures';
import { ChainWorkspace } from './chain-workspace';
import { type BranchPolicy, ProcessingCard } from './processing-card';
import { MODELS } from './swap.fixtures';

const SIZES: CaptureSize[] = ['Standard', 'Lite', 'Feather', 'Nano'];
const CANDIDATES = MODELS.filter((m) => m.kind === 'amp').map((m) => ({
  model: m,
  size: SIZES.find((size) => m.caption.includes(size)) ?? 'Standard',
}));
const loadOf = (list: Branch[]) =>
  list.reduce((sum, b) => sum + ESTIMATE[b.size], 0);

/**
 * One preset with five, seven or ten complete amp sounds side by side, each
 * its own NAM capture and cab, some with pedals or a second split inside.
 * Scenes pick one amp or blend two, with their own reverb. Amps not in the
 * playing scene sleep (H-11): they use no processing, and because an amp
 * whose input faded to silence is already warm, it wakes with no gap. Only
 * the busiest scene change counts against the processing limit. Hardware modelers stop at
 * two or four amps per preset because of their DSP; the Pi 5 has room for
 * more, and the processing card says how much this rig uses.
 */
const meta: Meta = {
  title: 'Patterns/Rig surface/Many amps',
  parameters: { layout: 'fullscreen' },
};
export default meta;

type Policy = BranchPolicy;

function apply(route: Step<BlockModel>[], scene: BigScene | undefined) {
  if (!scene) return route;
  let next = route;
  for (const [id, on] of Object.entries(scene.on ?? {}))
    next = updateBlock(next, id, (b) => ({ ...b, on }));
  return next.map((step) =>
    !isSplit(step)
      ? step
      : step.id === 'amps'
        ? {
            ...step,
            levels: step.branches.map((_, i) => scene.amps[i] ?? SILENT),
          }
        : step.id === 'space'
          ? { ...step, levels: [...scene.space] }
          : step,
  );
}

function ManyAmps({ initial }: { initial: BranchCount }) {
  const [branches, setBranches] = useState(() => branchesOf(initial));
  const [base, setBase] = useState(() => rigOf(branchesOf(initial)));
  const count = branches.length;
  const scenes = scenesFor(count);
  const [sceneId, setSceneId] = useState(scenes[0]!.id);
  const [policy, setPolicy] = useState<Policy>('sleep');
  const [added, setAdded] = useState<string | null>(null);
  const canvas = useChainCanvasControl();
  const [view, setView] = useState<'map' | 'tree'>('map');
  const vertical = useVerticalRig();
  const [selected, setSelected] = useState<string | null>(null);
  const scene = scenes.find((s) => s.id === sceneId) ?? scenes[0];
  const route = apply(base, scene);
  const audibleIn = (sc: BigScene | undefined) =>
    branches.filter((_, i) => (sc?.amps[i] ?? SILENT) > SILENT);
  const audible = audibleIn(scene);
  const running = policy === 'running' ? branches : audible;
  const load = SHARED_ESTIMATE + loadOf(running);
  // What the rig can need at once: every branch when they keep running.
  // Asleep, it is the busiest change: during a change the scene you leave
  // drains while the next one plays, so both count. A new amp must fit on
  // top of that.
  const changes = scenes.flatMap((from) =>
    scenes
      .filter((to) => to.id !== from.id)
      .map((to) => {
        const both = branches.filter(
          (b) => audibleIn(from).includes(b) || audibleIn(to).includes(b),
        );
        return { from, to, both, load: loadOf(both) };
      }),
  );
  const worst = changes.reduce<(typeof changes)[number] | undefined>(
    (a, c) => (!a || c.load > a.load ? c : a),
    undefined,
  );
  const busiest = worst?.load ?? 0;
  const committed =
    SHARED_ESTIMATE + (policy === 'running' ? loadOf(branches) : busiest);

  const pick = (next: BranchCount) => {
    setBranches(branchesOf(next));
    setBase(rigOf(branchesOf(next)));
    setSceneId(scenesFor(next)[0]!.id);
    setAdded(null);
  };
  const add = (candidate: (typeof CANDIDATES)[number]) => {
    const next = [
      ...branches,
      branchFor(candidate.model, candidate.size, branches.length + 1),
    ];
    setBranches(next);
    setBase(rigOf(next));
    setAdded(candidate.model.label);
  };

  // Blocks on an amp branch that this scene leaves silent: asleep, or idle.
  const amps = route.find(
    (s): s is Split<BlockModel> => isSplit(s) && s.id === 'amps',
  );
  const silent = new Set(
    (amps?.branches ?? []).flatMap((branch, i) =>
      (amps?.levels?.[i] ?? 0) <= SILENT
        ? blocksOf(branch).map((b) => b.id)
        : [],
    ),
  );
  const mapped = routeGraph(route, glyphForBlock);
  const all = blocksOf(route);
  const picked = all.find((b) => b.id === selected);

  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      <div className="flex flex-wrap items-end justify-between gap-3 px-page py-3">
        <div className="grid gap-0.5">
          <Eyebrow>One preset · {count} amps</Eyebrow>
          <Title size="md">Stage rig, every sound loaded</Title>
          <Caption>
            Playing {scene?.name}: {audible.map((b) => b.name).join(' and ')}.{' '}
            {policy === 'sleep'
              ? 'Blocks marked Asleep use no processing and wake with no gap when a scene needs them.'
              : 'Blocks marked Silent are not heard in this scene but keep running.'}
          </Caption>
        </div>
        <SegmentedControl
          size="sm"
          value={String(count)}
          onValueChange={(v) => pick(Number(v) as BranchCount)}
          aria-label="Amp branches in this example"
        >
          {BRANCH_COUNTS.map((n) => (
            <Segment key={n} value={String(n)}>
              {n} amps
            </Segment>
          ))}
        </SegmentedControl>
      </div>
      <ChainWorkspace
        canvas={canvas}
        chainView={view}
        onChainView={setView}
        selected={picked ? { name: picked.label, on: picked.on } : null}
        panelLabel="Scenes and processing"
        chain={
          view === 'map' ? (
            <ChainCanvas
              toolbar="none"
              control={canvas}
              graph={mapped.graph}
              selected={selected}
              onSelect={setSelected}
              laneLabel={(lane) => mapped.lanes[lane] ?? `Path ${lane + 1}`}
              card={(id) => {
                const b = all.find((x) => x.id === id);
                if (!b) return undefined;
                const quiet = silent.has(id)
                  ? policy === 'sleep'
                    ? 'Asleep · '
                    : 'Silent · '
                  : '';
                return {
                  caption: `${quiet}${b.caption ?? b.kind}`,
                  kind: b.kind,
                  on: b.on,
                };
              }}
            />
          ) : (
            // The tree pans, zooms and centres like the map.
            <PanZoom
              control={canvas}
              selected={selected}
              still={vertical}
              className={vertical ? 'h-full overflow-auto py-2' : undefined}
            >
              <RouteView
                route={route}
                onChange={setBase}
                onSelect={setSelected}
                selected={selected}
                sceneColour={sceneColour(scenes.indexOf(scene!))}
                label={`Signal route with ${count} amp branches`}
              />
            </PanZoom>
          )
        }
      >
        <div className="grid items-start gap-4 px-page py-3 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <ScenePads
            scenes={scenes.map((s, i) => ({ ...s, number: i + 1 }))}
            active={scene?.id ?? null}
            onSelect={setSceneId}
          />
          <ProcessingCard
            className="h-fit"
            amps={branches.map((b, i) => ({
              name: b.name,
              size: b.size,
              playing: (scene?.amps[i] ?? SILENT) > SILENT,
            }))}
            policy={policy}
            onPolicy={setPolicy}
            load={load}
            committed={committed}
            limit={LIMIT}
            busiest={
              worst && {
                from: worst.from.name,
                to: worst.to.name,
                amps: worst.both.length,
              }
            }
            freedBySleep={loadOf(branches) - busiest}
            candidates={CANDIDATES.map((c) => ({
              id: c.model.id,
              label: c.model.label,
              size: c.size,
              cost: ESTIMATE[c.size],
            }))}
            onAdd={(c) => {
              const found = CANDIDATES.find((x) => x.model.id === c.id);
              if (found) add(found);
            }}
            added={added ?? undefined}
          />
        </div>
      </ChainWorkspace>
    </div>
  );
}

export const FiveAmps: StoryObj = {
  name: 'Five amps',
  render: () => <ManyAmps initial={5} />,
};

export const SevenAmps: StoryObj = {
  name: 'Seven amps',
  render: () => <ManyAmps initial={7} />,
};

export const TenAmps: StoryObj = {
  name: 'Ten amps, blends and nested splits',
  render: () => <ManyAmps initial={10} />,
};

/** Switch scenes: Crunch silences Clean; Heavy + bass blends two branches. */
TenAmps.play = async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  const page = within(canvasElement.ownerDocument.body);
  await expect(canvas.getByText(/1 playing · 9 asleep/)).toBeVisible();
  await userEvent.click(canvas.getByRole('button', { name: /^Scene 3/ }));
  await expect(canvas.getByText(/Playing Crunch: Crunch\./)).toBeVisible();
  await userEvent.click(canvas.getByRole('button', { name: /Heavy \+ bass/ }));
  await expect(canvas.getByText(/Heavy and Bass/)).toBeVisible();
  // The Tree view draws the route: phones fold the eight silent branches
  // into one row; laptops offer to.
  await userEvent.click(canvas.getByRole('button', { name: 'Tree' }));
  const phone = canvasElement.ownerDocument.defaultView!.innerWidth < 768;
  const fold = canvas.getByRole('button', {
    name: phone ? /Show 8 silent: Clean, Chime/ : /Fold 8 silent branches/,
  });
  await expect(fold).toHaveAttribute('aria-expanded', phone ? 'false' : 'true');
  await userEvent.click(fold);
  await expect(
    canvas.getByRole('button', {
      name: phone ? /Fold 8 silent branches/ : /Show 8 silent/,
    }),
  ).toHaveAttribute('aria-expanded', phone ? 'true' : 'false');
  // Kept running, ten amps leave room for a Feather capture only, until
  // silent branches sleep again.
  await userEvent.click(canvas.getByRole('radio', { name: 'Keep running' }));
  await expect(canvas.getByText(/10 of 10 amps running/)).toBeVisible();
  await userEvent.click(canvas.getByRole('button', { name: /Add an amp/ }));
  const popover = within(
    await page.findByRole('dialog', { name: 'Add an amp' }),
  );
  await expect(
    popover.queryByRole('button', { name: 'Add Plexi 50' }),
  ).toBeNull();
  await expect(
    popover.queryByRole('button', { name: 'Add JCM 800 crunch' }),
  ).toBeNull();
  await userEvent.click(
    popover.getByRole('button', { name: 'Add Deluxe reverb' }),
  );
  await expect(canvas.getByText(/Added Deluxe reverb/)).toBeVisible();
  // The popover stays open: nothing else fits now, so it offers to make room.
  await userEvent.click(
    popover.getByRole('button', { name: 'Sleep silent branches' }),
  );
  await expect(canvas.getByText(/2 playing · 9 asleep/)).toBeVisible();
};
