import { useState } from 'react';
import { Plus } from '@phosphor-icons/react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';
import { isSplit, updateBlock, type Step } from '../lib/route';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardHeader, CardTitle } from '../components/ui/card';
import { List, ListRow } from '../components/ui/list-row';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '../components/ui/popover';
import { Segment, SegmentedControl } from '../components/ui/segmented';
import { Progress } from '../components/ui/states';
import { Caption, Eyebrow, Title } from '../components/ui/text';
import type { BlockModel } from '../widgets/block-editor';
import { RouteView } from '../widgets/route-view';
import { ScenePads } from '../widgets/scene-pad';
import {
  BRANCH_COUNTS,
  ESTIMATE,
  LIMIT,
  SHARED_ESTIMATE,
  SILENT,
  branchFor,
  branchesOf,
  rigOf,
  scenesFor,
  type BigScene,
  type Branch,
  type BranchCount,
  type CaptureSize,
} from './big-rig.fixtures';
import { MODELS } from './swap.fixtures';

const SIZES: CaptureSize[] = ['Standard', 'Lite', 'Feather', 'Nano'];
const CANDIDATES = MODELS.filter((m) => m.kind === 'amp').map((m) => ({
  model: m,
  size: SIZES.find((size) => m.caption.includes(size)) ?? 'Standard',
}));
const percent = (share: number) => `${Math.round(share * 100)}%`;
const loadOf = (list: Branch[]) =>
  list.reduce((sum, b) => sum + ESTIMATE[b.size], 0);

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
  const [branches, setBranches] = useState(() => branchesOf(initial));
  const [base, setBase] = useState(() => rigOf(branchesOf(initial)));
  const count = branches.length;
  const scenes = scenesFor(count);
  const [sceneId, setSceneId] = useState(scenes[0]!.id);
  const [policy, setPolicy] = useState<Policy>('running');
  const [crossfade, setCrossfade] = useState('30');
  const [added, setAdded] = useState<string | null>(null);
  const scene = scenes.find((s) => s.id === sceneId) ?? scenes[0];
  const route = apply(base, scene);
  const audibleIn = (sc: BigScene | undefined) =>
    branches.filter((_, i) => (sc?.amps[i] ?? SILENT) > SILENT);
  const audible = audibleIn(scene);
  const running = policy === 'running' ? branches : audible;
  const load = SHARED_ESTIMATE + loadOf(running);
  const pct = Math.round(load * 100);
  // What the rig can need at once: every branch when they keep running,
  // otherwise the busiest scene. A new amp must fit on top of that.
  const busiest = Math.max(0, ...scenes.map((sc) => loadOf(audibleIn(sc))));
  const committed =
    SHARED_ESTIMATE + (policy === 'running' ? loadOf(branches) : busiest);
  const fits = (size: CaptureSize) => committed + ESTIMATE[size] <= LIMIT;

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
          <Popover>
            <PopoverTrigger asChild>
              <Button
                size="sm"
                variant="outline"
                className="justify-self-start"
              >
                <Plus /> Add an amp…
              </Button>
            </PopoverTrigger>
            <PopoverContent aria-label="Add an amp" className="grid w-80 gap-2">
              <span className="text-sm font-semibold">Add an amp branch</span>
              <Caption className="text-xs">
                {percent(Math.max(0, LIMIT - committed))} is free. The device
                keeps {percent(1 - LIMIT)} of each audio period spare so a busy
                moment never drops out.
              </Caption>
              <List>
                {CANDIDATES.map((c) => (
                  <ListRow
                    key={c.model.id}
                    title={c.model.label}
                    caption={`NAM ${c.size} · needs ${percent(ESTIMATE[c.size])}`}
                    trailing={
                      fits(c.size) ? (
                        <Button
                          size="sm"
                          variant="outline"
                          aria-label={`Add ${c.model.label}`}
                          onClick={() => add(c)}
                        >
                          Add
                        </Button>
                      ) : (
                        <Badge tone="warning" size="sm">
                          No room
                        </Badge>
                      )
                    }
                  />
                ))}
              </List>
              {CANDIDATES.some((c) => !fits(c.size)) && (
                <div className="grid gap-2 border-t border-border pt-2">
                  <Caption className="text-xs">
                    To make room, choose a lighter capture size
                    {policy === 'running'
                      ? `, or pause silent branches: then only the busiest scene counts and ${percent(loadOf(branches) - busiest)} is freed.`
                      : ', or take an amp out of the busiest scene.'}
                  </Caption>
                  {policy === 'running' && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="justify-self-start"
                      onClick={() => setPolicy('pause')}
                    >
                      Pause silent branches
                    </Button>
                  )}
                </div>
              )}
            </PopoverContent>
          </Popover>
          {added && (
            <Caption className="text-xs">
              Added {added}. It stays silent until a scene plays it.
            </Caption>
          )}
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
  const page = within(canvasElement.ownerDocument.body);
  await expect(canvas.getByText(/10 of 10 amps running/)).toBeVisible();
  await userEvent.click(canvas.getByRole('button', { name: /^Scene 3/ }));
  await expect(canvas.getByText(/Playing Crunch: Crunch\./)).toBeVisible();
  await userEvent.click(canvas.getByRole('button', { name: /Heavy \+ bass/ }));
  await expect(canvas.getByText(/Heavy and Bass/)).toBeVisible();
  // Phones fold the eight silent branches into one row; laptops offer to.
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
  // Ten amps leave room for a Feather capture only, until silent branches pause.
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
    popover.getByRole('button', { name: 'Pause silent branches' }),
  );
  await expect(canvas.getByText(/2 of 11 amps running/)).toBeVisible();
};
