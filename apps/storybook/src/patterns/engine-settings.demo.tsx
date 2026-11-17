import * as React from 'react';
import {
  BuiltInEffects,
  NamEngineSettings,
  PluginPacks,
  type NamEngine,
  type Pack,
} from './engine-settings';
import {
  ENGINE_EFFECTS,
  NAM_ENGINE,
  OWN_EFFECTS,
  PACKS,
} from './engine-settings.data';

export const BuiltInEffectsDemo = () => (
  <BuiltInEffects own={OWN_EFFECTS} engine={ENGINE_EFFECTS} />
);

/** Stands in for the device: installs in a moment; removing clears its users. */
export function PluginPacksDemo({ playing = false }: { playing?: boolean }) {
  const [packs, setPacks] = React.useState<Pack[]>(PACKS);
  const [job, setJob] = React.useState<{ id: string; progress: number }>();
  const timer = React.useRef<ReturnType<typeof setInterval> | null>(null);
  React.useEffect(
    () => () => void (timer.current && clearInterval(timer.current)),
    [],
  );
  return (
    <PluginPacks
      packs={packs}
      job={job}
      playing={playing}
      onInstall={(pack) => {
        let progress = 0;
        setJob({ id: pack.id, progress });
        timer.current = setInterval(() => {
          progress += 20;
          if (progress <= 100) return setJob({ id: pack.id, progress });
          if (timer.current) clearInterval(timer.current);
          setJob(undefined);
          setPacks((all) =>
            all.map((p) => (p.id === pack.id ? { ...p, installed: true } : p)),
          );
        }, 150);
      }}
      onRemove={(pack) =>
        setPacks((all) =>
          all.map((p) =>
            p.id === pack.id ? { ...p, installed: false, usedBy: [] } : p,
          ),
        )
      }
    />
  );
}

export function NamEngineDemo() {
  const [value, setValue] = React.useState<NamEngine>(NAM_ENGINE);
  return (
    <NamEngineSettings
      value={value}
      onChange={(change) => setValue((v) => ({ ...v, ...change }))}
    />
  );
}
