import type { useNativeSceneSettings } from './SceneNativeSettingsState';
import { SceneSettingsList } from './SceneSettingsList';

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
      <SceneSettingsList
        title="Capture settings in scenes"
        help="Tick a changed setting to keep it per scene. Capture gain and mix glide over 50 ms."
        rows={settings.offered.map((s) => ({
          key: s.key,
          label: s.label,
          display: s.display,
          inScenes: s.inScenes,
          changed: s.changed,
          checked: s.inScenes || settings.chosen.has(s.key),
          onToggle: () => settings.toggle(s.key),
        }))}
      />
    </>
  );
}
