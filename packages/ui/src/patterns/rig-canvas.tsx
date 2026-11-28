import { ListNumbers, MusicNotes, SidebarSimple } from '@phosphor-icons/react';
import { type ReactNode, useState } from 'react';

import { Button } from '../components/ui/button';
import { Slider } from '../components/ui/slider';
import { Switch } from '../components/ui/switch';
import { Eyebrow } from '../components/ui/text';
import type { GlyphKey } from '../lib/block-glyphs';
import { useChainCanvasControl } from '../lib/chain-canvas-control';
import {
  branchBlock,
  type ChainGraph,
  type GraphNode,
  insertBlock,
  moveBlock,
} from '../lib/chain-graph';
import { cn } from '../lib/cn';
import { BlockGlyph } from '../widgets/block-glyph';
import { type CanvasChoice, ChainCanvas } from '../widgets/chain-canvas';
import { ChainWorkspace } from './chain-workspace';
import { SCENES, useRigSample } from './rig-samples.data';
import { SampleTop } from './rig-samples.map.demo';
import {
  BackingPanel,
  MiniRail,
  PresetsPanel,
  SceneTabs,
} from './rig-samples.parts';

/**
 * Layout A with the chain canvas: seven parallel paths, or two that simply
 * fit. Design sample: fixed example data, nothing is saved.
 */

const AMPS = [
  'Plexi 50',
  'JCM 800',
  'AC30 top boost',
  'Twin clean',
  'B15 bass',
  'Super Reverb',
  '5150 lead',
];
const CABS = [
  '4×12 Greenback',
  '4×12 V30',
  '2×12 Blue',
  '1×12 Tweed',
  '8×10 Ampeg',
  '4×10 Bassman',
  '4×12 Mesa',
];
const FX: [GlyphKey, string][] = [
  ['od', 'Overdrive'],
  ['comp', 'Compressor'],
  ['chorus', 'Chorus'],
  ['delay', 'Delay'],
  ['phaser', 'Phaser'],
  ['wah', 'Wah'],
  ['boost', 'Boost'],
];

const CHOICES: CanvasChoice[] = [
  { glyph: 'amp', name: 'Amp' },
  { glyph: 'cab', name: 'Cab' },
  { glyph: 'boost', name: 'Boost' },
  { glyph: 'od', name: 'Overdrive' },
  { glyph: 'dist', name: 'Distortion' },
  { glyph: 'comp', name: 'Compressor' },
  { glyph: 'gate', name: 'Gate' },
  { glyph: 'chorus', name: 'Chorus' },
  { glyph: 'phaser', name: 'Phaser' },
  { glyph: 'trem', name: 'Tremolo' },
  { glyph: 'delay', name: 'Delay' },
  { glyph: 'reverb', name: 'Reverb' },
  { glyph: 'wah', name: 'Wah' },
  { glyph: 'peq', name: 'EQ' },
  { glyph: 'pitch', name: 'Pitch' },
];

/** A serial start, a split into `lanes` paths of three blocks, a join, and a serial end. */
function buildRig(lanes: number): ChainGraph {
  const mid = (lanes - 1) / 2;
  const nodes: GraphNode[] = [
    { id: 'in', kind: 'cap', name: 'IN', col: 0, row: mid },
    {
      id: 'gate',
      kind: 'block',
      glyph: 'gate',
      name: 'Gate',
      col: 1,
      row: mid,
    },
    {
      id: 'boost',
      kind: 'block',
      glyph: 'boost',
      name: 'Boost',
      col: 2,
      row: mid,
    },
  ];
  const edges: ChainGraph['edges'] = [
    ['in', 'gate'],
    ['gate', 'boost'],
  ];
  for (let l = 0; l < lanes; l++) {
    const fx = FX[l % 7]!;
    nodes.push(
      {
        id: `a${l}`,
        kind: 'block',
        glyph: 'amp',
        name: AMPS[l % 7]!,
        col: 3,
        row: l,
        lane: l,
      },
      {
        id: `c${l}`,
        kind: 'block',
        glyph: 'cab',
        name: CABS[l % 7]!,
        col: 4,
        row: l,
        lane: l,
      },
      {
        id: `f${l}`,
        kind: 'block',
        glyph: fx[0],
        name: fx[1],
        col: 5,
        row: l,
        lane: l,
      },
    );
    edges.push(
      ['boost', `a${l}`],
      [`a${l}`, `c${l}`],
      [`c${l}`, `f${l}`],
      [`f${l}`, 'join'],
    );
  }
  nodes.push(
    { id: 'join', kind: 'cap', name: 'Σ', col: 6, row: mid },
    {
      id: 'motion',
      kind: 'block',
      glyph: 'trem',
      name: 'Motion',
      col: 7,
      row: mid,
    },
    {
      id: 'bloom',
      kind: 'block',
      glyph: 'reverb',
      name: 'Bloom',
      col: 8,
      row: mid,
    },
    { id: 'out', kind: 'cap', name: 'OUT', col: 9, row: mid },
  );
  edges.push(['join', 'motion'], ['motion', 'bloom'], ['bloom', 'out']);
  return { nodes, edges };
}

function BigEditor({
  node,
  lanes,
  scene,
}: {
  node: GraphNode | undefined;
  lanes: number;
  scene: number;
}) {
  if (!node || node.kind !== 'block')
    return (
      <p className="p-6 text-sm text-muted-foreground">
        Select a block to edit it. The chain moves to show it.
      </p>
    );
  return (
    <div className="grid gap-3 p-4">
      <div className="flex items-center gap-3">
        <BlockGlyph glyph={node.glyph!} className="size-6" />
        <div>
          <Eyebrow>
            Scene {scene + 1} · {SCENES[scene]}
            {node.lane !== undefined && ` · Path ${node.lane + 1} of ${lanes}`}
          </Eyebrow>
          <p className="font-serif text-lg font-semibold">{node.name}</p>
        </div>
        <Switch
          defaultChecked
          className="ml-auto"
          aria-label="On in this scene"
        />
      </div>
      <div className="grid grid-cols-5 gap-x-6">
        {['Input', 'Bass', 'Mid', 'Treble', 'Output'].map((l) => (
          <Slider
            key={`${node.id}${l}`}
            label={l}
            min={-12}
            max={12}
            step={0.5}
            defaultValue={[0]}
          />
        ))}
      </div>
    </div>
  );
}

function Rail({
  title,
  side,
  onMin,
  children,
}: {
  title: string;
  side: 'left' | 'right';
  onMin: () => void;
  children: ReactNode;
}) {
  return (
    <aside
      aria-label={title}
      className={cn(
        'flex w-72 shrink-0 flex-col border-border bg-background',
        side === 'left' ? 'border-r' : 'border-l',
      )}
    >
      <div className="flex items-center justify-between border-b border-border px-3 py-1">
        <Eyebrow>{title}</Eyebrow>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onMin}
          aria-label={`Minimise ${title}`}
        >
          <SidebarSimple mirrored={side === 'right'} />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </aside>
  );
}

export function CanvasRigSample({ lanes = 7 }: { lanes?: number }) {
  const rig = useRigSample(null);
  const [graph, setGraph] = useState(() => buildRig(lanes));
  const [sel, setSel] = useState<string | null>(null);
  const [left, setLeft] = useState(false);
  const [right, setRight] = useState(false);
  const [muted, setMuted] = useState<Record<number, boolean>>({});
  const [solo, setSolo] = useState<Record<number, boolean>>({});
  const id = () => `n${Date.now()}`;
  const canvas = useChainCanvasControl();
  const picked = graph.nodes.find((n) => n.id === sel);
  const laneCount = new Set(
    graph.nodes.filter((n) => n.lane !== undefined).map((n) => n.lane),
  ).size;
  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <SampleTop />
      <div className="flex min-h-0 flex-1">
        {left ? (
          <Rail
            title="Presets and set list"
            side="left"
            onMin={() => setLeft(false)}
          >
            <PresetsPanel />
          </Rail>
        ) : (
          <MiniRail
            icons={[<ListNumbers key="l" className="size-5" />]}
            status={['3/5']}
            onOpen={() => setLeft(true)}
          />
        )}
        <main className="flex min-w-0 flex-1 flex-col">
          <ChainWorkspace
            canvas={canvas}
            selected={picked ? { name: picked.name, on: true } : null}
            chain={
              <ChainCanvas
                toolbar="none"
                control={canvas}
                graph={graph}
                selected={sel}
                onSelect={setSel}
                choices={CHOICES}
                onInsert={(edge, c) => {
                  const n = id();
                  setGraph((g) => insertBlock(g, edge, c, n));
                  setSel(n);
                }}
                onBranch={(edge, c) => {
                  const n = id();
                  setGraph((g) => branchBlock(g, edge, c, n));
                  setSel(n);
                }}
                onMove={(block, edge) =>
                  setGraph((g) => moveBlock(g, block, edge))
                }
                muted={muted}
                solo={solo}
                onToggleMute={(l) => setMuted((m) => ({ ...m, [l]: !m[l] }))}
                onToggleSolo={(l) => setSolo((m) => ({ ...m, [l]: !m[l] }))}
              />
            }
          >
            <SceneTabs
              rig={rig}
              className="mt-2 border-b border-border px-4 [&_[role=tab]]:-mb-px"
            />
            <section className="bg-card">
              <BigEditor node={picked} lanes={laneCount} scene={rig.scene} />
            </section>
          </ChainWorkspace>
        </main>
        {right ? (
          <Rail
            title="Backing and stems"
            side="right"
            onMin={() => setRight(false)}
          >
            <BackingPanel />
          </Rail>
        ) : (
          <MiniRail
            icons={[<MusicNotes key="m" className="size-5" />]}
            status={['1:12']}
            onOpen={() => setRight(true)}
          />
        )}
      </div>
    </div>
  );
}
