import { useState } from 'react';

import { Badge } from '@oxidal/design-system/components/badge';
import { Button } from '@oxidal/design-system/components/button';
import {
  ActionRow,
  FormField,
} from '@oxidal/design-system/components/form-layout';
import { Caption } from '@oxidal/design-system/components/text';

import { AdjustmentDialog } from '../../AdjustmentDialog';
import { SceneChange } from '../../SceneChange';
import { nativeBypassKey } from '../../sceneNativeBypass';
import { ScenePads } from '../../ScenePads';
import { rigBusy } from './mixedRigViewModel';
import { SceneSettings } from './SceneEditorControls';
import { SceneMenu } from './SceneEditorMenu';
import { useSceneSettings } from './SceneEditorSettings';
import { SceneGrid } from './SceneGrid';
import { NativeSceneSettings } from './SceneNativeSettings';
import { useNativeSceneSettings } from './SceneNativeSettingsState';
import { PrepareSleepingBranches, SleepingBranches } from './SleepingBranches';
import type { RigViewProps } from './useMixedRigSession';

/**
 * Scene pads and the current-scene panel: mix, Update scene, Save as new
 * scene and the save review for presets with scenes.
 * @see docs/interface.md
 */
export function SceneEditor({ rig, vm }: RigViewProps) {
  const waiting = rigBusy(vm, rig) || rig.sceneSharing.conflict;
  const [menu, setMenu] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [gridOpen, setGridOpen] = useState(false);
  const settings = useSceneSettings({ rig, vm });
  const nativeSettings = useNativeSceneSettings({ rig, vm });
  const {
    current,
    matching,
    namingScene,
    recallScene,
    saveReview,
    saveScenes,
    setNamingScene,
    setSaveReview,
    sceneUpdates,
    setSceneDraft,
    setSceneUpdates,
  } = rig;
  const {
    addedScenes,
    draftCount,
    drafts,
    editingScene,
    editingSceneGains,
    sceneMix,
    sceneMixChanged,
    state,
  } = vm;
  const session = state.control?.session;
  /** Effect settings drafted with Update scene, kept with the scene draft. */
  const draftedControls =
    sceneUpdates?.session === session ? (sceneUpdates?.controls ?? {}) : {};
  const pending = draftCount;
  const draftedBypass =
    sceneUpdates?.session === session ? (sceneUpdates?.bypass ?? {}) : {};
  const draftedNative =
    sceneUpdates?.session === session
      ? (sceneUpdates?.native_controls ?? {})
      : {};
  const draftedNativeBypass =
    sceneUpdates && sceneUpdates.session === session
      ? (sceneUpdates.native_bypass ?? {})
      : {};
  const changed = sceneMixChanged || settings.changed || nativeSettings.changed;
  const tooManySettings =
    settings.values().length + nativeSettings.values().length > 32;
  const withNativeSettings = (sceneId: string) => {
    const values = nativeSettings.values();
    return values.length
      ? { ...draftedNative, [sceneId]: values }
      : draftedNative;
  };
  const withSettings = (sceneId: string) => {
    const values = settings.values();
    return values.length
      ? { ...draftedControls, [sceneId]: values }
      : draftedControls;
  };
  const activeScene = state.control?.scenes?.scenes.find(
    (scene) => scene.id === state.control?.scene,
  );
  return (
    <>
      <SceneGrid rig={rig} vm={vm} open={gridOpen} onOpenChange={setGridOpen} />
      {state.control?.branch_sleep && (
        <SleepingBranches
          control={state.control}
          disabled={waiting}
          onChange={(enabled) => {
            const control = rig.current.current?.control;
            if (control?.branch_sleep)
              void rig.command({
                kind: 'branch_sleep',
                command: {
                  session: control.session,
                  expected_revision: control.revision,
                  enabled,
                },
              });
          }}
        />
      )}
      {!state.control?.branch_sleep &&
        !!state.control?.branches?.length &&
        rig.revision && (
          <PrepareSleepingBranches
            key={rig.revision}
            revision={rig.revision}
            disabled={waiting || !!pending || changed}
            prepare={() =>
              void rig.rebuild(({ opened, name }) => ({
                manifest_json: JSON.stringify({ ...opened.manifest, name }),
                resources: Object.fromEntries(
                  opened.manifest.resources.map((resource) => [
                    resource.id,
                    {
                      kind: 'bundle',
                      revision: opened.revision,
                      resource: resource.id,
                    },
                  ]),
                ),
                prepare_sleep_branches: true,
              }))
            }
          />
        )}
      {rig.sceneSharing.conflict && (
        <div
          role="alert"
          className="grid gap-2 rounded-lg border border-border p-3"
        >
          <p>
            Your scene draft is kept in this browser. Review the other viewer’s
            changes before replacing the shared draft.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() =>
                void rig.sceneSharing
                  .retry()
                  .catch(() =>
                    rig.setError(
                      'The shared scene draft is unavailable. Your draft is kept here.',
                    ),
                  )
              }
            >
              Share my draft
            </Button>
            <Button variant="outline" onClick={rig.sceneSharing.discard}>
              Use shared draft
            </Button>
          </div>
        </div>
      )}
      {!!state.control?.scenes?.scenes.length && (
        <ScenePads
          extra={
            <>
              <Button
                variant="outline"
                disabled={waiting || !matching}
                onClick={() => setGridOpen(true)}
              >
                Edit scenes
              </Button>
              {matching && (
                <SceneChange
                  preset={matching.manifest.id}
                  disabled={waiting}
                  trails={
                    matching.manifest.extensions['urn:oxidal:authoring']
                      ?.scene_tails === 'preserve'
                  }
                />
              )}
              {activeScene && (
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  aria-label={`Scene menu for ${activeScene.name}`}
                  aria-haspopup="dialog"
                  disabled={waiting}
                  onClick={() => setMenu(activeScene.id)}
                >
                  Scene ⋯
                </Button>
              )}
            </>
          }
          onMenu={setMenu}
          scenes={state.control.scenes.scenes}
          active={
            state.control.branch_sleep?.active_scene ??
            state.control.stomp_scene ??
            state.control.scene
          }
          canRecallActive={
            !!state.control.stomp_scene &&
            state.control.stomp_scene !== state.control.scene
          }
          fading={!!state.control.scene_transitioning}
          disabled={waiting}
          onSelect={(scene) => {
            const control = current.current?.control;
            if (control) {
              setSceneDraft({ session: control.session, scene });
              void recallScene(scene);
            }
          }}
        />
      )}
      {menu && (
        <SceneMenu
          rig={rig}
          vm={vm}
          sceneId={menu}
          onClose={() => setMenu(null)}
          onDone={setNotice}
        />
      )}
      {notice && (
        <Caption className="my-1" role="status">
          {notice}
        </Caption>
      )}
      {editingScene && (
        <details
          className="min-w-0 border-y border-border [&+details]:border-t-0 [&>[data-slot=caption]]:mx-1 [&>[data-slot=caption]]:mb-2.5 [&>summary]:min-w-0 [&>summary]:gap-2 [&>summary]:px-1 [&>summary>:first-child]:shrink-0 [&>summary>:first-child]:font-semibold"
          open={changed || pending > 0 || undefined}
        >
          <summary>
            <span>
              {sceneMixChanged ? 'Editing scene' : 'Current scene'} ·{' '}
              <strong>{editingScene.name}</strong>
            </span>
            {sceneMixChanged ? (
              <Badge>Modified mix</Badge>
            ) : drafts[editingScene.id] ? (
              <Badge>Updated · not saved</Badge>
            ) : (
              !!sceneMix.length && (
                <span className="min-w-0 truncate text-xs font-normal text-muted-foreground max-sm:hidden">
                  {sceneMix
                    .filter((branch) => branch.value !== 0)
                    .map(
                      (branch) =>
                        `${branch.name} ${Math.round(branch.value * 100)}%`,
                    )
                    .join(' · ') || 'All paths muted'}
                </span>
              )
            )}
          </summary>
          <Caption>
            {sceneMixChanged
              ? 'Path levels changed for this scene. Update scene keeps this mix in your edits; Save keeps it in the preset.'
              : 'A scene recalls the path levels shown here.'}{' '}
            Block controls are shared by every scene; use Save to keep those
            whole-preset edits.
          </Caption>
          {!!sceneMix.length && (
            <div
              className="flex flex-wrap gap-2 px-1 pb-3"
              aria-label="Scene mix"
            >
              {sceneMix.map((branch) => (
                <Badge
                  key={branch.name}
                  data-state={branch.value !== 0 ? 'active' : 'muted'}
                >
                  {branch.name} · {Math.round(branch.value * 100)}%
                </Badge>
              ))}
            </div>
          )}
          <SceneSettings settings={settings} />
          <NativeSceneSettings settings={nativeSettings} />
          {tooManySettings && (
            <p role="alert">
              Scenes can change at most 32 effect and capture settings together.
            </p>
          )}
          {changed && (
            <div className="flex flex-wrap items-center gap-2.5 px-1 pb-3 [&_[data-slot=caption]]:m-0">
              <Button
                variant="outline"
                disabled={waiting}
                onClick={() => void recallScene(editingScene.id)}
              >
                Discard changes
              </Button>
              <Button
                disabled={waiting}
                onClick={() => {
                  const session = state.control?.session;
                  if (!session || tooManySettings) return;
                  setSceneUpdates({
                    session,
                    gains: { ...drafts, [editingScene.id]: editingSceneGains },
                    added: addedScenes,
                    controls: withSettings(editingScene.id),
                    bypass: draftedBypass,
                    native_controls: withNativeSettings(editingScene.id),
                    native_bypass: draftedNativeBypass,
                  });
                  settings.reset();
                  nativeSettings.reset();
                }}
              >
                Update scene
              </Button>
              <Button
                variant="outline"
                disabled={waiting}
                onClick={() => setNamingScene('')}
              >
                Save as new scene…
              </Button>
            </div>
          )}
          {saveReview && (
            <AdjustmentDialog
              title="Save this preset?"
              onCancel={() => setSaveReview(false)}
            >
              <p>
                The mix you hear differs from {editingScene.name}. Choose what
                the preset keeps. Shared block settings are saved either way.
              </p>
              <div className="grid min-w-0 items-start gap-3 [&>button]:max-w-full [&>button]:justify-self-start">
                <Button
                  onClick={() =>
                    void saveScenes(
                      true,
                      withSettings(editingScene.id),
                      withNativeSettings(editingScene.id),
                    )
                  }
                >
                  Update {editingScene.name} and save
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setSaveReview(false);
                    setNamingScene('');
                  }}
                >
                  Save as new scene…
                </Button>
                <Button
                  variant="outline"
                  disabled={pending === 0}
                  onClick={() => void saveScenes(false)}
                >
                  Save without this mix
                </Button>
                <Button variant="ghost" onClick={() => setSaveReview(false)}>
                  Cancel
                </Button>
              </div>
            </AdjustmentDialog>
          )}
          {namingScene !== null && (
            <AdjustmentDialog
              title="Save as new scene"
              onCancel={() => setNamingScene(null)}
            >
              <form
                className="grid min-w-0 items-start gap-3 [&>button]:max-w-full [&>button]:justify-self-start"
                onSubmit={(event) => {
                  event.preventDefault();
                  const session = state.control?.session;
                  const label = namingScene.trim();
                  if (!session || !label) return;
                  const values = settings.values();
                  const nativeTargets = [
                    ...new Map(
                      [
                        ...(state.control?.scenes?.scenes[0]?.native_bypass ??
                          []),
                        ...Object.values(draftedNativeBypass).flat(),
                      ].map((row) => [nativeBypassKey(row), row]),
                    ).values(),
                  ];
                  const nativeNow = nativeTargets.map((row) => {
                    const live = state.control?.controls.find(
                      (control) =>
                        control.target.kind === 'native' &&
                        control.target.node === row.node &&
                        control.target.parameter ===
                          `block:${row.block}:enabled`,
                    );
                    return live && (live.value === 0 || live.value === 1)
                      ? { ...row, value: live.value === 0 }
                      : undefined;
                  });
                  if (nativeNow.some((row) => row === undefined)) {
                    setNotice(
                      'Current capture block states are unavailable. Your new-scene draft has been kept.',
                    );
                    return;
                  }
                  setSceneUpdates({
                    session,
                    gains: drafts,
                    controls: draftedControls,
                    bypass: draftedBypass,
                    native_controls: draftedNative,
                    native_bypass: draftedNativeBypass,
                    added: [
                      ...addedScenes,
                      {
                        id: `scene-${crypto.randomUUID().slice(0, 8)}`,
                        name: label,
                        gains: editingSceneGains,
                        bypass: state.control?.controls.flatMap((c) =>
                          c.target.kind === 'bypass'
                            ? [{ node: c.target.node, value: c.value === 1 }]
                            : [],
                        ),
                        ...(values.length ? { controls: values } : {}),
                        ...(nativeNow.length
                          ? {
                              native_bypass: nativeNow.filter(
                                (row) => row !== undefined,
                              ),
                            }
                          : {}),
                        ...(nativeSettings.values().length
                          ? { native_controls: nativeSettings.values() }
                          : {}),
                      },
                    ],
                  });
                  settings.reset();
                  setNamingScene(null);
                  nativeSettings.reset();
                }}
              >
                <FormField>
                  <span>Scene name</span>
                  <input
                    className="h-11 w-full rounded-md border border-input bg-card px-3"
                    value={namingScene}
                    maxLength={128}
                    autoFocus
                    onChange={(event) => setNamingScene(event.target.value)}
                  />
                </FormField>
                <Caption>
                  Keeps the mix you hear now as a new scene. {editingScene.name}{' '}
                  stays as it was. Save keeps it in the preset.
                </Caption>
                <ActionRow>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setNamingScene(null)}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" disabled={!namingScene.trim()}>
                    Add scene
                  </Button>
                </ActionRow>
              </form>
            </AdjustmentDialog>
          )}
          {(pending > 0 || changed) && (
            <div
              className="flex flex-wrap items-center gap-2.5 px-1 pb-3 [&_[data-slot=caption]]:m-0"
              aria-label="Scene edits"
            >
              <Caption as="span" role="status">
                {pending === 0
                  ? 'The mix you hear is not saved in a scene yet.'
                  : pending === 1
                    ? '1 scene updated · not saved yet.'
                    : `${pending} scenes updated · not saved yet.`}
                {addedScenes.length > 0 &&
                  ` New: ${addedScenes.map((scene) => scene.name).join(', ')}.`}
              </Caption>
              <Button
                variant="outline"
                disabled={waiting}
                onClick={() => {
                  setSceneUpdates(null);
                  void recallScene(editingScene.id);
                }}
              >
                Discard scene updates
              </Button>
              <Button
                disabled={waiting}
                onClick={() =>
                  changed ? setSaveReview(true) : void saveScenes(false)
                }
              >
                Save preset
              </Button>
            </div>
          )}
        </details>
      )}
    </>
  );
}
