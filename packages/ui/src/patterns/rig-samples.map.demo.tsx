import { type ReactNode, useState } from 'react';

import { useChainCanvasControl } from '../lib/chain-canvas-control';
import type { ChainGraph } from '../lib/chain-graph';
import type { Step } from '../lib/route';
import { routeGraph } from '../lib/route-graph';
import { ChainCanvas } from '../widgets/chain-canvas';
import type { ResourceReadings } from '../widgets/resource-strip';
import { ChainWorkspace } from './chain-workspace';
import {
  ALL_BLOCKS,
  CHAIN,
  PRESETS,
  type RigSample,
  type SampleBlock,
} from './rig-samples.data';
import { PresetRow, type RigDestination, RigTopBar } from './rig-top-bar';

/**
 * The Layout A samples' chain as a map with the chain bar, and the approved
 * top (dark top bar and slim preset row). Design samples with fixed example
 * data; nothing is saved.
 */

type Named = SampleBlock & { label: string };
const named = (b: SampleBlock): Named => ({ ...b, label: b.name });

/** The sample chain as a route: Boost, the amp, Swell beside a dry path, Motion, Bloom. */
const ROUTE: Step<Named>[] = CHAIN.map((item) =>
  item.kind === 'block'
    ? named(item.block)
    : {
        split: true as const,
        id: 'split',
        branches: item.lanes.map((lane) => (lane ? [named(lane)] : [])),
      },
);
const SAMPLE_GRAPH = routeGraph(ROUTE, (b) => b.glyph);

/** The chain map above, the chain bar, and the panel (children) under it. */
export function SampleWorkspace({
  rig,
  graph = SAMPLE_GRAPH.graph,
  lanes = SAMPLE_GRAPH.lanes,
  badges,
  card,
  children,
}: {
  rig: Pick<RigSample, 'selected' | 'setSelected' | 'isOn'>;
  graph?: ChainGraph;
  lanes?: string[];
  /** Which stomp switch controls a block, said on its card. */
  badges?: Record<string, string>;
  /** What a block's card shows; by default its category and main control. */
  card?: Parameters<typeof ChainCanvas>[0]['card'];
  children: ReactNode;
}) {
  const canvas = useChainCanvasControl();
  const selected = ALL_BLOCKS.find((b) => b.id === rig.selected);
  return (
    <ChainWorkspace
      canvas={canvas}
      selected={
        selected ? { name: selected.name, on: rig.isOn(selected.id) } : null
      }
      chain={
        <ChainCanvas
          toolbar="none"
          control={canvas}
          graph={graph}
          selected={rig.selected}
          onSelect={rig.setSelected}
          laneLabel={(lane) => lanes[lane] ?? `Path ${lane + 1}`}
          card={
            card ??
            ((id) => {
              const b = ALL_BLOCKS.find((x) => x.id === id);
              if (!b) return undefined;
              return {
                caption: badges?.[id]
                  ? `${badges[id]} · ${b.caption}`
                  : b.caption,
                kind: b.led,
                on: rig.isOn(id),
                preview: b.main,
              };
            })
          }
        />
      }
    >
      {children}
    </ChainWorkspace>
  );
}

const READINGS: ResourceReadings = {
  dsp: { p95: 0.21, peak: 0.34 },
  cpu: 18,
  ram: { used: 820, total: 8064 },
  xruns: 0,
  clips: 0,
  temperature: 52,
};

/** The approved top: the dark top bar, then the slim preset row. */
export function SampleTop({ preset = 0 }: { preset?: number }) {
  const [where, setWhere] = useState<RigDestination>('rig');
  const [at, setAt] = useState(preset);
  const [muted, setMuted] = useState(false);
  const [locked, setLocked] = useState(false);
  const name = PRESETS[at]!;
  return (
    <>
      <RigTopBar
        destination={where}
        onNavigate={setWhere}
        levels={{ input: [-14, -16], output: [-9, -10] }}
        readings={READINGS}
      />
      <PresetRow
        name={name}
        shortName={name.replace(/^Oxidal · /, '')}
        presets={PRESETS}
        onPick={(p) => setAt(PRESETS.indexOf(p))}
        previousName={PRESETS[at - 1]}
        nextName={PRESETS[at + 1]}
        onPrevious={at > 0 ? () => setAt(at - 1) : undefined}
        onNext={at < PRESETS.length - 1 ? () => setAt(at + 1) : undefined}
        muted={muted}
        onMute={setMuted}
        onSearch={() => undefined}
        onTuner={() => undefined}
        onPerform={() => undefined}
        protectedPreset={locked}
        onProtect={setLocked}
        onStopAudio={() => undefined}
      />
    </>
  );
}
