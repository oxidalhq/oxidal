import { useState } from 'react';

import type { SceneNativeControl } from '../../generated/contract';
import { blockLabel } from '../../sceneEdit';
import { isCaptureParameter, nativeSceneKey } from '../../sceneNative';
import type { RigViewProps } from './useMixedRigSession';

/** Capture settings with a verified saved baseline; unknown defaults are never inferred. */
export function useNativeSceneSettings({ rig, vm }: RigViewProps) {
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const scene = vm.editingScene;
  const control = vm.state.control;
  const defaults = new Map(
    control?.capture_defaults?.map((c) => [nativeSceneKey(c), c.value]),
  );
  const drafted =
    rig.sceneUpdates?.session === control?.session && scene
      ? rig.sceneUpdates?.native_controls?.[scene.id]
      : undefined;
  const own = new Map(
    (drafted ?? scene?.native_controls ?? []).map((c) => [
      nativeSceneKey(c),
      c.value,
    ]),
  );
  const shape = new Set(
    control?.scenes?.scenes[0]?.native_controls?.map(nativeSceneKey),
  );
  const settings = (control?.controls ?? []).flatMap((c) => {
    if (c.target.kind !== 'native' || !isCaptureParameter(c.target.parameter))
      return [];
    const target = c.target;
    const key = nativeSceneKey(target);
    if (!defaults.has(key) && !shape.has(key)) return [];
    const reference = own.get(key) ?? defaults.get(key);
    return [
      {
        node: target.node,
        parameter: target.parameter,
        value: c.value,
        key,
        label: `${rig.matching ? blockLabel(rig.matching.manifest, target.node) : target.node} · ${c.label}`,
        display: c.display,
        inScenes: shape.has(key),
        changed:
          reference !== undefined && Math.abs(c.value - reference) > 1e-6,
      },
    ];
  });
  const included = settings.filter((s) => s.inScenes || chosen.has(s.key));
  return {
    offered: settings.filter((s) => s.inScenes || s.changed),
    missingDefaults:
      !!scene &&
      (control?.controls.some(
        (c) =>
          c.target.kind === 'native' &&
          isCaptureParameter(c.target.parameter) &&
          !defaults.has(nativeSceneKey(c.target)) &&
          !shape.has(nativeSceneKey(c.target)),
      ) ??
        false),
    chosen,
    toggle(key: string) {
      setChosen((previous) => {
        const next = new Set(previous);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      });
    },
    changed: included.some((s) => s.changed),
    values: (): SceneNativeControl[] =>
      included.map(({ node, parameter, value }) => ({
        node,
        parameter,
        value,
      })),
    reset: () => setChosen(new Set()),
  };
}
