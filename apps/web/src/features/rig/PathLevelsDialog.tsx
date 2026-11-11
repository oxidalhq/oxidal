import { AdjustmentDialog } from '../../AdjustmentDialog';
import { Button } from '../../components/ui/button';
import { routePath, routeSplitAddPath } from '../../rigRoute';
import type { RigViewProps } from './useMixedRigSession';
import { PathLevel } from './PathLevel';

/**
 * A split's path levels, with copy, remove and add-path actions.
 * @see docs/interface.md
 */
export function PathLevelsDialog({ rig, vm }: RigViewProps) {
  const {
    busy,
    edit,
    editChain,
    editing,
    routingSplit,
    setPathSides,
    setRoutingSplit,
  } = rig;
  const { disabled, editable, fullRoute, state } = vm;
  return (
    <>
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
                          path={port + 1}
                          left={sides[0]!.value}
                          right={sides[1]!.value}
                          disabled={disabled || !!edit || editing || busy}
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
                            disabled={disabled || !!edit || editing}
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
                            disabled={disabled || !!edit || editing}
                            onClick={() => {
                              setRoutingSplit(null);
                              void editChain((route) =>
                                routePath(route, split.split, port, 'remove'),
                              );
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
                    disabled={disabled || !!edit || editing}
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
