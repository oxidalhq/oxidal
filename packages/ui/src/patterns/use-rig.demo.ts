import { useEffect, useState } from 'react';

import { blocksOf, insertStep, type ListPath } from '../lib/route';
import { applyScene } from '../lib/scene';
import type { BlockModel } from '../widgets/block-editor';
import type { SceneModel } from '../widgets/scene-editor';
import type { PresetVersion } from '../widgets/versions';
import { NEW_BLOCK, SCENES } from './rig.fixtures';
import type { RigRoute } from './rig-surface';

const SIMULATED_GAIN: Record<string, number> = {
  amp: 14,
  cab: -6,
  gate: 0,
  drive: 4,
  time: -1,
  mod: 0,
  lv2: 0,
  pedal: 4,
};

/**
 * State for the rig stories and the Rig screen: the edited route on top of
 * the saved version, versions, scenes, held-out block and a meter
 * simulation that follows the route (a held or bypassed block drops out).
 */
export function useRigDemo(initial: RigRoute, initialScenes?: SceneModel[]) {
  const [versions, setVersions] = useState<PresetVersion[]>([
    {
      id: 'default',
      name: 'Default',
      note: 'Saved at home · 12 Nov',
      isDefault: true,
    },
    {
      id: 'rehearsal',
      name: 'Rehearsal room',
      note: 'Saved at rehearsal · 14 Nov',
    },
  ]);
  const [current, setCurrent] = useState('default');
  const [savedBy, setSavedBy] = useState<Record<string, RigRoute>>({
    default: initial,
    rehearsal: initial,
  });
  const saved = savedBy[current] ?? initial;
  const [route, setRoute] = useState<RigRoute>(initial);
  const [scene, setScene] = useState<string | null>(SCENES[1]!.id);
  const [settings, setSettings] = useState(initialScenes);
  const [savedScenes, setSavedScenes] = useState<
    Record<string, SceneModel[] | undefined>
  >({});
  const [held, setHeld] = useState<string | null>(null);
  const [levels, setLevels] = useState<Record<string, number>>({});
  const [input, setInput] = useState(-24);

  useEffect(() => {
    const sounding = applyScene(
      route,
      settings?.find((s) => s.id === scene),
    );
    const timer = setInterval(() => {
      const base = -26 + Math.random() * 8;
      setInput(base);
      let level = base;
      const next: Record<string, number> = {};
      for (const block of blocksOf<BlockModel>(sounding)) {
        if (block.on && block.id !== held)
          level = Math.min(
            2,
            level +
              (SIMULATED_GAIN[block.kind] ?? 0) +
              (Math.random() - 0.5) * 2,
          );
        next[block.id] = level;
      }
      setLevels(next);
    }, 180);
    return () => clearInterval(timer);
  }, [route, held, settings, scene]);

  return {
    route,
    saved,
    settings,
    setSettings,
    savedSettings: savedScenes[current] ?? initialScenes,
    versions,
    current,
    scene,
    levels,
    input,
    sceneChanged:
      scene === 'c'
        ? ['echo', 'ts9']
        : scene === 'd'
          ? ['bloom', 'echo']
          : ['ts9'],
    onRoute: setRoute,
    onVersion: (id: string) => {
      setCurrent(id);
      setSettings(savedScenes[id] ?? initialScenes);
      setRoute(savedBy[id] ?? initial);
    },
    onSaveVersion: () => {
      setSavedBy((all) => ({ ...all, [current]: route }));
      setSavedScenes((all) => ({ ...all, [current]: settings }));
    },
    onSaveVersionAs: (name: string) => {
      const id = `v-${Date.now()}`;
      setVersions((all) => [...all, { id, name, note: 'Saved just now' }]);
      setSavedBy((all) => ({ ...all, [id]: route }));
      setSavedScenes((all) => ({ ...all, [id]: settings }));
      setCurrent(id);
    },
    onMakeDefault: (id: string) =>
      setVersions((all) => all.map((v) => ({ ...v, isDefault: v.id === id }))),
    onScene: setScene,
    onAudition: setHeld,
    onAdd: (path: ListPath, index: number) =>
      setRoute((r: RigRoute) => insertStep(r, path, index, NEW_BLOCK())),
  };
}
