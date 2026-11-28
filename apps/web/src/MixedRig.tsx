import { createPortal } from 'react-dom';

import { Button } from '@oxidal/design-system/components/button';
import { Card } from '@oxidal/design-system/components/card';
import {
  FormField,
  FormGrid,
} from '@oxidal/design-system/components/form-layout';
import { Caption } from '@oxidal/design-system/components/text';
import { useVerticalRig } from '@oxidal/design-system/lib/use-media';

import { AdjustmentDialog } from './AdjustmentDialog';
import { rigAudioCommand, rigAudioState } from './api';
import { BoostControl } from './BoostControl';
import { FailureNotice } from './FailureNotice';
import { SaveSoundVersion } from './features/library/SaveSoundVersion';
import { BlockBox } from './features/rig/BlockBox';
import { ControlAdjustDialog } from './features/rig/ControlAdjustDialog';
import { rigBusy } from './features/rig/mixedRigViewModel';
import { NativeLoad } from './features/rig/NativeLoad';
import { PathLevelsDialog } from './features/rig/PathLevelsDialog';
import { usePresetSlot } from './features/rig/PresetSlot';
import { RigChoosers } from './features/rig/RigChoosers';
import { RigHeader } from './features/rig/RigHeader';
import { RigPresetPanel } from './features/rig/RigPresetPanel';
import { RigWorkspace } from './features/rig/RigWorkspace';
import { SceneEditor } from './features/rig/SceneEditor';
import { StompControls } from './features/rig/StompControls';
import { useMixedRigSession } from './features/rig/useMixedRigSession';
import { GuitarPicker } from './GuitarSettings';
import { friendlyError } from './lib/friendlyError';
import { MasterLevel } from './MasterLevel';
import { PerformView } from './PerformView';
import { boostKey, choiceKey } from './presetChoices';
import { RecoveryNotice } from './RecoveryNotice';
import { RigPresetSelector } from './RigPresetSelector';
import { SceneMidi } from './SceneMidi';
import { ScenePads } from './ScenePads';

/**
 * The sounding mixed rig: header, scenes, chain, selected block and dialogs.
 * State and commands live in useMixedRigSession; the view model is pure.
 * @see docs/interface.md
 */
export function MixedRig(props: {
  connected: boolean;
  onPlaying: (name: string | null) => void;
  onPresent: (present: boolean) => void;
  otherPlaying: boolean;
}) {
  const rig = useMixedRigSession(props);
  const phone = useVerticalRig();
  // The dock's Set list tool, while it is open.
  const presetSlot = usePresetSlot();
  const vm = rig.view;
  if (!vm) return null;
  const waiting = rigBusy(vm, rig);
  const {
    accept,
    alive,
    busy,
    choose,
    clearEdit,
    command,
    copyOnEdit,
    edit,
    editFailure,
    editing,
    error,
    generation: generationRef,
    matching,
    name,
    performing,
    readError,
    recallScene,
    revision,
    saveCopy,
    saveOpening,
    sending: sendingRef,
    setBusy,
    setError,
    setName,
    setPerforming,
    setSaveOpening,
    switchTile,
  } = rig;
  const {
    changed,
    currentSave,
    disabled,
    modelChange,
    modelPending,
    nativeLoad,
    performSwitching,
    running,
    saveStale,
    soundingScene,
    stageLanes,
    chainBlocks,
    state,
  } = vm;
  if (performing && (running || performSwitching))
    return (
      <>
        <PerformView
          now={{
            session: state.session,
            playing: running,
            name: matching?.manifest.name,
            modified: !!changed,
            scene: state.control?.scenes?.scenes.find(
              (scene) =>
                scene.id ===
                (state.control?.stomp_scene ?? state.control?.scene),
            )?.name,
          }}
          switchPreset={
            running && matching && state.control
              ? {
                  kind: 'rig',
                  id: state.control.source_revision,
                  session: state.control.session,
                  midi: state.control.midi,
                  targets: state.control.controls.flatMap((c) => {
                    const t = c.target;
                    if (t.kind !== 'lv2' || !c.toggle) return [];
                    const instance = matching.manifest.oxidal?.graph.nodes.find(
                      (node) => node.id === t.node,
                    )?.instance;
                    const uri = matching.manifest.oxidal?.lv2?.find(
                      (b) => b.id === instance,
                    )?.pluginUri;
                    if (!(
                      uri &&
                      ((/^urn:oxidal:plugin:bloom#(mono|stereo)$/.test(uri) &&
                        t.symbol === 'freeze') ||
                        (/^urn:oxidal:plugin:echo#(mono|stereo)$/.test(uri) &&
                          t.symbol === 'hold'))
                    ))
                      return [];
                    return [
                      {
                        node: t.node,
                        symbol: t.symbol,
                        label:
                          stageLanes
                            .flatMap((l) => l.blocks)
                            .find((b) => b.id === t.node)?.label ?? t.node,
                        on: c.value >= 0.5,
                      },
                    ];
                  }),
                }
              : undefined
          }
          lanes={stageLanes}
          disabled={waiting || performSwitching}
          switching={performSwitching}
          onToggle={switchTile}
          onEdit={() => setPerforming(false)}
          sceneControls={
            state.control?.scenes
              ? {
                  scenes: state.control.scenes.scenes,
                  active:
                    state.control.stomp_scene ?? state.control.scene ?? null,
                  onSelect: (scene) => void recallScene(scene),
                }
              : undefined
          }
          scenes={
            !!state.control?.scenes?.scenes.length && (
              <>
                <ScenePads
                  scenes={state.control.scenes.scenes}
                  active={state.control.stomp_scene ?? state.control.scene}
                  canRecallActive={
                    !!state.control.stomp_scene &&
                    state.control.stomp_scene !== state.control.scene
                  }
                  fading={!!state.control.scene_transitioning}
                  disabled={waiting}
                  onSelect={(scene) => void recallScene(scene)}
                  // As C2 Perform: each card says the pedals it switches
                  // and the MIDI it answers to (this preset's bindings).
                  fill
                  details={(scene) => {
                    const binding = state.configured?.midi?.bindings.find(
                      (b) => b.scene === scene.id,
                    );
                    // The whole chain, not only the sounding scene's path:
                    // a scene on another path still lists its pedals. A
                    // hold switch's live state counts as the block's own.
                    const live = stageLanes.flatMap((l) => l.blocks);
                    const blocks = chainBlocks.map(
                      (b) => live.find((x) => x.id === b.id) ?? b,
                    );
                    return {
                      midi:
                        binding?.controller != null
                          ? `CC ${binding.controller}`
                          : binding?.program != null
                            ? `Program ${binding.program + 1}`
                            : undefined,
                      // Every block in the chain, as C2 lists them: on or
                      // off as the scene sets it, otherwise as it is now.
                      pedals: blocks.map((block) => {
                        const set = state.control?.scenes?.scenes
                          .find((s) => s.id === scene.id)
                          ?.bypass?.find((b) => b.node === block.id);
                        return {
                          id: block.id,
                          label: block.label,
                          on: set ? !set.value : block.on,
                          kind: block.kind,
                          face: block.face,
                        };
                      }),
                    };
                  }}
                />
                <StompControls rig={rig} vm={vm} stage />
              </>
            )
          }
          selector={
            <RigPresetSelector
              phase={state.phase}
              current={{
                key: revision
                  ? choiceKey({
                      kind: 'scenes',
                      revision,
                    })
                  : '',
                name: matching?.manifest.name,
                modified: !!changed,
                refresh: revision,
              }}
              disabled={waiting || !!copyOnEdit}
              pads
              all
              onSelect={(choice) => void choose(choice)}
            />
          }
          identity={
            <RigPresetSelector
              heading
              phase={state.phase}
              current={{
                key: revision ? choiceKey({ kind: 'scenes', revision }) : '',
                name: matching?.manifest.name,
                modified: !!changed,
                refresh: revision,
              }}
              disabled={waiting || !!copyOnEdit}
              onSelect={(choice) => void choose(choice)}
            />
          }
        />
        {error && <p role="alert">{error}</p>}
        {/* Perform keeps the set list in the dock, with the same checks. */}
        {presetSlot &&
          createPortal(
            <RigPresetPanel
              playingKey={
                revision ? choiceKey({ kind: 'scenes', revision }) : ''
              }
              refresh={revision}
              disabled={waiting || !!copyOnEdit}
              onSelect={(choice) => void choose(choice)}
            />,
            presetSlot,
          )}
      </>
    );
  return (
    <>
      {/* The Rig fills the screen under the capsule: the chain, its bar and
          the panel share it, and the panel scrolls on its own. */}
      <div className="flex h-[calc(100dvh-4rem-var(--safe-top)-var(--app-bottom-height,0px)-var(--spacing-page))] min-h-[30rem]">
        <Card
          className="rig-editor flex min-h-0 min-w-0 flex-1 flex-col gap-3 border-0 bg-transparent p-0 shadow-none data-loading:[&>:not([data-slot=rig-heading]):not([data-rig-switching])]:hidden"
          aria-label="Sounding mixed rig"
          data-loading={performSwitching || undefined}
        >
          <RigHeader rig={rig} vm={vm} />
          <RecoveryNotice message={state.recovery_error} />
          {(error || readError || state.error) && (
            <p
              role="alert"
              className="mb-4 min-w-0 rounded-lg border border-destructive px-3 py-2.5 wrap-anywhere text-destructive"
            >
              {error || readError || state.error}
            </p>
          )}
          <FailureNotice
            failure={editFailure}
            busy={editing}
            onRefresh={() => {
              clearEdit();
              void rigAudioState().then(accept, () => {});
            }}
          />
          <RigWorkspace rig={rig} vm={vm}>
            {() => (
              <div className="rig-dock grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-3">
                <div className="min-w-0">
                  <SceneEditor rig={rig} vm={vm} />
                </div>
                {/* Stomp switches follow the scenes, before the block, as
                    Storybook's Rig orders them. */}
                <StompControls rig={rig} vm={vm} />
                <RigChoosers rig={rig} vm={vm} />
                {/* The same block box on every screen, in the panel under the
                chain bar (a phone too, as C2 draws it). Routing opens from
                its ⋯ button. */}
                <section aria-label="Block controls" className="min-w-0">
                  <BlockBox rig={rig} vm={vm} />
                </section>
                <ControlAdjustDialog rig={rig} vm={vm} />
                {/* The output level sits below the block box on a phone;
                wider screens have it under the OUT meter, with the guitar
                under IN. */}
                <section
                  aria-label="Output"
                  className="grid gap-1 px-1 empty:hidden"
                >
                  {phone && (
                    <div className="grid max-w-3xl gap-3">
                      {phone && (
                        <MasterLevel
                          extra={
                            <>
                              <GuitarPicker />
                              {matching && (
                                <BoostControl
                                  targets={[
                                    {
                                      key: boostKey.scenes(
                                        matching.manifest.id,
                                      ),
                                      label: matching.manifest.name,
                                    },
                                    ...(soundingScene
                                      ? [
                                          {
                                            key: boostKey.scene(
                                              matching.manifest.id,
                                              soundingScene.id,
                                            ),
                                            label: `Scene · ${soundingScene.name}`,
                                          },
                                        ]
                                      : []),
                                  ]}
                                />
                              )}
                            </>
                          }
                        />
                      )}
                    </div>
                  )}
                </section>
                {modelPending && (
                  <div
                    className="flex flex-wrap items-center gap-2"
                    role="status"
                  >
                    <span>
                      {modelChange!.progress.phase === 'applying'
                        ? 'Applying model…'
                        : 'Preparing model…'}
                    </span>
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={async () => {
                        generationRef.current++;
                        sendingRef.current = true;
                        setBusy(true);
                        try {
                          const fresh = await rigAudioState();
                          if (
                            fresh.control?.session !== state.control?.session ||
                            fresh.control?.model_change?.node !==
                              modelChange!.node ||
                            fresh.control?.model_change?.progress.request !==
                              modelChange!.progress.request
                          )
                            throw new Error(
                              'Model selection changed. Review it before cancelling.',
                            );
                          accept(
                            await rigAudioCommand(fresh, {
                              kind: 'model',
                              command: {
                                session: fresh.control.session,
                                expected_revision: fresh.control.revision,
                                node: modelChange!.node,
                                operation: { kind: 'cancel' },
                              },
                            }),
                          );
                        } catch (cause) {
                          if (alive.current)
                            setError(friendlyError(cause, 'update the rig'));
                        } finally {
                          sendingRef.current = false;
                          if (alive.current) setBusy(false);
                        }
                      }}
                    >
                      Cancel model
                    </Button>
                  </div>
                )}
                {modelChange?.progress.error && (
                  <p
                    role="alert"
                    className="mb-4 min-w-0 rounded-lg border border-destructive px-3 py-2.5 wrap-anywhere text-destructive"
                  >
                    {modelChange!.progress.error}
                  </p>
                )}
                {phone && <NativeLoad load={nativeLoad} />}
                <SceneMidi
                  trigger={false}
                  state={state}
                  disabled={waiting}
                  onCommand={async (action) => {
                    await command(action);
                  }}
                />
                <PathLevelsDialog rig={rig} vm={vm} />
                {saveOpening && (
                  <AdjustmentDialog
                    title="Save copy"
                    onCancel={() => {
                      if (!busy) setSaveOpening(null);
                    }}
                  >
                    <Caption>
                      Keep this sound for offline use. The original rig stays
                      unchanged.
                    </Caption>
                    <FormGrid>
                      <FormField>
                        Preset name
                        <input
                          disabled={busy}
                          value={name}
                          maxLength={128}
                          onChange={(e) => setName(e.target.value)}
                        />
                      </FormField>
                      <Button
                        disabled={
                          disabled ||
                          !matching ||
                          !!edit ||
                          !!state.save?.running ||
                          !name.trim() ||
                          saveStale
                        }
                        onClick={() => void saveCopy()}
                      >
                        {busy ? 'Saving…' : 'Save'}
                      </Button>
                    </FormGrid>
                    {rig.sourceOrigin === 'mine' && rig.revision && (
                      <SaveSoundVersion
                        key={rig.revision}
                        kind="rig"
                        source={rig.revision}
                        name={name}
                        disabled={
                          disabled ||
                          !matching ||
                          !!edit ||
                          busy ||
                          !!state.save?.running ||
                          saveStale
                        }
                        onSave={saveCopy}
                      />
                    )}
                    {saveStale && (
                      <p role="status">
                        The rig changed. Close and reopen Save copy.
                      </p>
                    )}
                    {error && <p role="alert">{error}</p>}
                  </AdjustmentDialog>
                )}
                {currentSave?.error && <p role="alert">{currentSave.error}</p>}
                {currentSave?.saved_revision && (
                  <p role="status">
                    {changed
                      ? 'Saved earlier settings · newer edits remain'
                      : 'Saved for offline use'}
                  </p>
                )}
              </div>
            )}
          </RigWorkspace>
        </Card>
      </div>
    </>
  );
}
