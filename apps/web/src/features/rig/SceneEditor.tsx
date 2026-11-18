import { useState } from 'react';

import './SceneEditor.css';
import { AdjustmentDialog } from '../../AdjustmentDialog';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { SceneChange } from '../../SceneChange';
import { ScenePads } from '../../ScenePads';
import { rigBusy } from './mixedRigViewModel';
import { SceneSettings } from './SceneEditorControls';
import { SceneMenu } from './SceneEditorMenu';
import { useSceneSettings } from './SceneEditorSettings';
import type { RigViewProps } from './useMixedRigSession';

/**
 * Scene pads and the current-scene panel: mix, Update scene, Save as new
 * scene and the save review for presets with scenes.
 * @see docs/interface.md
 */
export function SceneEditor({ rig, vm }: RigViewProps) {
  const waiting = rigBusy(vm, rig);
  const [menu, setMenu] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const settings = useSceneSettings({ rig, vm });
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
  const controlOnly = Object.keys(draftedControls).filter(
    (id) => !drafts[id],
  ).length;
  const pending = draftCount + controlOnly;
  const changed = sceneMixChanged || settings.changed;
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
      {!!state.control?.scenes?.scenes.length && (
        <ScenePads
          extra={
            <>
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
                <button
                  type="button"
                  className="scene-change"
                  aria-label={`Scene menu for ${activeScene.name}`}
                  aria-haspopup="dialog"
                  disabled={waiting}
                  onClick={() => setMenu(activeScene.id)}
                >
                  Scene ⋯
                </button>
              )}
            </>
          }
          onMenu={setMenu}
          scenes={state.control.scenes.scenes}
          active={state.control.scene}
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
        <p className="caption scene-notice" role="status">
          {notice}
        </p>
      )}
      {editingScene && (
        <details
          className="scene-context"
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
                <span className="scene-context-mix">
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
          <p className="caption">
            {sceneMixChanged
              ? 'Path levels changed for this scene. Update scene keeps this mix in your edits; Save keeps it in the preset.'
              : 'A scene recalls the path levels shown here.'}{' '}
            Block controls are shared by every scene; use Save to keep those
            whole-preset edits.
          </p>
          {!!sceneMix.length && (
            <div className="scene-context-levels" aria-label="Scene mix">
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
          {changed && (
            <div className="scene-context-actions">
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
                  if (!session) return;
                  setSceneUpdates({
                    session,
                    gains: { ...drafts, [editingScene.id]: editingSceneGains },
                    added: addedScenes,
                    controls: withSettings(editingScene.id),
                  });
                  settings.reset();
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
              <div className="control-stack">
                <Button
                  onClick={() =>
                    void saveScenes(true, withSettings(editingScene.id))
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
                className="control-stack"
                onSubmit={(event) => {
                  event.preventDefault();
                  const session = state.control?.session;
                  const label = namingScene.trim();
                  if (!session || !label) return;
                  const values = settings.values();
                  setSceneUpdates({
                    session,
                    gains: drafts,
                    controls: draftedControls,
                    added: [
                      ...addedScenes,
                      {
                        id: `scene-${crypto.randomUUID().slice(0, 8)}`,
                        name: label,
                        gains: editingSceneGains,
                        ...(values.length ? { controls: values } : {}),
                      },
                    ],
                  });
                  settings.reset();
                  setNamingScene(null);
                }}
              >
                <label className="field">
                  <span>Scene name</span>
                  <input
                    className="h-11 w-full rounded-md border border-input bg-card px-3"
                    value={namingScene}
                    maxLength={128}
                    autoFocus
                    onChange={(event) => setNamingScene(event.target.value)}
                  />
                </label>
                <p className="caption">
                  Keeps the mix you hear now as a new scene. {editingScene.name}{' '}
                  stays as it was. Save keeps it in the preset.
                </p>
                <div className="action-row">
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
                </div>
              </form>
            </AdjustmentDialog>
          )}
          {(pending > 0 || changed) && (
            <div className="scene-context-actions" aria-label="Scene edits">
              <span className="caption" role="status">
                {pending === 0
                  ? 'The mix you hear is not saved in a scene yet.'
                  : pending === 1
                    ? '1 scene updated · not saved yet.'
                    : `${pending} scenes updated · not saved yet.`}
                {addedScenes.length > 0 &&
                  ` New: ${addedScenes.map((scene) => scene.name).join(', ')}.`}
              </span>
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
