import { Checkbox } from '../../components/ui/checkbox';
import { MAX_SCENE_CONTROLS } from '../../sceneEdit';
import type { useSceneSettings } from './SceneEditorSettings';

const key = (c: { node: string; symbol: string }) => `${c.node}:${c.symbol}`;

/** The list under the scene: tick a changed setting to keep it per scene. */
export function SceneSettings({
  settings,
}: {
  settings: ReturnType<typeof useSceneSettings>;
}) {
  if (!settings.offered.length) return null;
  return (
    <fieldset className="scene-settings">
      <legend>Effect settings in scenes</legend>
      <p className="caption">
        Ticked settings are kept by every scene. Others stay shared by the whole
        preset.
      </p>
      <ul>
        {settings.offered.map((s) => (
          <li key={key(s)}>
            <label>
              <Checkbox
                checked={s.inScenes || settings.chosen.has(key(s))}
                disabled={s.inScenes}
                onChange={() => settings.toggle(s)}
              />
              <span>
                {s.label} {s.display}
                <span className="caption">
                  {' '}
                  · {s.stepped ? 'switches when silent' : 'glides'}
                  {s.inScenes ? ' · in every scene' : ''}
                  {s.changed ? ' · changed' : ''}
                </span>
              </span>
            </label>
          </li>
        ))}
      </ul>
      {settings.tooMany && (
        <p role="alert">
          Scenes can change at most {MAX_SCENE_CONTROLS} effect settings.
        </p>
      )}
    </fieldset>
  );
}
