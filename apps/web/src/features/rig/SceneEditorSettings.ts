import { useEffect, useMemo, useState } from 'react';
import { installedLv2, type Lv2Plugin, type RigControl } from '../../api';
import {
  MAX_SCENE_CONTROLS,
  blockLabel,
  type SceneControl,
} from '../../sceneEdit';
import type { RigViewProps } from './useMixedRigSession';

const key = (c: { node: string; symbol: string }) => `${c.node}:${c.symbol}`;

export type SceneSetting = {
  node: string;
  symbol: string;
  label: string;
  value: number;
  display: string;
  /** Integer, toggle or named values: changes while the scene is silent. */
  stepped: boolean;
  /** Already set by every scene of this preset. */
  inScenes: boolean;
  /** Differs from what this scene keeps now. */
  changed: boolean;
};

/**
 * Effect settings scenes can change (D-6). Every scene of a preset sets the
 * same controls; the player chooses which changed controls join them. Only
 * scalar input controls of effects without a latency port are offered.
 * @see docs/lv2.md
 */
export function useSceneSettings({ rig, vm }: RigViewProps) {
  const [plugins, setPlugins] = useState<Lv2Plugin[] | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const rate = vm.state.configured?.stream?.input?.sample_rate ?? 48000;
  const scene = vm.editingScene;
  useEffect(() => {
    if (!scene || plugins) return;
    let alive = true;
    void Promise.resolve()
      .then(() => installedLv2(rate))
      .then((list) => alive && setPlugins(list ?? []))
      .catch(() => alive && setPlugins([]));
    return () => {
      alive = false;
    };
  }, [scene, plugins, rate]);
  const session = vm.state.control?.session;
  const drafted =
    scene && rig.sceneUpdates?.session === session
      ? rig.sceneUpdates?.controls?.[scene.id]
      : undefined;
  const settings = useMemo<SceneSetting[]>(() => {
    if (!scene || !plugins) return [];
    const manifest = rig.matching?.manifest;
    const shape = vm.state.control?.scenes?.scenes[0]?.controls?.map(key) ?? [];
    const own = new Map(
      (drafted ?? scene.controls ?? []).map((c) => [key(c), c.value]),
    );
    return (vm.state.control?.controls ?? []).flatMap((control: RigControl) => {
      const target = control.target;
      if (target.kind !== 'lv2') return [];
      const uri = manifest?.oxidal?.lv2.find(
        (l) => l.id === target.node,
      )?.pluginUri;
      const plugin = plugins.find((p) => p.uri === uri);
      if (!plugin || plugin.ports.some((p) => p.latency)) return [];
      const port = plugin.ports.find((p) => p.symbol === target.symbol);
      if (!port || !port.control || !port.input || port.atom) return [];
      const k = key(target);
      const reference =
        own.get(k) ??
        manifest?.oxidal?.lv2.find((l) => l.id === target.node)?.controls[
          target.symbol
        ] ??
        port.default ??
        control.value;
      return [
        {
          node: target.node,
          symbol: target.symbol,
          label: manifest
            ? `${blockLabel(manifest, target.node)} · ${control.label}`
            : control.label,
          value: control.value,
          display: control.display,
          stepped:
            control.integer || control.toggle || !!control.scale_points?.length,
          inScenes: shape.includes(k),
          changed: Math.abs(control.value - reference) > 1e-6,
        },
      ];
    });
  }, [scene, plugins, drafted, rig.matching, vm.state.control]);
  const offered = settings.filter((s) => s.inScenes || s.changed);
  const included = settings.filter((s) => s.inScenes || chosen.has(key(s)));
  return {
    /** Settings shown: those in every scene, and any changed one. */
    offered,
    chosen,
    toggle(setting: SceneSetting) {
      setChosen((old) => {
        const next = new Set(old);
        if (next.has(key(setting))) next.delete(key(setting));
        else next.add(key(setting));
        return next;
      });
    },
    /** Something this scene would keep differently from now. */
    changed: settings.some(
      (s) => s.changed && (s.inScenes || chosen.has(key(s))),
    ),
    tooMany: included.length > MAX_SCENE_CONTROLS,
    /** The values this scene keeps, for Update scene or Save as new scene. */
    values(): SceneControl[] {
      return included.map(({ node, symbol, value }) => ({
        node,
        symbol,
        value,
      }));
    },
    reset: () => setChosen(new Set()),
  };
}
