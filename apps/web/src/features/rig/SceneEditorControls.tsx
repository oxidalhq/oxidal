import { Checkbox } from '@oxidal/design-system/components/checkbox';

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
    <fieldset className="my-2 grid gap-1.5">
      <legend className="font-semibold">Effect settings in scenes</legend>
      <p className="caption">
        Ticked settings are kept by every scene. Others stay shared by the whole
        preset.
      </p>
      <ul className="grid gap-1">
        {settings.offered.map((s) => (
          <li key={key(s)}>
            <label className="flex min-h-touch items-center gap-2">
              <Checkbox
                checked={s.inScenes || settings.chosen.has(key(s))}
                disabled={s.inScenes}
                onCheckedChange={() => settings.toggle(s)}
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
