import { AddBlockChooser } from '../../AddBlockChooser';
import { AdjustmentDialog } from '../../AdjustmentDialog';
import { Button } from '../../components/ui/button';
import { ModelPicker } from '../../ModelPicker';
import { SlotChooser } from '../../SlotChooser';
import { addSceneEffect } from '../../sceneEdit';
import { assertAuditionOwner } from '../../rigControls';
import { lv2Effect, terminalEffect } from '../../rigDraft';
import { rigAudioCommand, rigAudioState } from '../../api';
import { routeAppend, routeInsert, routeLanes } from '../../rigRoute';
import type { RigViewProps } from './useMixedRigSession';
import { END, PATH } from './mixedRigViewModel';

/**
 * Choosers opened from the chain: slot and block choosers, native insertion
 * positions and the model picker with its audition.
 * @see docs/interface.md
 */
export function RigChoosers({ rig, vm }: RigViewProps) {
  const {
    accept,
    alive,
    current,
    editChain,
    generation: generationRef,
    insertion,
    laneSlot,
    matching,
    picker,
    rebuild,
    sending: sendingRef,
    setBusy,
    setError,
    setInsertion,
    setLaneSlot,
    setPicker,
  } = rig;
  const {
    changed,
    disabled,
    effectLanes,
    modelChange,
    modelPending,
    sceneBranches,
    sceneLanes,
    state,
  } = vm;
  return (
    <>
      {laneSlot && effectLanes.length > 0 && state.configured && (
        <SlotChooser
          sampleRate={state.configured.stream.input.sample_rate}
          presetName={matching?.manifest.name ?? 'this preset'}
          modified={!!changed}
          allowEffects
          modelsAllowed={laneSlot.node !== END && laneSlot.node !== PATH}
          placement="here"
          onCancel={() => setLaneSlot(null)}
          onModel={(format) => {
            setPicker({
              opening: state,
              node: laneSlot.node,
              target: laneSlot.target,
              name: 'Empty slot',
              insert: true,
              format,
            });
            setLaneSlot(null);
          }}
          onEffect={(plugin) => {
            const slot = laneSlot;
            setLaneSlot(null);
            void editChain((route) => {
              if (slot.node === PATH) {
                const cut = slot.target.lastIndexOf(':');
                return routeAppend(route, lv2Effect(plugin), {
                  split: slot.target.slice(0, cut),
                  path: Number(slot.target.slice(cut + 1)),
                });
              }
              const effect =
                slot.node === END ? terminalEffect(plugin) : lv2Effect(plugin);
              if (slot.node === END)
                return routeInsert(
                  route,
                  Number(slot.target),
                  Infinity,
                  effect,
                );
              // An empty slot inside a TONE3000 chain: the effect goes after it.
              const lanes = routeLanes(route);
              const lane = lanes.findIndex((l) =>
                l.some((b) => b.id === slot.node),
              );
              const at = lanes[lane]!.findIndex((b) => b.id === slot.node);
              return routeInsert(route, lane, at + 1, effect);
            });
          }}
        />
      )}
      {laneSlot &&
        !effectLanes.length &&
        sceneLanes.length > 0 &&
        state.configured && (
          <SlotChooser
            sampleRate={state.configured.stream.input.sample_rate}
            presetName={matching?.manifest.name ?? 'this preset'}
            modified={!!changed}
            allowEffects
            modelsAllowed={laneSlot.node !== END}
            placement="here"
            onCancel={() => setLaneSlot(null)}
            onModel={(format) => {
              setPicker({
                opening: state,
                node: laneSlot.node,
                target: laneSlot.target,
                name: 'Empty slot',
                insert: true,
                format,
              });
              setLaneSlot(null);
            }}
            onEffect={(plugin) => {
              const slot = laneSlot;
              setLaneSlot(null);
              // The effect goes at the end of this scene, after its TONE3000 chain.
              const branch =
                slot.node === END
                  ? sceneBranches[Number(slot.target)]?.id
                  : slot.node;
              if (!branch) return;
              void rebuild(({ opened, live, name }) =>
                addSceneEffect(
                  opened,
                  branch,
                  slot.node === END
                    ? terminalEffect(plugin)
                    : lv2Effect(plugin),
                  live,
                  name,
                ),
              );
            }}
          />
        )}
      {laneSlot && !effectLanes.length && !sceneLanes.length && (
        <AddBlockChooser
          onCancel={() => setLaneSlot(null)}
          onChoose={(format) => {
            setPicker({
              opening: state,
              node: laneSlot.node,
              target: laneSlot.target,
              name: 'Empty slot',
              insert: true,
              format,
            });
            setLaneSlot(null);
          }}
        />
      )}
      {insertion && (
        <AdjustmentDialog
          title={`Add ${insertion.format.toUpperCase()} · position`}
          onCancel={() => setInsertion(null)}
        >
          <p className="caption">
            Choose an available position in the selected native chain.
          </p>
          <div
            className="grid gap-2"
            aria-label="Available insertion positions"
          >
            {insertion.opening.control?.slots
              ?.find((row) => row.node === insertion.node)
              ?.slots.map((slot) => (
                <Button
                  key={slot.target}
                  variant="outline"
                  disabled={
                    disabled ||
                    state.session !== insertion.opening.session ||
                    state.revision !== insertion.opening.revision ||
                    state.control?.session !==
                      insertion.opening.control?.session ||
                    state.control?.revision !==
                      insertion.opening.control?.revision
                  }
                  onClick={() => {
                    const latest = current.current;
                    if (
                      !latest ||
                      latest.session !== insertion.opening.session ||
                      latest.revision !== insertion.opening.revision ||
                      latest.control?.session !==
                        insertion.opening.control?.session ||
                      latest.control?.revision !==
                        insertion.opening.control?.revision
                    )
                      return;
                    setPicker({
                      opening: insertion.opening,
                      node: insertion.node,
                      target: slot.target,
                      name: `${slot.position.lane === 0 ? 'Left' : 'Right'} chain · position ${slot.position.index + 1}`,
                      insert: true,
                      format: insertion.format,
                    });
                    setInsertion(null);
                  }}
                >
                  {slot.position.lane === 0 ? 'Left' : 'Right'} chain · position{' '}
                  {slot.position.index + 1}
                </Button>
              ))}
          </div>
          {(state.session !== insertion.opening.session ||
            state.revision !== insertion.opening.revision ||
            state.control?.session !== insertion.opening.control?.session ||
            state.control?.revision !==
              insertion.opening.control?.revision) && (
            <p role="status">
              The chain changed. Close and choose the position again.
            </p>
          )}
        </AdjustmentDialog>
      )}
      {picker && (
        <ModelPicker
          name={picker.name}
          initialFormat={picker.format}
          allowedFormat={picker.allowedFormat}
          intent={picker.insert ? 'add' : 'replace'}
          comparison={
            picker.insert
              ? undefined
              : {
                  pending: modelPending,
                  appliedAsset:
                    modelChange?.node === picker.node &&
                    modelChange?.progress.request === picker.request &&
                    modelChange.progress.phase === 'applied'
                      ? modelChange.progress.assignment.asset
                      : undefined,
                  error:
                    modelChange?.node === picker.node &&
                    modelChange?.progress.request === picker.request
                      ? modelChange.progress.error
                      : undefined,
                  blocked:
                    state.session !== picker.opening.session ||
                    state.control?.session !== picker.opening.control?.session,
                }
          }
          onClose={() => setPicker(null)}
          onAudition={async (asset) => {
            generationRef.current++;
            sendingRef.current = true;
            setBusy(true);
            try {
              const current = await rigAudioState();
              if (
                current.control?.session !== picker.opening.control?.session ||
                !current.control ||
                (picker.request != null &&
                  current.control.model_change?.node !== picker.node)
              )
                throw new Error(
                  'The playing preset changed. Close and reopen the model browser.',
                );
              assertAuditionOwner(
                picker.opening,
                current,
                picker.request,
                current.control.model_change?.progress,
              );
              const control = current.control;
              const next = await rigAudioCommand(current, {
                kind: 'model',
                command: {
                  session: control.session,
                  expected_revision: control.revision,
                  node: picker.node,
                  operation: {
                    kind: 'prepare',
                    assignment: { target: picker.target, asset },
                  },
                },
              });
              accept(next);
              if (alive.current) {
                setPicker({
                  ...picker,
                  request: next.control?.model_change?.progress.request,
                });
                setError('');
              }
            } finally {
              sendingRef.current = false;
              if (alive.current) setBusy(false);
            }
          }}
        />
      )}
    </>
  );
}
