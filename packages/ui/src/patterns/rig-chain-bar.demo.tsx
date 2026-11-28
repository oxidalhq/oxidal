import { type ReactNode, useState } from 'react';

import { Button } from '../components/ui/button';
import { Slider } from '../components/ui/slider';
import { Switch } from '../components/ui/switch';
import { Caption } from '../components/ui/text';
import type { GlyphKey } from '../lib/block-glyphs';
import {
  type ChainCanvasControl,
  useChainCanvasControl,
} from '../lib/chain-canvas-control';
import {
  branchBlock,
  type ChainGraph,
  insertBlock,
  moveBlock,
} from '../lib/chain-graph';
import { cn } from '../lib/cn';
import type { Step } from '../lib/route';
import type { Change } from '../lib/route-diff';
import { sceneColour } from '../lib/scene-colours';
import { useVerticalRig } from '../lib/use-media';
import type { BlockModel } from '../widgets/block-editor';
import { type CanvasChoice, ChainCanvas } from '../widgets/chain-canvas';
import { ChangeScope, type ChangeScopeValue } from '../widgets/change-scope';
import { PanZoom } from '../widgets/pan-zoom';
import { RouteView } from '../widgets/route-view';
import {
  BlockPanelControl,
  blockPanelVisualClass,
  SelectedBlockPanel,
} from '../widgets/selected-block-panel';
import { ChangeList, CompareToggle } from '../widgets/versions';
import { VisualControl } from '../widgets/visual-control';
import { ChainWorkspace } from './chain-workspace';
import { amp, delay, drive, gate, mod, reverb } from './rig.fixtures';
import { SCENES, useRigSample } from './rig-samples.data';
import { SceneTabs } from './rig-samples.parts';

/**
 * The Rig with the chain bar: the chain map on top, the bar as the divider,
 * and the panel under it (scene tabs, the selected block's box, the output
 * level). Drag the grip on the bar to give the chain more or less room;
 * Hide lets the chain fill the screen. Design sample with fixed example
 * data; nothing is saved.
 */

const BLOCKS: (BlockModel & { glyph: GlyphKey })[] = [
  { ...gate('gate'), glyph: 'gate' },
  {
    ...drive('boost'),
    label: 'Boost',
    caption: 'Pedal · clean boost',
    origin: undefined,
    glyph: 'boost',
  },
  { ...amp('amp', 'Fender Super Reverb 1977', 'plexi'), glyph: 'amp' },
  {
    ...mod('swell'),
    label: 'Swell',
    kind: 'time',
    caption: 'Volume swell',
    origin: undefined,
    glyph: 'env',
  },
  { ...mod('motion'), caption: 'Tremolo', glyph: 'trem' },
  { ...reverb('bloom', 'Reverb'), glyph: 'reverb' },
];
const byId = (id: string) => BLOCKS.find((b) => b.id === id);

type SampleBlock = BlockModel & { glyph: GlyphKey };

const block = (id: string, col: number, row: number, lane?: number) => {
  const b = byId(id)!;
  return {
    id,
    kind: 'block' as const,
    glyph: b.glyph,
    name: b.label,
    col,
    row,
    ...(lane !== undefined ? { lane } : {}),
  };
};

/** IN, gate, boost, amp, then Swell beside a dry path, Motion, Bloom, OUT. */
const GRAPH: ChainGraph = {
  nodes: [
    { id: 'in', kind: 'cap', name: 'IN', col: 0, row: 0.5 },
    block('gate', 1, 0.5),
    block('boost', 2, 0.5),
    block('amp', 3, 0.5),
    block('swell', 4, 0, 0),
    { id: 'mix', kind: 'cap', name: 'Mix', col: 5, row: 0.5 },
    block('motion', 6, 0.5),
    block('bloom', 7, 0.5),
    { id: 'out', kind: 'cap', name: 'OUT', col: 8, row: 0.5 },
  ],
  edges: [
    ['in', 'gate'],
    ['gate', 'boost'],
    ['boost', 'amp'],
    ['amp', 'swell'],
    ['swell', 'mix'],
    ['amp', 'mix'],
    ['mix', 'motion'],
    ['motion', 'bloom'],
    ['bloom', 'out'],
  ],
};

/** The same chain as a route, for the Tree view. */
const ROUTE: Step<BlockModel>[] = [
  byId('gate')!,
  byId('boost')!,
  byId('amp')!,
  {
    split: true,
    id: 'split',
    branches: [[byId('swell')!], []],
    levels: [0, 0],
  },
  byId('motion')!,
  byId('bloom')!,
];

const CHOICES: CanvasChoice[] = [
  { glyph: 'od', name: 'Overdrive' },
  { glyph: 'comp', name: 'Compressor' },
  { glyph: 'chorus', name: 'Chorus' },
  { glyph: 'delay', name: 'Delay' },
  { glyph: 'reverb', name: 'Reverb' },
  { glyph: 'trem', name: 'Tremolo' },
];

const signed = (db: number) =>
  `${db < 0 ? '−' : db > 0 ? '+' : ''}${Math.abs(db).toFixed(1)} dB`;

/** The output row under the block box: Level, Mono and Boost, as the product has it. */
export function LevelRow({
  extra,
  bare = false,
}: {
  /** A row above, such as the guitar on a phone. */
  extra?: ReactNode;
  /** Without its card, such as inside a popover. */
  bare?: boolean;
}) {
  const [db, setDb] = useState(-6);
  const [mono, setMono] = useState(false);
  return (
    <section
      aria-label="Output level"
      className={cn(
        'grid min-w-0 grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-3 gap-y-2',
        !bare && 'rounded-xl border border-border bg-card px-3 py-2',
      )}
    >
      {extra && <div className="col-span-full">{extra}</div>}
      <Slider
        label="Level"
        readout={signed(db)}
        min={-40}
        max={6}
        step={0.5}
        value={[db]}
        aria-valuetext={signed(db)}
        onValueChange={([v]) => setDb(v ?? 0)}
      />
      <Button
        size="sm"
        variant={mono ? 'default' : 'outline'}
        aria-pressed={mono}
        onClick={() => setMono(!mono)}
      >
        Mono
      </Button>
      <Button size="sm" variant="outline" aria-label="Boost +0.0 dB">
        Boost{' '}
        <span className="font-mono text-sm font-medium tabular-nums">
          +0.0 dB
        </span>
      </Button>
    </section>
  );
}

/** Example edits since saving, for the "edited" stories. */
const EXAMPLE_CHANGES: Change[] = [
  {
    kind: 'value',
    block: 'amp',
    blockLabel: 'Fender Super Reverb 1977',
    control: 'treble',
    label: 'Treble',
    from: 5,
    to: 6.5,
  },
  {
    kind: 'value',
    block: 'motion',
    blockLabel: 'Motion',
    control: 'rate',
    label: 'Rate',
    from: 2,
    to: 3,
  },
  {
    kind: 'value',
    block: 'bloom',
    blockLabel: 'Bloom',
    control: 'mix',
    label: 'Mix',
    from: 30,
    to: 40,
    unit: '%',
  },
];

export function ChainBarRigSample({
  collapsed: startCollapsed = false,
  edits,
  header,
  footer,
  insetTop = 0,
  insetSide = 0,
  chainOverlay,
  barLead,
  barTrail,
  barCentre,
  aboveBar,
  levelRow = true,
  levelExtra,
}: {
  collapsed?: boolean;
  /** The editing tools on the bar: none, nothing changed yet, or three changes. */
  edits?: 'unchanged' | 'edited';
  /** Drawn above the chain, such as the top bar and the preset row. */
  header?:
    | ReactNode
    | ((edit: {
        changed: boolean;
        discard: () => void;
        canvas: ChainCanvasControl;
        scene: string;
      }) => ReactNode);
  /** Drawn below the panel, such as a phone's bottom tabs. */
  footer?: ReactNode;
  /** Room the chain keeps clear along its top, for a header drawn over it. */
  insetTop?: number;
  /** Room the chain keeps clear at each side, for readouts drawn over it. */
  insetSide?: number;
  /** Drawn over the chain area only, such as edge readouts. */
  chainOverlay?: ReactNode;
  /** At the chain bar's start and before its Save. */
  barLead?: ReactNode;
  barTrail?: ReactNode;
  barCentre?: ReactNode;
  /** Between the chain and its bar, such as tools docked at the bottom. */
  aboveBar?: ReactNode;
  /** The Level, Mono and Boost row at the bottom of the panel. */
  levelRow?: boolean;
  /** Beside Level in that row, such as the guitar on a phone. */
  levelExtra?: ReactNode;
}) {
  const rig = useRigSample('amp');
  const canvas = useChainCanvasControl();
  const [graph, setGraph] = useState(GRAPH);
  const [view, setView] = useState<'map' | 'tree'>('map');
  const vertical = useVerticalRig();
  const [values, setValues] = useState<Record<string, number>>({});
  const [savedValues, setSavedValues] = useState<Record<string, number>>({});
  const [minimised, setMinimised] = useState(false);
  const [added, setAdded] = useState<SampleBlock[]>([]);
  const [earlier, setEarlier] = useState<Change[]>(
    edits === 'edited' ? EXAMPLE_CHANGES : [],
  );
  const [compare, setCompare] = useState<'edited' | 'saved'>('edited');
  const [scope, setScope] = useState<ChangeScopeValue>(
    edits === 'edited' ? 'scene' : 'preset',
  );

  const find = (id: string) => byId(id) ?? added.find((b) => b.id === id);
  const selected = rig.selected ? find(rig.selected) : undefined;
  const value = (b: BlockModel, c: { id: string; value: number }) =>
    values[`${b.id}:${c.id}`] ?? c.value;
  const withValues = (b: BlockModel): BlockModel => ({
    ...b,
    on: rig.isOn(b.id),
    controls: b.controls.map((c) => ({ ...c, value: value(b, c) })),
  });
  const setValue = (b: string, c: string, v: number) =>
    setValues((all) => ({ ...all, [`${b}:${c}`]: v }));
  const main = (b: BlockModel) => b.controls.filter((c) => c.main).slice(0, 4);
  const order = [...BLOCKS, ...added].map((b) => b.id);
  const at = selected ? order.indexOf(selected.id) : -1;
  const id = () => `n${Date.now()}`;

  // Every value moved in the panel since saving is one more change.
  const changes: Change[] = [
    ...earlier,
    ...Object.entries(values)
      .filter(([k, v]) => savedValues[k] !== v)
      .flatMap(([k, v]): Change[] => {
        const [blockId, controlId] = k.split(':') as [string, string];
        const b = find(blockId);
        const c = b?.controls.find((x) => x.id === controlId);
        if (!b || !c) return [];
        return [
          {
            kind: 'value',
            block: b.id,
            blockLabel: b.label,
            control: c.id,
            label: c.label,
            from: savedValues[k] ?? c.value,
            to: v,
            ...(c.unit ? { unit: c.unit } : {}),
          },
        ];
      }),
  ];
  const addAfterSelected = () => {
    const from = rig.selected;
    const edge = graph.edges.find((e) => e[0] === from);
    if (!edge) return;
    const n = id();
    const made: SampleBlock = { ...delay(n), label: 'Delay', glyph: 'delay' };
    setAdded((all) => [...all, made]);
    setGraph((g) => insertBlock(g, edge, { glyph: 'delay', name: 'Delay' }, n));
    setEarlier((all) => [
      ...all,
      { kind: 'added', block: n, blockLabel: 'Delay' },
    ]);
    rig.setSelected(n);
  };
  const scopeControl = (
    <ChangeScope
      scope={scope}
      sceneName={SCENES[rig.scene] ?? 'This scene'}
      sceneColour={sceneColour(rig.scene)}
      onScope={setScope}
      onEditScenes={() => undefined}
      size="xs"
    />
  );

  const chain =
    view === 'map' ? (
      <ChainCanvas
        toolbar="none"
        insetTop={insetTop}
        insetSide={insetSide}
        control={canvas}
        graph={graph}
        selected={rig.selected}
        onSelect={rig.setSelected}
        choices={CHOICES}
        onInsert={(edge, c) => {
          const n = id();
          setGraph((g) => insertBlock(g, edge, c, n));
        }}
        onBranch={(edge, c) => {
          const n = id();
          setGraph((g) => branchBlock(g, edge, c, n));
        }}
        onMove={(b, edge) => setGraph((g) => moveBlock(g, b, edge))}
        card={(n) => {
          const b = find(n);
          if (!b) return undefined;
          return {
            caption: b.caption,
            kind: b.kind,
            on: rig.isOn(n),
            unsaved: changes.some((c) => 'block' in c && c.block === n),
            preview: main(b)
              .slice(0, 2)
              .map((c) => `${Math.round(value(b, c))}${c.unit ?? ''}`)
              .join(' · '),
          };
        }}
        off={(n) => !!find(n) && !rig.isOn(n)}
      />
    ) : (
      // The tree pans, zooms and centres like the map.
      <PanZoom
        control={canvas}
        selected={rig.selected}
        insetTop={insetTop}
        insetSide={insetSide}
        still={vertical}
        className={vertical ? 'h-full overflow-auto px-4 py-6' : undefined}
      >
        <RouteView
          route={ROUTE.map((s) =>
            'split' in s
              ? {
                  ...s,
                  branches: s.branches.map((br) =>
                    br.map((x) => ('split' in x ? x : withValues(x))),
                  ),
                }
              : withValues(s),
          )}
          selected={rig.selected}
          onSelect={rig.setSelected}
        />
      </PanZoom>
    );

  return (
    <div className="relative flex h-dvh flex-col overflow-hidden bg-background text-foreground">
      {typeof header === 'function'
        ? header({
            canvas,
            scene: `Scene ${rig.scene + 1} · ${SCENES[rig.scene]}`,
            changed: changes.length > 0,
            discard: () => {
              setEarlier([]);
              setValues(savedValues);
            },
          })
        : header}
      <ChainWorkspace
        canvas={canvas}
        chain={
          chainOverlay ? (
            <div className="relative h-full">
              {chain}
              {chainOverlay}
            </div>
          ) : (
            chain
          )
        }
        chainView={view}
        onChainView={setView}
        barLead={barLead}
        barTrail={barTrail}
        barCentre={barCentre}
        aboveBar={aboveBar}
        defaultCollapsed={startCollapsed}
        selected={
          selected ? { name: selected.label, on: rig.isOn(selected.id) } : null
        }
        onAdd={edits ? addAfterSelected : undefined}
        edits={
          edits
            ? {
                count: changes.length,
                list: <ChangeList changes={changes} />,
                compare,
                onCompare: setCompare,
                scope: scopeControl,
                onSave: () => {
                  setEarlier([]);
                  setSavedValues(values);
                },
              }
            : undefined
        }
      >
        {(layout) => (
          <>
            {edits && changes.length > 0 && !layout.barHasCompare && (
              <div
                data-slot="panel-changes"
                className="flex flex-wrap items-center gap-2 px-3 pt-2"
              >
                {scopeControl}
                <CompareToggle
                  size="xs"
                  value={compare}
                  onChange={setCompare}
                />
              </div>
            )}
            <SceneTabs
              rig={rig}
              compact={layout.phone}
              // Tabs at the control height, like the ⋯ beside them; touch keeps 44 px.
              className="mt-2 border-b border-border px-3 [&_[role=tab]]:-mb-px [&_[role=tab]]:min-h-control [@media(pointer:coarse)]:[&_[role=tab]]:min-h-touch"
            />
            <div className="grid gap-3 p-2 sm:p-3">
              {selected ? (
                <SelectedBlockPanel
                  // One column that never grows past a narrow screen.
                  className="grid-cols-[minmax(0,1fr)] lg:grid-cols-[20rem_minmax(12rem,1fr)_17rem] [&_[data-slot=block-panel-identity]]:min-w-0 [&_[data-slot=block-panel-identity]_*]:min-w-0"
                  title={selected.label}
                  caption={selected.caption ?? selected.kind}
                  position={`Scene ${rig.scene + 1} · ${SCENES[rig.scene]} · Block ${at + 1} of ${order.length}`}
                  source={selected.origin}
                  glyph={selected.glyph}
                  on={rig.isOn(selected.id)}
                  onPrevious={
                    at > 0 ? () => rig.setSelected(order[at - 1]!) : undefined
                  }
                  onNext={
                    at < order.length - 1
                      ? () => rig.setSelected(order[at + 1]!)
                      : undefined
                  }
                  minimised={minimised}
                  onMinimise={() => setMinimised(true)}
                  onExpand={() => setMinimised(false)}
                  preview={main(selected)
                    .map(
                      (c) =>
                        `${c.label} ${Math.round(value(selected, c))}${c.unit ?? ''}`,
                    )
                    .join(' · ')}
                  renderSwitch={(sw) => (
                    <Switch
                      id={sw}
                      checked={rig.isOn(selected.id)}
                      onCheckedChange={() => rig.toggle(selected.id)}
                    />
                  )}
                  onAllControls={() => undefined}
                  controlCount={selected.controls.length}
                  visual={
                    <VisualControl
                      kind={selected.kind}
                      role={selected.role}
                      controls={withValues(selected).controls}
                      onControl={(c, v) => setValue(selected.id, c, v)}
                      className={blockPanelVisualClass}
                    />
                  }
                  controls={main(selected).map((c) => (
                    <BlockPanelControl
                      key={c.id}
                      caption={c.label}
                      field={{
                        label: `${selected.label} ${c.label}`,
                        value: value(selected, c),
                        min: c.min,
                        max: c.max,
                        step: c.step ?? 0.5,
                        fine: (c.step ?? 0.5) / 5,
                        unit: c.unit,
                        digits: c.step && c.step >= 1 ? 0 : 1,
                        onChange: (v) => setValue(selected.id, c.id, v),
                      }}
                    />
                  ))}
                />
              ) : (
                <Caption>Select a block in the chain to edit it.</Caption>
              )}
              {levelRow && <LevelRow extra={levelExtra} />}
            </div>
          </>
        )}
      </ChainWorkspace>
      {footer}
    </div>
  );
}
