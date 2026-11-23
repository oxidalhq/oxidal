import { Trash } from '@phosphor-icons/react';
import { useState } from 'react';

import { Button } from '@oxidal/design-system/components/button';
import { ActionRow } from '@oxidal/design-system/components/form-layout';
import { Caption } from '@oxidal/design-system/components/text';

import { AdjustmentDialog } from '../../AdjustmentDialog';
import { LedToggle } from '../../ChainView';
import type { IdStep } from '../../rigChain';
import {
  MAX_PATHS,
  routeAddBranch,
  routeAddPath,
  routeCopyBranch,
  routeDuplicate,
  routeRemove,
  routeRemoveBranch,
} from '../../rigRoute';
import { rigBusy } from './mixedRigViewModel';
import { PathLevel } from './PathLevel';
import type { RigViewProps } from './useMixedRigSession';

/** Why the routing actions are unavailable for this block, or null. */
const SCENE_PATH =
  'Each scene is one path. Add or remove scenes with the scene pads.';
const SCENE_TONE =
  'A scene’s tone starts its path. Split here on an effect after it.';
const PATH_LIMIT = `${MAX_PATHS} paths is the engine limit.`;
const NOT_EDITABLE = 'This preset’s routing cannot be edited here.';
const SERIAL = 'Split here to make this block one of two paths.';

/** Blocks on the path that holds `id`, nested splits included. */
function pathBlocks(route: IdStep[] | null, id: string): number | null {
  const count = (steps: IdStep[]): number =>
    steps.reduce(
      (n, s) =>
        n +
        (typeof s === 'string'
          ? 1
          : s.branches.reduce((m, b) => m + count(b), 0)),
      0,
    );
  const contains = (steps: IdStep[]): boolean =>
    steps.some(
      (s) =>
        s === id ||
        (typeof s !== 'string' && s.branches.some((b) => contains(b))),
    );
  const look = (steps: IdStep[]): number | null => {
    for (const s of steps) {
      if (typeof s === 'string') continue;
      for (const b of s.branches) {
        if (!contains(b)) continue;
        return look(b) ?? count(b);
      }
    }
    return null;
  };
  return route ? look(route) : null;
}

/**
 * Selected block panel: a header (name, type, On), an Arrange row, a Routing
 * row that exists for every block, then the block's controls (rendered by the
 * caller). One `busy` value disables every action while a change is in flight.
 * @see docs/interface.md
 */
export function SelectedBlockPanel({ rig, vm }: RigViewProps) {
  const {
    command,
    editChain,
    setCanvasChoice,
    setPathSides,
    shift,
    shiftPath,
  } = rig;
  const {
    editable,
    fullRoute,
    inLane,
    place,
    running,
    sceneCanvas,
    selected,
    selectedBranch,
    selectedInScene,
    selectedSpot,
    selectedView,
    state,
  } = vm;
  const [removing, setRemoving] = useState<{
    path: number;
    effects: number;
  } | null>(null);
  /** Remove asks first: one tap on a phone or E-paper never loses a block. */
  const [removingBlock, setRemovingBlock] = useState(false);
  if (
    !running ||
    !selectedView ||
    !(selectedView.branch || selectedView.bypass)
  )
    return null;
  const busy = rigBusy(vm, rig);
  const id = selected!.id;
  const label = selectedView.label;
  /** The split nearest the block, and whether it is the scene lanes. */
  const owner = selectedSpot?.owners.at(-1);
  const sceneOwner = !!owner && owner.split === sceneCanvas?.split;
  const sceneTone = selectedInScene && sceneOwner && selectedSpot!.index === 0;
  const movable =
    editable && !sceneTone && ['lv2', 'tone3000'].includes(selected!.kind);
  const kind = selectedView.branch
    ? 'Path'
    : selected!.kind === 'lv2'
      ? 'LV2'
      : selected!.kind === 'tone3000'
        ? 'TONE3000'
        : 'Mix';
  const routable = editable && !sceneTone;
  const inSplit = editable && !!owner && !sceneOwner;
  const full = inSplit && owner!.paths >= MAX_PATHS;
  const routeWhy = !editable
    ? NOT_EDITABLE
    : sceneTone
      ? SCENE_TONE
      : sceneOwner
        ? SCENE_PATH
        : !inSplit
          ? SERIAL
          : full
            ? PATH_LIMIT
            : '';
  const sides =
    inLane && inSplit && selectedBranch.paths > 0
      ? ['left', 'right'].map((side) =>
          state.control?.controls.find(
            (c) =>
              c.target.kind === 'merge' &&
              c.target.node === `${selectedBranch.merge}-${side}` &&
              c.target.port === selectedBranch.port,
          ),
        )
      : [];
  const effects = pathBlocks(fullRoute, id) ?? 1;
  const why = 'selected-block-why';
  return (
    <div
      className="grid gap-3 border-t border-foreground py-3"
      aria-label="Selected block"
    >
      {(selected?.kind !== 'lv2' || selectedView.branch) && (
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 [&>button]:justify-self-end">
          <h3
            className="selected-block-title col-span-full m-0 min-w-0 truncate leading-tight"
            title={label}
          >
            {label}
          </h3>
          <span className="text-sm text-muted-foreground">{kind}</span>
          {selectedView.branch ? (
            <LedToggle
              on={selectedView.branch.enabled}
              kind={selectedView.block.kind}
              state={selectedView.branch.partial ? 'Mixed' : undefined}
              label={`Toggle path ${selectedView.branch.name}`}
              disabled={busy}
              onToggle={() =>
                void command({
                  kind: 'branch',
                  command: {
                    session: state.control!.session,
                    expected_revision: state.control!.revision,
                    branch: selectedView.branch!.id,
                    enabled: !selectedView.branch!.enabled,
                  },
                })
              }
            />
          ) : (
            <LedToggle
              on={selectedView.bypass!.value !== 1}
              kind={selectedView.block.kind}
              label={`${label} on`}
              disabled={busy}
              onToggle={() =>
                void command({
                  kind: 'control',
                  command: {
                    session: state.control!.session,
                    expected_revision: state.control!.revision,
                    target: selectedView.bypass!.target,
                    value: selectedView.bypass!.value === 1 ? 0 : 1,
                  },
                })
              }
            />
          )}
        </div>
      )}
      {movable && (
        <ActionRow role="group" aria-label="Arrange">
          <Button
            variant="outline"
            aria-label={`Move ${label} left`}
            disabled={busy || place.first}
            onClick={() => void shift(id, -1)}
          >
            ◀ Move
          </Button>
          <Button
            variant="outline"
            aria-label={`Move ${label} right`}
            disabled={busy || place.last}
            onClick={() => void shift(id, 1)}
          >
            Move ▶
          </Button>
          {owner && (
            <>
              <Button
                variant="outline"
                aria-label={`Move ${label} to the path above`}
                disabled={busy || owner.path === 0}
                onClick={() => void shiftPath(id, -1)}
              >
                ▲ Path
              </Button>
              <Button
                variant="outline"
                aria-label={`Move ${label} to the path below`}
                disabled={busy || owner.path === owner.paths - 1}
                onClick={() => void shiftPath(id, 1)}
              >
                Path ▼
              </Button>
            </>
          )}
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => setCanvasChoice({ kind: 'replace', id })}
          >
            Replace…
          </Button>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => void editChain((route) => routeDuplicate(route, id))}
          >
            Duplicate
          </Button>
          <Button
            variant="ghost"
            aria-label={`Remove ${label}`}
            aria-haspopup="dialog"
            disabled={busy}
            onClick={() => setRemovingBlock(true)}
          >
            <Trash aria-hidden="true" /> Remove
          </Button>
        </ActionRow>
      )}
      {inLane && (
        <div
          className="grid gap-2 border-t border-border pt-3"
          role="group"
          aria-label={`Routing for ${label}`}
        >
          <p className="m-0 font-bold">
            {inSplit
              ? `Path ${owner!.path + 1} of ${owner!.paths}`
              : sceneOwner
                ? `Scene ${owner!.path + 1} · ${sceneCanvas!.names[owner!.path] ?? ''}`
                : 'Serial'}
          </p>
          {sides[0] && sides[1] && (
            <PathLevel
              key={`${selectedBranch.merge}:${selectedBranch.port}:${sides[0].value}:${sides[1].value}`}
              id={`${selectedBranch.merge}:${selectedBranch.port}`}
              path={selectedBranch.port + 1}
              left={sides[0].value}
              right={sides[1].value}
              disabled={busy}
              onCommit={(left, right) =>
                setPathSides([
                  [sides[0]!.target, left],
                  [sides[1]!.target, right],
                ])
              }
            />
          )}
          <ActionRow>
            <Button
              variant="outline"
              disabled={busy || !routable}
              aria-describedby={routable ? undefined : why}
              title={
                selectedView.block.kind === 'cab'
                  ? 'Starts a dual cab: the empty path takes a second cab.'
                  : undefined
              }
              onClick={() => void editChain((route) => routeAddPath(route, id))}
            >
              Split here
            </Button>
            <Button
              variant="outline"
              disabled={busy || !inSplit || full}
              aria-describedby={inSplit && !full ? undefined : why}
              onClick={() =>
                void editChain((route) => routeAddBranch(route, id))
              }
            >
              Add path
            </Button>
            <Button
              variant="outline"
              disabled={busy || !inSplit || full}
              aria-describedby={inSplit && !full ? undefined : why}
              onClick={() =>
                void editChain((route) => routeCopyBranch(route, id))
              }
            >
              Copy path
            </Button>
            <Button
              variant="ghost"
              disabled={busy || !inSplit}
              aria-describedby={inSplit ? undefined : why}
              onClick={() => setRemoving({ path: owner!.path + 1, effects })}
            >
              Remove path
            </Button>
          </ActionRow>
          {routeWhy && (
            <Caption id={why} className="m-0">
              {routeWhy}
            </Caption>
          )}
        </div>
      )}
      {removingBlock && (
        <AdjustmentDialog
          title={`Remove ${label}`}
          onCancel={() => setRemovingBlock(false)}
        >
          <p>Remove {label} and its settings from this preset?</p>
          <ActionRow>
            <Button variant="outline" onClick={() => setRemovingBlock(false)}>
              Cancel
            </Button>
            <Button
              disabled={busy}
              onClick={() => {
                setRemovingBlock(false);
                void editChain((route) => routeRemove(route, id));
              }}
            >
              Remove
            </Button>
          </ActionRow>
        </AdjustmentDialog>
      )}
      {removing && (
        <AdjustmentDialog
          title={`Remove Path ${removing.path}`}
          onCancel={() => setRemoving(null)}
        >
          <p>
            Remove Path {removing.path} and its {removing.effects}{' '}
            {removing.effects === 1 ? 'effect' : 'effects'}?
          </p>
          <ActionRow>
            <Button variant="outline" onClick={() => setRemoving(null)}>
              Cancel
            </Button>
            <Button
              disabled={busy}
              onClick={() => {
                setRemoving(null);
                void editChain((route) => routeRemoveBranch(route, id));
              }}
            >
              Remove
            </Button>
          </ActionRow>
        </AdjustmentDialog>
      )}
    </div>
  );
}
