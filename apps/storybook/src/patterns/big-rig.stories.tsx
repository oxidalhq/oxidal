import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';
import { isSplit, updateBlock, type Step } from '../lib/route';
import { Card, CardHeader, CardTitle } from '../components/ui/card';
import { Segment, SegmentedControl } from '../components/ui/segmented';
import { Progress } from '../components/ui/states';
import { Caption, Eyebrow, Title } from '../components/ui/text';
import type { BlockModel } from '../widgets/block-editor';
import { RouteView } from '../widgets/route-view';
import { ScenePads } from '../widgets/scene-pad';
import {
  BRANCH_COUNTS,
  ESTIMATE,
  SHARED_ESTIMATE,
  SILENT,
  bigRig,
  branchesOf,
  scenesFor,
  type BigScene,
  type BranchCount,
} from './big-rig.fixtures';

/**
 * One preset with five, seven or ten complete amp sounds side by side, each
 * its own NAM capture and cab, some with pedals or a second split inside.
 * Scenes pick one amp or blend two, with their own reverb. Every branch
 * keeps running, so a scene change is a crossfade with no gap and no
 * loading, and delay and reverb trails carry on. Hardware modelers stop at
 * two or four amps per preset because of their DSP; the Pi 5 has room for
 * more, and the processing card says how much this rig uses.
 */
const meta: Meta = {
  title: 'Patterns/Rig surface/Many amps',
  parameters: { layout: 'fullscreen' },
};
export default meta;

type Policy = 'running' | 'pause';

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
  const [count, setCount] = useState<BranchCount>(initial);
  const [base, setBase] = useState(() => bigRig(initial));
  const scenes = scenesFor(count);
  const [sceneId, setSceneId] = useState(scenes[0]!.id);
  const [policy, setPolicy] = useState<Policy>('running');
  const [crossfade, setCrossfade] = useState('30');
  const scene = scenes.find((s) => s.id === sceneId) ?? scenes[0];
  const route = apply(base, scene);
  const branches = branchesOf(count);
  const audible = branches.filter(
    (_, i) => (scene?.amps[i] ?? SILENT) > SILENT,
  );
  const running = policy === 'running' ? branches : audible;
  const load =
    SHARED_ESTIMATE + running.reduce((sum, b) => sum + ESTIMATE[b.size], 0);
  const pct = Math.round(load * 100);

  const pick = (next: BranchCount) => {
    setCount(next);
    setBase(bigRig(next));
    setSceneId(scenesFor(next)[0]!.id);
  };

  return (
    <div className="grid gap-4 py-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <section className="grid min-w-0 content-start gap-3">
        <div className="flex flex-wrap items-end justify-between gap-3 px-page">
          <div className="grid gap-0.5">
            <Eyebrow>One preset · {count} amps</Eyebrow>
            <Title size="md">Stage rig, every sound loaded</Title>
            <Caption>
              Playing {scene?.name}: {audible.map((b) => b.name).join(' and ')}.
              Dashed branches are silent in this scene but keep running.
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
        <RouteView
          route={route}
          onChange={setBase}
          onSelect={() => {}}
          selected={null}
          label={`Signal route with ${count} amp branches`}
        />
        <div className="px-page">
          <ScenePads
            scenes={scenes.map((s, i) => ({ ...s, number: i + 1 }))}
            active={scene?.id ?? null}
            onSelect={setSceneId}
          />
        </div>
      </section>
      <Card className="mx-page h-fit lg:mx-0 lg:mr-page">
        <CardHeader>
          <CardTitle>Processing</CardTitle>
        </CardHeader>
        <div className="grid gap-1.5">
          <div className="flex items-baseline justify-between text-sm">
            <span>
              {running.length} of {count} amps running
            </span>
            <span className="font-mono tabular-nums">{pct}%</span>
          </div>
          <Progress
            value={Math.min(100, pct)}
            label="Share of each audio period"
          />
          <Caption className="text-xs">
            Estimate for this example. On the device, the health word at the top
            reports the measured load.
          </Caption>
        </div>
        <div className="grid gap-1.5">
          <span className="text-sm font-semibold">Silent branches</span>
          <SegmentedControl
            size="sm"
            value={policy}
            onValueChange={(v) => setPolicy(v as Policy)}
            aria-label="Silent branches"
            className="w-full"
          >
            <Segment value="running">Keep running</Segment>
            <Segment value="pause">Pause</Segment>
          </SegmentedControl>
          <Caption className="text-xs">
            {policy === 'running'
              ? 'Every scene change is instant: the amp is already warm. Uses the most processing.'
              : 'Saves processing, but a paused amp needs a moment to start, so switching to it is not gapless.'}
          </Caption>
        </div>
        <div className="grid gap-1.5">
          <span className="text-sm font-semibold">Scene crossfade</span>
          <SegmentedControl
            size="sm"
            value={crossfade}
            onValueChange={setCrossfade}
            aria-label="Scene crossfade"
            className="w-full"
          >
            <Segment value="0">Cut</Segment>
            <Segment value="30">30 ms</Segment>
            <Segment value="120">120 ms</Segment>
            <Segment value="500">Swell</Segment>
          </SegmentedControl>
        </div>
        <ul className="m-0 grid gap-1 border-t border-border pt-2 pl-4 text-sm">
          {branches.map((b, i) => (
            <li
              key={b.name}
              className={
                (scene?.amps[i] ?? SILENT) > SILENT
                  ? 'font-semibold'
                  : 'text-muted-foreground'
              }
            >
              {String.fromCharCode(65 + i)} · {b.name} · NAM {b.size}
            </li>
          ))}
        </ul>
      </Card>
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
  await expect(canvas.getByText(/10 of 10 amps running/)).toBeVisible();
  await userEvent.click(canvas.getByRole('button', { name: /^Scene 3/ }));
  await expect(canvas.getByText(/Playing Crunch: Crunch\./)).toBeVisible();
  await userEvent.click(canvas.getByRole('button', { name: /Heavy \+ bass/ }));
  await expect(canvas.getByText(/Heavy and Bass/)).toBeVisible();
  await userEvent.click(canvas.getByRole('radio', { name: 'Pause' }));
  await expect(canvas.getByText(/2 of 10 amps running/)).toBeVisible();
};
