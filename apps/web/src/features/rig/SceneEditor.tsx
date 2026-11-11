import { AdjustmentDialog } from '../../AdjustmentDialog';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { SceneChange } from '../../SceneChange';
import { ScenePads } from '../../ScenePads';
import type { RigViewProps } from './useMixedRigSession';

/**
 * Scene pads and the current-scene panel: mix, Update scene, Save as new
 * scene and the save review for presets with scenes.
 * @see docs/interface.md
 */
export function SceneEditor({ rig, vm }: RigViewProps) {
  const {
    busy,
    current,
    edit,
    editing,
    matching,
    namingScene,
    picker,
    recallScene,
    saveReview,
    saveScenes,
    setNamingScene,
    setSaveReview,
    setSceneDraft,
    setSceneUpdates,
  } = rig;
  const {
    addedScenes,
    disabled,
    draftCount,
    drafts,
    editingScene,
    editingSceneGains,
    sceneMix,
    sceneMixChanged,
    state,
  } = vm;
  return (
    <>
      {!!state.control?.scenes?.scenes.length && (
        <ScenePads
          extra={
            matching && (
              <SceneChange
                preset={matching.manifest.id}
                disabled={disabled}
                trails={
                  matching.manifest.extensions['urn:oxidal:authoring']
                    ?.scene_tails === 'preserve'
                }
              />
            )
          }
          scenes={state.control.scenes.scenes}
          active={state.control.scene}
          fading={!!state.control.scene_transitioning}
          disabled={disabled || !!edit}
          onSelect={(scene) => {
            const control = current.current?.control;
            if (control) {
              setSceneDraft({ session: control.session, scene });
              void recallScene(scene);
            }
          }}
        />
      )}
      {editingScene && (
        <details
          className="scene-context"
          open={sceneMixChanged || draftCount > 0 || undefined}
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
                    .join(' · ') || 'All branches muted'}
                </span>
              )
            )}
          </summary>
          <p className="caption">
            {sceneMixChanged
              ? 'Branch routing changed for this scene. Update scene keeps this mix in your edits; Save keeps it in the preset.'
              : 'A scene recalls the branch levels shown here.'}{' '}
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
          {sceneMixChanged && (
            <div className="scene-context-actions">
              <Button
                variant="outline"
                disabled={disabled || editing || !!edit || !!picker || busy}
                onClick={() => void recallScene(editingScene.id)}
              >
                Discard changes
              </Button>
              <Button
                disabled={disabled || editing || !!edit || !!picker}
                onClick={() => {
                  const session = state.control?.session;
                  if (!session) return;
                  setSceneUpdates({
                    session,
                    gains: { ...drafts, [editingScene.id]: editingSceneGains },
                    added: addedScenes,
                  });
                }}
              >
                Update scene
              </Button>
              <Button
                variant="outline"
                disabled={disabled || editing || !!edit || !!picker}
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
                <Button onClick={() => void saveScenes(true)}>
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
                  disabled={draftCount === 0}
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
                  setSceneUpdates({
                    session,
                    gains: drafts,
                    added: [
                      ...addedScenes,
                      {
                        id: `scene-${crypto.randomUUID().slice(0, 8)}`,
                        name: label,
                        gains: editingSceneGains,
                      },
                    ],
                  });
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
          {(draftCount > 0 || sceneMixChanged) && (
            <div className="scene-context-actions" aria-label="Scene edits">
              <span className="caption" role="status">
                {draftCount === 0
                  ? 'The mix you hear is not saved in a scene yet.'
                  : draftCount === 1
                    ? '1 scene updated · not saved yet.'
                    : `${draftCount} scenes updated · not saved yet.`}
                {addedScenes.length > 0 &&
                  ` New: ${addedScenes.map((scene) => scene.name).join(', ')}.`}
              </span>
              <Button
                variant="outline"
                disabled={disabled || editing || !!edit || !!picker || busy}
                onClick={() => {
                  setSceneUpdates(null);
                  void recallScene(editingScene.id);
                }}
              >
                Discard scene updates
              </Button>
              <Button
                disabled={disabled || editing || !!edit || !!picker}
                onClick={() =>
                  sceneMixChanged ? setSaveReview(true) : void saveScenes(false)
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
