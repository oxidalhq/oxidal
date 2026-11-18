import {
  ArrowsSplit,
  MusicNotes,
  SlidersHorizontal,
  Waveform,
} from '@phosphor-icons/react';

import { Button } from '@oxidal/design-system/components/button';

import { AddBlockChooser } from '../../AddBlockChooser';
import { ArtworkDeck } from '../../AssetArtwork';
import { controlGroup } from '../../rigControls';
import { ToneDetails } from '../../ToneDetails';
import { rigBusy } from './mixedRigViewModel';
import type { RigViewProps } from './useMixedRigSession';

/**
 * Model controls of the selected native block: control groups, model
 * selection, Change model, Add, artwork, tone details and stage capture.
 * @see docs/interface.md
 */
export function SelectedModelControls({ rig, vm }: RigViewProps) {
  const waiting = rigBusy(vm, rig);
  const { adding, setAdding, setInsertion, setNativeSelection, setPicker } =
    rig;
  const {
    controls,
    eqBlock,
    eqBlocks,
    inLane,
    nativeModels,
    nativeTarget,
    running,
    selected,
    selectedModel,
    selectedToneId,
    slots,
    stageRole,
    state,
    wholeNative,
  } = vm;
  return (
    <>
      {running && selected && wholeNative && (
        <div
          className="flex flex-wrap items-center gap-2"
          aria-label="Native model controls"
        >
          {(
            [
              ['global', 'Tone', SlidersHorizontal],
              ['gate', 'Gate', Waveform],
              ['pitch', 'Pitch', MusicNotes],
              ['stereo', 'Stereo', ArrowsSplit],
            ] as const
          )
            .filter(([target]) =>
              controls.some(
                (c) =>
                  c.target.kind === 'native' &&
                  !c.target.parameter.startsWith('block:') &&
                  controlGroup(c.target.parameter) ===
                    (target === 'global' ? 'tone' : target),
              ),
            )
            .map(([target, title, Icon]) => (
              <Button
                key={target}
                variant="ghost"
                aria-pressed={nativeTarget === target}
                disabled={waiting}
                onClick={() =>
                  setNativeSelection({ node: selected.id, target })
                }
              >
                <Icon aria-hidden="true" />
                {title}
              </Button>
            ))}
          {/* Scene lanes select models by their tiles; other rigs list them here. */}
          {!inLane &&
            eqBlocks.map((block, index) => {
              const control = controls.find(
                (c) =>
                  c.target.kind === 'native' &&
                  c.target.parameter === `block:${block.block_id}:enabled`,
              );
              const title =
                control?.label.replace(
                  /(?: · (?:left|right))? · enabled$/,
                  '',
                ) ?? 'Model';
              return (
                <Button
                  key={block.block_id}
                  variant="outline"
                  aria-label={`Select model ${index + 1}`}
                  aria-pressed={nativeTarget === block.block_id}
                  disabled={waiting}
                  className="h-auto min-h-11 max-w-full min-w-0 whitespace-normal"
                  onClick={() =>
                    setNativeSelection({
                      node: selected.id,
                      target: block.block_id,
                    })
                  }
                >
                  <span className="min-w-0 break-words">
                    {index + 1} · {title}
                  </span>
                </Button>
              );
            })}
          <div className="ml-auto flex flex-wrap gap-2">
            {eqBlock && (
              <Button
                variant="outline"
                disabled={waiting}
                onClick={() =>
                  setPicker({
                    opening: state,
                    node: selected.id,
                    target: eqBlock.block_id,
                    name: 'Selected model',
                    insert: false,
                  })
                }
              >
                Change model
              </Button>
            )}
            {slots.length > 0 && (
              <Button
                variant="outline"
                aria-label="Add block"
                disabled={waiting}
                onClick={() => setAdding(true)}
              >
                Add
              </Button>
            )}
          </div>
          {adding && selected && (
            <AddBlockChooser
              onCancel={() => setAdding(false)}
              onChoose={(format) => {
                setAdding(false);
                setInsertion({ opening: state, node: selected.id, format });
              }}
            />
          )}
        </div>
      )}
      {running && selectedModel && (
        <ArtworkDeck model id={selectedModel.asset} />
      )}
      {running && selectedToneId != null && (
        <ToneDetails toneId={selectedToneId} />
      )}
      {running && selected && nativeModels && !wholeNative && eqBlock && (
        <Button
          variant="outline"
          disabled={waiting}
          onClick={() =>
            setPicker({
              opening: state,
              node: selected.id,
              target: eqBlock.block_id,
              name: stageRole === 'cab' ? 'Cab IR' : 'Amp capture',
              insert: false,
              allowedFormat: stageRole === 'cab' ? 'ir' : 'nam',
            })
          }
        >
          {stageRole === 'cab' ? 'Change cab IR' : 'Change amp capture'}
        </Button>
      )}
    </>
  );
}
