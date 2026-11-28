import { useState } from 'react';

import type { ResourceReadings } from '../widgets/resource-strip';
import type { BarLevels } from './display-bar';
import { ChainBarRigSample } from './rig-chain-bar.demo';
import { PRESETS } from './rig-samples.data';
import {
  PresetRow,
  RigBottomTabs,
  type RigDestination,
  RigTopBar,
} from './rig-top-bar';

/**
 * The Rig with its top split by job: the dark top bar (menu, peaks, health),
 * the slim preset row, then the chain, the chain bar with its editing tools
 * and the panel. Design sample with fixed example data; nothing is saved.
 */

const LEVELS: BarLevels = { input: [-14, -16], output: [-9, -10] };
const READINGS: ResourceReadings = {
  dsp: { p95: 0.21, peak: 0.34 },
  cpu: 18,
  ram: { used: 820, total: 8064 },
  xruns: 0,
  clips: 0,
  temperature: 52,
};

export function TopBarRigSample({
  edits = 'edited',
  collapsed = false,
}: {
  edits?: 'unchanged' | 'edited';
  collapsed?: boolean;
}) {
  const [destination, setDestination] = useState<RigDestination>('rig');
  const [preset, setPreset] = useState(0);
  const [muted, setMuted] = useState(false);
  const [protectedPreset, setProtected] = useState(false);
  const step = (by: number) =>
    setPreset((p) => (p + by + PRESETS.length) % PRESETS.length);
  return (
    <ChainBarRigSample
      edits={edits}
      collapsed={collapsed}
      header={({ changed, discard }) => (
        <>
          <RigTopBar
            destination={destination}
            onNavigate={setDestination}
            levels={LEVELS}
            readings={READINGS}
          />
          <PresetRow
            name={PRESETS[preset]!}
            shortName={PRESETS[preset]!.replace(/^Oxidal · /, '')}
            presets={PRESETS}
            onPick={(name) => setPreset(PRESETS.indexOf(name))}
            onPrevious={() => step(-1)}
            onNext={() => step(1)}
            muted={muted}
            onMute={setMuted}
            onSearch={() => undefined}
            onTuner={() => undefined}
            onPerform={() => undefined}
            protectedPreset={protectedPreset}
            onProtect={setProtected}
            onStopAudio={() => undefined}
            onDiscard={changed ? discard : undefined}
          />
        </>
      )}
      footer={
        <RigBottomTabs destination={destination} onNavigate={setDestination} />
      }
    />
  );
}
