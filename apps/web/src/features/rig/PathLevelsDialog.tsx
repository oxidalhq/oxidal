import { AdjustmentDialog } from '../../AdjustmentDialog';
import { Button } from '../../components/ui/button';
import { routePath, routeSplitAddPath } from '../../rigRoute';
import type { RigViewProps } from './useMixedRigSession';
import { rigBusy } from './mixedRigViewModel';
import { PathLevel } from './PathLevel';
import { useState } from 'react';
import type { IdStep } from '../../rigChain';

/** Blocks on a path, nested splits included. */
const blocksOn = (steps: IdStep[]): number =>
  steps.reduce(
    (n, s) =>
      n +
      (typeof s === 'string'
        ? 1
        : s.branches.reduce((m, b) => m + blocksOn(b), 0)),
    0,
  );

/**
 * A split's path levels, with copy, remove and add-path actions.
 * @see docs/interface.md
 */
export function PathLevelsDialog({ rig, vm }: RigViewProps) {
  const { editChain, routingSplit, setPathSides, setRoutingSplit } = rig;
  const { editable, fullRoute, state } = vm;
  const waiting = rigBusy(vm, rig);
  /** Remove path waiting for confirmation: it has effects. */
  const [removing, setRemoving] = useState<{
    split: string;
    path: number;
    effects: number;
  } | null>(null);
  const remove = (split: string, path: number) => {
    setRemoving(null);
    setRoutingSplit(null);
    void editChain((route) => routePath(route, split, path, 'remove'));
  };
  return (
    <>
      {removing && (
        <AdjustmentDialog
          title={`Remove Path ${removing.path + 1}`}
          onCancel={() => setRemoving(null)}
        >
          <p>
            Remove Path {removing.path + 1} and its {removing.effects}{' '}
            {removing.effects === 1 ? 'effect' : 'effects'}?
          </p>
          <div className="action-row">
            <Button variant="outline" onClick={() => setRemoving(null)}>
              Cancel
            </Button>
            <Button
              disabled={waiting}
              onClick={() => remove(removing.split, removing.path)}
            >
              Remove
            </Button>
          </div>
        </AdjustmentDialog>
      )}
      {routingSplit &&
        (() => {
          const split = (function find(
            steps: typeof fullRoute,
          ): Exclude<NonNullable<typeof fullRoute>[number], string> | null {
            for (const step of steps ?? []) {
              if (typeof step === 'string') continue;
              if (step.split === routingSplit) return step;
              for (const branch of step.branches) {
                const inner = find(branch);
                if (inner) return inner;
              }
            }
            return null;
          })(fullRoute);
          if (!split) return null;
          return (
            <AdjustmentDialog
              title={`Split · ${split.branches.length} paths`}
              description="Each path's level into the merge. Changes are live; Save keeps them."
              onCancel={() => setRoutingSplit(null)}
            >
              <div className="control-stack" aria-label="Path levels">
                {split.branches.map((_, port) => {
                  const sides = ['left', 'right'].map((side) =>
                    state.control?.controls.find(
                      (c) =>
                        c.target.kind === 'merge' &&
                        c.target.node === `${split.merge}-${side}` &&
                        c.target.port === port,
                    ),
                  );
                  return (
                    <div
                      key={`${split.split}:${port}`}
                      className="route-sheet-path"
                    >
                      {sides[0] && sides[1] ? (
                        <PathLevel
                          key={`${split.merge}:${port}:${sides[0]!.value}:${sides[1]!.value}`}
                          id={`${split.merge}:${port}`}
                          path={port + 1}
                          left={sides[0]!.value}
                          right={sides[1]!.value}
                          disabled={waiting}
                          onCommit={(left, right) =>
                            setPathSides([
                              [sides[0]!.target, left],
                              [sides[1]!.target, right],
                            ])
                          }
                        />
                      ) : (
                        <span>Path {port + 1}</span>
                      )}
                      {editable && (
                        <div className="action-row">
                          <Button
                            variant="outline"
                            aria-label={`Copy path ${port + 1}`}
                            disabled={waiting}
                            onClick={() => {
                              setRoutingSplit(null);
                              void editChain((route) =>
                                routePath(route, split.split, port, 'copy'),
                              );
                            }}
                          >
                            Copy
                          </Button>
                          <Button
                            variant="outline"
                            aria-label={`Remove path ${port + 1}`}
                            disabled={waiting}
                            onClick={() => {
                              const effects = blocksOn(split.branches[port]!);
                              // An empty path goes at once; one with effects asks.
                              if (!effects) remove(split.split, port);
                              else {
                                setRoutingSplit(null);
                                setRemoving({
                                  split: split.split,
                                  path: port,
                                  effects,
                                });
                              }
                            }}
                          >
                            Remove
                          </Button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              {editable && (
                <div className="action-row">
                  <Button
                    variant="outline"
                    disabled={waiting}
                    onClick={() => {
                      setRoutingSplit(null);
                      void editChain((route) =>
                        routeSplitAddPath(route, split.split),
                      );
                    }}
                  >
                    + Add dry path
                  </Button>
                </div>
              )}
              <p className="caption">
                Removing the second-last path removes the split. Scene presets
                keep at least one split.
              </p>
            </AdjustmentDialog>
          );
        })()}
    </>
  );
}
