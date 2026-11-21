import { Badge } from '@oxidal/design-system/components/badge';
import { Button } from '@oxidal/design-system/components/button';

import { AdjustmentDialog } from './AdjustmentDialog';
import { rigAudioCommand, rigAudioState } from './api';
import { BoostControl } from './BoostControl';
import { MaybeSheet } from './components/RigSheet';
import { FailureNotice } from './FailureNotice';
import { SaveSoundVersion } from './features/library/SaveSoundVersion';
import { ControlAdjustDialog } from './features/rig/ControlAdjustDialog';
import { ControlGrid } from './features/rig/ControlGrid';
import { LiveLv2Panel } from './features/rig/LiveLv2Panel';
import { rigBusy } from './features/rig/mixedRigViewModel';
import { PathLevelsDialog } from './features/rig/PathLevelsDialog';
import { RigChainSurface } from './features/rig/RigChainSurface';
import { RigChoosers } from './features/rig/RigChoosers';
import { RigHeader } from './features/rig/RigHeader';
import { SceneEditor } from './features/rig/SceneEditor';
import { SelectedBlockPanel } from './features/rig/SelectedBlockPanel';
import { SelectedModelControls } from './features/rig/SelectedModelControls';
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
    switchPrepared,
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
    selected,
    selectedSheet,
    soundingScene,
    stageLanes,
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
          }}
          lanes={stageLanes}
          disabled={waiting || performSwitching}
          switching={performSwitching}
          onToggle={switchTile}
          onEdit={() => setPerforming(false)}
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
        />
        {error && <p role="alert">{error}</p>}
      </>
    );
  return (
    <section
      className="panel rig-editor space-y-3"
      aria-label="Sounding mixed rig"
      data-loading={performSwitching || undefined}
    >
      <RigHeader rig={rig} vm={vm} />
      <SceneEditor rig={rig} vm={vm} />
      <StompControls rig={rig} vm={vm} />
      <RecoveryNotice message={state.recovery_error} />
      {(error || readError || state.error) && (
        <p role="alert" className="error">
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
      <RigChainSurface rig={rig} vm={vm} />
      {/* Output row under the chain (7.28). */}
      <div className="rig-output-row">
        <MasterLevel
          extra={
            <>
              <GuitarPicker />
              {matching && (
                <BoostControl
                  targets={[
                    {
                      key: boostKey.scenes(matching.manifest.id),
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
        {!!state.control?.prepared?.length && (
          <details className="ready-presets">
            <summary>
              <span>Ready to switch</span>
              <Badge>{state.control.prepared.length + 1} presets</Badge>
              <span className="ready-presets-state">
                {state.control.prepared.length + 1} loaded ·{' '}
                {1 +
                  state.control.prepared.filter((preset) => preset.rendering)
                    .length}{' '}
                processing
              </span>
            </summary>
            <p className="caption">
              Loaded presets can switch without reopening audio. Playing is the
              sound you hear; Processing is still rendering a tail; Sleeping is
              loaded but using no DSP. These are presets, not scenes.
            </p>
            <div
              className="ready-presets-list"
              role="group"
              aria-label="Ready presets"
            >
              <div className="ready-preset-current">
                <strong>{matching?.manifest.name ?? 'Current preset'}</strong>
                <Badge>Playing</Badge>
                <Badge>Processing</Badge>
              </div>
              {state.control.prepared.map((p) => (
                <Button
                  key={p.revision}
                  className="h-auto min-h-11 max-w-full min-w-0 text-left whitespace-normal"
                  variant="outline"
                  disabled={waiting || !!p.error}
                  onClick={() => void switchPrepared(p.revision)}
                >
                  <span className="min-w-0 break-words">
                    {p.name}
                    {p.error
                      ? ' · Unavailable'
                      : p.modified
                        ? ' · Modified'
                        : ''}
                  </span>
                  {!p.error && (
                    <Badge>{p.rendering ? 'Processing' : 'Sleeping'}</Badge>
                  )}
                </Button>
              ))}
            </div>
          </details>
        )}
      </div>
      {modelPending && (
        <div className="flex flex-wrap items-center gap-2" role="status">
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
                  fresh.control?.model_change?.node !== modelChange!.node ||
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
        <p role="alert" className="error">
          {modelChange!.progress.error}
        </p>
      )}
      <RigChoosers rig={rig} vm={vm} />
      <MaybeSheet sheet={running && selected ? selectedSheet : null}>
        <SelectedModelControls rig={rig} vm={vm} />
        {running && selected?.kind === 'lv2' && (
          <LiveLv2Panel rig={rig} vm={vm} />
        )}
        <SelectedBlockPanel rig={rig} vm={vm} />
        {selected?.kind !== 'lv2' && <ControlGrid rig={rig} vm={vm} />}
      </MaybeSheet>
      <ControlAdjustDialog rig={rig} vm={vm} />
      {nativeLoad.engines > 0 && (
        <div className="rig-load-summary" aria-label="Native processing load">
          <Badge>
            {nativeLoad.engines}{' '}
            {nativeLoad.engines === 1 ? 'NAM block' : 'NAM blocks'}
          </Badge>
          <Badge>{nativeLoad.blocks} chain blocks</Badge>
          {nativeLoad.full + nativeLoad.lite + nativeLoad.scaled > 0 && (
            <Badge>
              A2 size · {nativeLoad.full} Full · {nativeLoad.lite} Lite
              {nativeLoad.scaled > 0 ? ` · ${nativeLoad.scaled} scaled` : ''}
            </Badge>
          )}
          {!!nativeLoad.oversampling.length && (
            <Badge>Oversampling · {nativeLoad.oversampling.join(' / ')}</Badge>
          )}
        </div>
      )}
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
          <p className="caption">
            Keep this sound for offline use. The original rig stays unchanged.
          </p>
          <div className="form-grid">
            <label className="field">
              Preset name
              <input
                disabled={busy}
                value={name}
                maxLength={128}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
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
          </div>
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
            <p role="status">The rig changed. Close and reopen Save copy.</p>
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
    </section>
  );
}
