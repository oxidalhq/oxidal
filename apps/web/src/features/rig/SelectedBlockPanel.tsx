import { Button } from '../../components/ui/button';
import { CaretLeft, CaretRight, Trash } from '@phosphor-icons/react';
import { LedToggle } from '../../ChainView';
import { removeSceneEffect } from '../../sceneEdit';
import {
  routeAddBranch,
  routeAddPath,
  routeCopyBranch,
  routeRemove,
  routeRemoveBranch,
} from '../../rigRoute';
import type { RigViewProps } from './useMixedRigSession';
import { PathLevel } from './PathLevel';

/**
 * Toolbar of the selected block: arrange, path level, routing and on/off.
 * @see docs/interface.md
 */
export function SelectedBlockPanel({ rig, vm }: RigViewProps) {
  const {
    busy,
    command,
    edit,
    editChain,
    editing,
    rebuild,
    setPathSides,
    shift,
  } = rig;
  const {
    disabled,
    editable,
    inLane,
    place,
    running,
    sceneEffectSet,
    sceneLanes,
    selected,
    selectedBranch,
    selectedView,
    state,
  } = vm;
  return (
    <>
      {running &&
        selectedView &&
        (selectedView.branch || selectedView.bypass) && (
          <div className="selected-node" aria-label="Selected block">
            <h3 className="selected-node-title" title={selectedView.label}>
              {selectedView.label}
            </h3>
            {sceneEffectSet.has(selected!.id) && (
              <div className="action-row" role="group" aria-label="Arrange">
                <Button
                  variant="ghost"
                  disabled={disabled || !!edit || editing}
                  onClick={() =>
                    void rebuild(({ opened, live, name }) =>
                      removeSceneEffect(opened, selected!.id, live, name),
                    )
                  }
                >
                  <Trash aria-hidden="true" /> Remove
                </Button>
              </div>
            )}
            {editable && selected!.kind === 'lv2' && (
              <div className="action-row" role="group" aria-label="Arrange">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Move ${selectedView.label} left`}
                  disabled={disabled || !!edit || editing || place.first}
                  onClick={() => void shift(selected!.id, -1)}
                >
                  <CaretLeft aria-hidden="true" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Move ${selectedView.label} right`}
                  disabled={disabled || !!edit || editing || place.last}
                  onClick={() => void shift(selected!.id, 1)}
                >
                  <CaretRight aria-hidden="true" />
                </Button>
                <Button
                  variant="ghost"
                  disabled={disabled || !!edit || editing}
                  onClick={() =>
                    void editChain((route) => routeRemove(route, selected!.id))
                  }
                >
                  <Trash aria-hidden="true" /> Remove
                </Button>
              </div>
            )}
            {inLane &&
              editable &&
              !sceneLanes.length &&
              selectedBranch.paths > 0 &&
              (() => {
                const sides = ['left', 'right'].map((side) =>
                  state.control?.controls.find(
                    (c) =>
                      c.target.kind === 'merge' &&
                      c.target.node === `${selectedBranch.merge}-${side}` &&
                      c.target.port === selectedBranch.port,
                  ),
                );
                if (!sides[0] || !sides[1]) return null;
                return (
                  <PathLevel
                    key={`${selectedBranch.merge}:${selectedBranch.port}:${sides[0]!.value}:${sides[1]!.value}`}
                    path={selectedBranch.port + 1}
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
                );
              })()}
            {inLane && editable && !sceneLanes.length && (
              <div
                className="action-row"
                role="group"
                aria-label={`Routing for ${selectedView.label}`}
              >
                <Button
                  variant="outline"
                  disabled={disabled || !!edit || editing}
                  onClick={() =>
                    void editChain((route) => routeAddPath(route, selected!.id))
                  }
                >
                  {selectedView.block.kind === 'cab'
                    ? 'Dual cab: add a cab path'
                    : 'Add parallel path'}
                </Button>
                {selectedBranch.found && selectedBranch.paths > 0 && (
                  <>
                    <Button
                      variant="outline"
                      disabled={disabled || !!edit || editing}
                      onClick={() =>
                        void editChain((route) =>
                          routeAddBranch(route, selected!.id),
                        )
                      }
                    >
                      Add branch
                    </Button>
                    <Button
                      variant="outline"
                      disabled={disabled || !!edit || editing}
                      onClick={() =>
                        void editChain((route) =>
                          routeCopyBranch(route, selected!.id),
                        )
                      }
                    >
                      Copy branch
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={disabled || !!edit || editing}
                      onClick={() =>
                        void editChain((route) =>
                          routeRemoveBranch(route, selected!.id),
                        )
                      }
                    >
                      Remove branch
                    </Button>
                  </>
                )}
              </div>
            )}
            {selectedView.branch ? (
              <LedToggle
                on={selectedView.branch.enabled}
                kind={selectedView.block.kind}
                state={selectedView.branch.partial ? 'Mixed' : undefined}
                label={`Toggle branch ${selectedView.branch.name}`}
                disabled={disabled || !!edit}
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
                label={`${selectedView.label} on`}
                disabled={disabled || !!edit}
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
    </>
  );
}
