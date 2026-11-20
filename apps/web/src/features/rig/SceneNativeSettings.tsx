import { Checkbox } from '@oxidal/design-system/components/checkbox';

import type { useNativeSceneSettings } from './SceneNativeSettingsState';

export function NativeSceneSettings({
  settings,
}: {
  settings: ReturnType<typeof useNativeSceneSettings>;
}) {
  const warning = settings.missingDefaults && (
    <p className="text-sm text-muted-foreground">
      Saved capture values are unavailable. Save and reopen the capture before
      adding its scene settings.
    </p>
  );
  if (!settings.offered.length) return warning || null;
  return (
    <>
      {warning}
      <fieldset className="scene-settings">
        <legend>Capture settings in scenes</legend>
        <p className="caption">
          Tick a changed setting to keep it per scene. Capture gain and mix
          glide over 50 ms.
        </p>
        <ul>
          {settings.offered.map((s) => (
            <li key={s.key}>
              <label>
                <Checkbox
                  checked={s.inScenes || settings.chosen.has(s.key)}
                  disabled={s.inScenes}
                  onCheckedChange={() => settings.toggle(s.key)}
                />
                <span>
                  {s.label} {s.display}
                  <span className="caption">
                    {s.inScenes ? ' · in every scene' : ''}
                    {s.changed ? ' · changed' : ''}
                  </span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      </fieldset>
    </>
  );
}
