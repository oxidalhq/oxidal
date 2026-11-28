import { MAX_SCENE_CONTROLS } from '../../sceneEdit';
import type { useSceneSettings } from './SceneEditorSettings';
import { SceneSettingsList } from './SceneSettingsList';

const key = (c: { node: string; symbol: string }) => `${c.node}:${c.symbol}`;

/** The effect settings a scene can keep: tick a changed setting to keep it per scene. */
export function SceneSettings({
  settings,
}: {
  settings: ReturnType<typeof useSceneSettings>;
}) {
  if (!settings.offered.length) return null;
  return (
    <>
      <SceneSettingsList
        title="Effect settings in scenes"
        help="Ticked settings are kept by every scene. Others stay shared by the whole preset."
        rows={settings.offered.map((s) => ({
          key: key(s),
          label: s.label,
          display: s.display,
          how: s.stepped ? 'Switches when silent' : 'Glides',
          inScenes: s.inScenes,
          changed: s.changed,
          checked: s.inScenes || settings.chosen.has(key(s)),
          onToggle: () => settings.toggle(s),
        }))}
      />
      {settings.tooMany && (
        <p role="alert">
          Scenes can change at most {MAX_SCENE_CONTROLS} effect settings.
        </p>
      )}
    </>
  );
}
