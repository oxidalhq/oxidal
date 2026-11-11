import { GearIcon } from '../../GearIcon';
import { type NewScene, branchEffects } from '../../sceneEdit';
import type { RigAudioState, RigControl, RigDocument } from '../../api';
import {
  type RigBlockVM,
  type RigLaneVM,
  blockKind,
  chainLanes,
  chainRoute,
  isRigBlockNode,
  routeBranchOf,
} from '../../rigChain';
import { controlGroup } from '../../rigControls';
import { createElement } from 'react';
import { lv2Control } from '../../lv2Control';
import { rigNodeLabel } from '../../rigDraft';

/**
 * Pure view model of the sounding mixed rig: the selected block, its controls,
 * scene and effect lanes, splits and the Perform lanes, derived from confirmed
 * state and the opened document. Commands live in useMixedRigSession.
 * @see docs/mixed-engine.md
 * @see docs/interface.md
 */

export const key = (c: RigControl) => JSON.stringify(c.target);
/** Actual mixed readback only; an edited document never masquerades as sounding. */
/** A tile id unique across scene lanes: the branch node, then its block. */
export const laneBlockId = (node: string, block: string) => `${node}::${block}`;
/** The node part of an end-of-lane + tile. */
export const END = 'end';
/** A lane slot at the end of one path of a split: target `split:index`. */
export const PATH = 'path';

export type SceneGain = { node: string; port: number; value: number };
export type SceneDraft = {
  session: string;
  gains: Record<string, SceneGain[]>;
  added?: NewScene[];
};

export type MixedRigViewInput = {
  state: RigAudioState;
  connected: boolean;
  matching: RigDocument | null;
  revision: string | undefined;
  selection: { revision: string; node: string } | null;
  nativeSelection: { node: string; target: string } | null;
  busy: boolean;
  eqBusy: boolean;
  readError: string;
  edit: { control: RigControl; value: number } | null;
  saveOpening: RigAudioState | null;
  sceneDraft: { session: string; scene: string } | null;
  sceneUpdates: SceneDraft | null;
  gears: Record<string, Record<string, string>>;
  narrow: boolean;
  switching: boolean;
};

export function mixedRigViewModel({
  state,
  connected,
  matching,
  revision,
  selection,
  nativeSelection,
  busy,
  eqBusy,
  readError,
  edit,
  saveOpening,
  sceneDraft,
  sceneUpdates,
  gears,
  narrow,
  switching,
}: MixedRigViewInput) {
  const running = state.phase === 'running';
  const nodes =
    matching?.manifest.oxidal?.graph.nodes.filter(isRigBlockNode) ?? [];
  const selected =
    nodes.find(
      (n) =>
        selection && selection.revision === revision && n.id === selection.node,
    ) ?? nodes.find((n) => n.kind !== 'output');
  const stageRole = matching?.manifest.tone3000.instances.find(
    (n) => n.id === selected?.instance,
  )?.processingRole;
  const stageLabels: Record<string, string> = {
    enabled: stageRole === 'cab' ? 'IR enabled' : 'Capture enabled',
    normalize: 'Normalize',
    inputGain: 'Input gain',
    outputGain: 'Output gain',
    mix: 'Mix',
  };
  const controls = (
    state.control?.controls.filter((c) => c.target.node === selected?.id) ?? []
  ).map((c) => {
    // A guarded stage has exactly one source block; its selected tile supplies
    // context. Keep qualified globals and whole/multi-block labels unchanged.
    if (
      (stageRole === 'amp' || stageRole === 'cab') &&
      c.target.kind === 'native' &&
      c.target.parameter.startsWith('block:')
    ) {
      const label = stageLabels[c.target.parameter.split(':').at(-1)!];
      if (label) return { ...c, label };
    }
    return c;
  });
  const currentSave =
    state.save?.source_session === state.control?.session ? state.save : null;
  const changed =
    !!state.control &&
    state.control.modified &&
    !(
      state.save?.saved_revision &&
      state.save.source_session === state.control.session &&
      state.save.source_control_revision === state.control.revision
    );
  const nativeLoad = (() => {
    const engines = state.control?.authoring ?? [];
    const blocks = engines.reduce(
      (count, row) =>
        count +
        [
          ...(row.status.layout?.left ?? []),
          ...(row.status.layout?.right ?? []),
        ].filter((block) => !block.insert).length,
      0,
    );
    const sizes = engines.flatMap((row) =>
      (row.status.settings ?? []).filter((setting) =>
        setting.target.endsWith(':slimSize'),
      ),
    );
    const full = sizes.filter((setting) => setting.value === 1).length;
    const lite = sizes.filter((setting) => setting.value === 0).length;
    const scaled = sizes.length - full - lite;
    const oversampling = [
      ...new Set(
        engines.map((row) => {
          const enabled = row.status.settings?.find(
            (setting) => setting.target === 'osEnabled',
          );
          const factor = row.status.settings?.find(
            (setting) => setting.target === 'osFactor',
          );
          return enabled?.value === 1 ? factor?.display : 'Off';
        }),
      ),
    ].filter(Boolean);
    return {
      engines: engines.length,
      blocks,
      full,
      lite,
      scaled,
      oversampling,
    };
  })();
  const modelChange = state.control?.model_change;
  const modelPending =
    !!modelChange &&
    ['verifying', 'preparing', 'ready', 'applying'].includes(
      modelChange.progress.phase,
    );
  const unavailable =
    !connected || busy || eqBusy || !running || !!readError || modelPending;
  const measuring = state.control?.authoring?.some(
    (row) =>
      row.status.tools?.balance.state === 'listening' ||
      row.status.tools?.alignment.state === 'listening',
  );
  const disabled = unavailable || !!measuring || !matching;
  const nativeModels = state.control?.slots?.find(
    (s) => s.node === selected?.id,
  );
  const slots = nativeModels?.slots ?? [];
  const wholeNative =
    !!nativeModels && stageRole !== 'amp' && stageRole !== 'cab';
  const eqBlocks =
    state.control?.eq?.find((e) => e.node === selected?.id)?.blocks ?? [];
  const nativeTarget =
    nativeSelection && nativeSelection.node === selected?.id
      ? nativeSelection.target
      : 'global';
  /** The TONE3000 tone behind the selected block of a TONE3000 node, when known. */
  const selectedToneId = (() => {
    if (selected?.kind !== 'tone3000') return null;
    const layout = state.control?.authoring?.find((a) => a.node === selected.id)
      ?.status.layout;
    const blocks = [...(layout?.left ?? []), ...(layout?.right ?? [])].filter(
      (b) => !b.insert,
    );
    // With no block chosen, a node of one block is that block.
    const block =
      blocks.find((b) => b.id === nativeTarget) ??
      (nativeTarget === 'global' && blocks.length === 1
        ? blocks[0]
        : undefined);
    return block?.tone_id ?? null;
  })();
  const eqBlock = wholeNative
    ? eqBlocks.find((e) => e.block_id === nativeTarget)
    : eqBlocks[0];
  const selectedModel = state.control?.models
    ?.find((row) => row.node === selected?.id)
    ?.assignments.find((assignment) => assignment.target === eqBlock?.block_id);
  const visibleControls = controls
    .filter((c) => {
      if (c.target.kind === 'bypass') return false;
      if (!wholeNative || c.target.kind !== 'native') return true;
      const p = c.target.parameter;
      if (eqBlock) return p.startsWith(`block:${eqBlock.block_id}:`);
      return (
        !p.startsWith('block:') &&
        controlGroup(p) === (nativeTarget === 'global' ? 'tone' : nativeTarget)
      );
    })
    .map((c) => {
      if (!eqBlock || !wholeNative || c.target.kind !== 'native') return c;
      const suffix = c.target.parameter.split(':').at(-1)!;
      const labels: Record<string, string> = {
        enabled: 'Enabled',
        normalize: 'Normalize',
        inputGain: 'Input gain',
        outputGain: 'Output gain',
        mix: 'Mix',
      };
      return { ...c, label: labels[suffix] ?? c.label };
    });
  const saveStale =
    !!saveOpening &&
    (state.session !== saveOpening.session ||
      state.revision !== saveOpening.revision ||
      state.control?.session !== saveOpening.control?.session ||
      state.control?.revision !== saveOpening.control?.revision);
  const scale = edit
    ? lv2Control({
        minimum: edit.control.minimum,
        maximum: edit.control.maximum,
        integer: edit.control.integer,
        toggled: edit.control.toggle,
        logarithmic: edit.control.logarithmic,
      })
    : undefined;
  const describeNode = (n: (typeof nodes)[number]) => {
    const branch = state.control?.branches?.find((b) => b.id === n.id);
    const bypass = state.control?.controls.find(
      (c) => c.target.kind === 'bypass' && c.target.node === n.id,
    );
    const plugin = matching?.manifest.oxidal?.lv2.find(
      (p) => p.id === n.instance,
    );
    const role = matching?.manifest.tone3000.instances.find(
      (i) => i.id === n.instance,
    )?.processingRole;
    const activeModel = state.control?.controls.find(
      (c) =>
        c.target.kind === 'native' &&
        c.target.node === n.id &&
        c.target.parameter.startsWith('block:') &&
        c.target.parameter.endsWith(':enabled'),
    );
    const modelName = activeModel?.label.replace(
      / · (left|right) · enabled$/,
      '',
    );
    const label =
      (modelName && (role === 'amp' || role === 'cab')
        ? `${role === 'amp' ? 'Amp' : 'Cab'} · ${modelName}`
        : undefined) ??
      rigNodeLabel(matching, n.id) ??
      (n.kind === 'tone3000'
        ? 'TONE3000'
        : n.kind === 'lv2'
          ? (plugin?.pluginUri.split(/[/#]/).pop() ?? 'Effect')
          : 'Mix');
    const gear = role === 'amp' ? 'amp' : role === 'cab' ? 'cab' : '';
    // LV2 effects and mix points are named by plugin URI/label, not a gear type.
    const hint = `${label} ${plugin?.pluginUri ?? ''} ${n.kind === 'merge' ? 'mix' : ''}`;
    return {
      branch,
      bypass,
      label,
      block: {
        id: n.id,
        label,
        kind: blockKind(gear, hint),
        // A bypass control value of 1 means bypassed; branches report enabled.
        on: branch ? branch.enabled : bypass?.value !== 1,
        face: createElement(GearIcon, { gear, name: hint }),
      },
    };
  };
  const selectedView = selected && describeNode(selected);
  /** Title for the controls sheet of the selected block (7.28). */
  const selectedSheet = selectedView
    ? {
        label: selectedView.label,
        detail:
          selectedView.branch && selectedView.branch.name !== selectedView.label
            ? `Path · ${selectedView.branch.name}`
            : selectedView.branch
              ? 'Path'
              : undefined,
      }
    : null;
  // Scenes rigs: each branch is a whole native preset. Draw it as a chain lane
  // of its own blocks, in scene order, with the sounding scene's lane bright.
  const sceneList = state.control?.scenes?.scenes ?? [];
  const soundingScene = sceneList.find((s) => s.id === state.control?.scene);
  const draftScene =
    sceneDraft && sceneDraft.session === state.control?.session
      ? sceneDraft.scene
      : null;
  const editingScene =
    soundingScene ??
    (draftScene
      ? sceneList.find((scene) => scene.id === draftScene)
      : undefined);
  const editingSceneGains =
    editingScene?.gains.map((gain) => {
      const control = state.control?.controls.find(
        (candidate) =>
          candidate.target.kind === 'merge' &&
          candidate.target.node === gain.node &&
          candidate.target.port === gain.port,
      );
      return { ...gain, value: control?.value ?? gain.value };
    }) ?? [];
  const drafts =
    sceneUpdates && sceneUpdates.session === state.control?.session
      ? sceneUpdates.gains
      : {};
  const addedScenes =
    sceneUpdates && sceneUpdates.session === state.control?.session
      ? (sceneUpdates.added ?? [])
      : [];
  const draftCount = Object.keys(drafts).length + addedScenes.length;
  const editingBase = editingScene
    ? (drafts[editingScene.id] ?? editingScene.gains)
    : [];
  const sceneMixChanged =
    !!editingScene &&
    editingBase.some(
      (gain, index) =>
        Math.abs(gain.value - (editingSceneGains[index]?.value ?? gain.value)) >
        0.0001,
    );
  const sceneMix = (() => {
    if (!editingScene) return [];
    const value = (node: string, port: number) =>
      editingSceneGains.find((gain) => gain.node === node && gain.port === port)
        ?.value;
    const branches = state.control?.scenes?.branches ?? [];
    if (branches.length)
      return branches.flatMap((branch) => {
        const values = branch.gains.flatMap((gain) => {
          const current = value(gain.node, gain.port);
          return current == null ? [] : [current];
        });
        return values.length
          ? [{ name: branch.name, value: Math.max(...values) }]
          : [];
      });
    const byName = new Map<string, number>();
    for (const gain of editingSceneGains) {
      const label = rigNodeLabel(matching, gain.node);
      if (!label?.endsWith(' send')) continue;
      const name = label.slice(0, -' send'.length);
      byName.set(name, Math.max(byName.get(name) ?? 0, gain.value));
    }
    return [...byName].map(([name, value]) => ({ name, value }));
  })();
  const sceneExtension = matching?.manifest.extensions[
    'urn:oxidal:scenes:1'
  ] as
    | {
        branches?: { id?: unknown }[];
      }
    | undefined;
  // Named gain snapshots also use the scenes extension, but they are not one
  // TONE3000 branch per scene. Only the composer's explicit branch catalogue
  // may be presented as scene lanes.
  const sceneBranchIds = Array.isArray(sceneExtension?.branches)
    ? sceneExtension.branches.flatMap((branch) =>
        typeof branch.id === 'string' ? [branch.id] : [],
      )
    : [];
  const sceneBranches = sceneBranchIds.flatMap((id) => {
    const node = nodes.find((candidate) => candidate.id === id);
    return node?.kind === 'tone3000' ? [node] : [];
  });
  /** A TONE3000 node's own blocks as tiles, empty slots as + tiles. */
  const nativeTiles = (n: (typeof nodes)[number]): RigBlockVM[] => {
    const layout = state.control?.authoring?.find((a) => a.node === n.id)
      ?.status.layout;
    const blocks = [
      ...(layout?.left ?? []),
      ...(layout?.stereo ? (layout.right ?? []) : []),
    ];
    const instance = n.instance ?? '';
    return blocks
      .filter(
        (block) =>
          !block.insert ||
          state.control?.slots
            ?.find((row) => row.node === n.id)
            ?.slots.some((slot) => slot.target === block.id),
      )
      .map((block) => {
        if (block.insert)
          return {
            id: laneBlockId(n.id, block.id),
            label: 'Empty slot',
            kind: blockKind('', ''),
            on: false,
            face: null,
            empty: true,
          };
        const enabled = state.control?.controls.find(
          (c) =>
            c.target.kind === 'native' &&
            c.target.node === n.id &&
            c.target.parameter === `block:${block.id}:enabled`,
        );
        const name =
          enabled?.label.replace(/(?: · (?:left|right))? · enabled$/, '') ??
          'Block';
        const gear = gears[instance]?.[block.id] ?? '';
        return {
          // Lanes reuse block ids; the lane prefix keeps selection to one tile.
          id: laneBlockId(n.id, block.id),
          label: name,
          kind: blockKind(gear, name),
          on: enabled?.value !== 0,
          face: createElement(GearIcon, { gear, name }),
        };
      });
  };
  const sceneGraph = matching?.manifest.oxidal?.graph;
  /** Each scene's effects: after its TONE3000 chain, sounded only in that scene. */
  const sceneEffectIds = sceneBranches.map((n) =>
    sceneGraph ? branchEffects(sceneGraph, n.id) : [],
  );
  const sceneEffectSet = new Set(sceneEffectIds.flat());
  const sceneLanes: RigLaneVM[] = sceneBranches.map((n, index) => {
    const scene = sceneList.find((candidate) => candidate.id === n.id);
    const branch = state.control?.branches?.find(
      (candidate) => candidate.id === n.id,
    );
    const active = branch?.enabled ?? state.control?.scene === scene?.id;
    return {
      id: scene?.name ?? n.id,
      input: String(index + 1),
      name: scene?.name,
      active,
      dim: !active,
      blocks: [
        ...nativeTiles(n),
        ...sceneEffectIds[index]!.flatMap((id) => {
          const fx = nodes.find((node) => node.id === id);
          return fx
            ? [{ ...describeNode(fx).block, id: laneBlockId(fx.id, '') }]
            : [];
        }),
        {
          // A + after the scene's chain, for an effect in this scene.
          id: laneBlockId(END, String(index)),
          label: 'Add',
          kind: blockKind('', ''),
          on: false,
          face: null,
          empty: true,
        },
      ],
    };
  });
  // Presets with effects: a straight chain, or a split into lanes, drawn like
  // every other chain. Other shapes keep the routing view.
  const chainIds =
    !sceneLanes.length && matching?.manifest.oxidal
      ? chainLanes(matching.manifest.oxidal.graph)
      : null;
  const chainNodes = new Set(chainIds?.flat() ?? []);
  // Gain-snapshot scenes feed each parallel lane through `scene-feed-<lane>-<ch>`
  // nodes labelled "<name> send": name the lane after its scene, and dim the
  // lanes the sounding scene does not open.
  const feedName = (index: number) => {
    const label = rigNodeLabel(matching, `scene-feed-${index}-0`);
    return label?.endsWith(' send') ? label.slice(0, -' send'.length) : null;
  };
  const feedOpen = (index: number) =>
    editingSceneGains.some(
      (gain) =>
        gain.value !== 0 && gain.node.startsWith(`scene-feed-${index}-`),
    );
  const snapshotLanes =
    !!editingScene && (chainIds?.length ?? 0) > 1 && feedName(0) !== null;
  const effectLanes: RigLaneVM[] = (chainIds ?? []).map((ids, index) => ({
    id:
      chainIds!.length > 1
        ? ((snapshotLanes ? feedName(index) : null) ?? `Lane ${index + 1}`)
        : 'Chain',
    input: chainIds!.length > 1 ? String(index + 1) : 'IN',
    name: snapshotLanes ? (feedName(index) ?? undefined) : undefined,
    active: snapshotLanes ? feedOpen(index) : undefined,
    dim: snapshotLanes ? !feedOpen(index) : undefined,
    blocks: ids
      .flatMap((id) => {
        const n = nodes.find((node) => node.id === id);
        if (!n) return [];
        if (n.kind === 'tone3000') return nativeTiles(n);
        return [{ ...describeNode(n).block, id: laneBlockId(n.id, '') }];
      })
      .concat({
        // Always a + after the last block, for an effect at the end.
        id: laneBlockId(END, String(index)),
        label: 'Add',
        kind: blockKind('', ''),
        on: false,
        face: null,
        empty: true,
      }),
  }));
  const lanedNodes = new Set([
    ...sceneBranches.map((n) => n.id),
    ...chainNodes,
    ...sceneEffectSet,
    // Mono adapters belong to their effect's tile, never a tile of their own.
    ...(chainIds || sceneEffectSet.size
      ? nodes.filter((n) => /-(mono|stereo)$/.test(n.id))
      : []
    ).map((n) => n.id),
  ]);
  const inLane = !!selected && lanedNodes.has(selected.id);
  const selectedBranch = routeBranchOf(
    matching?.manifest.oxidal
      ? chainRoute(matching.manifest.oxidal.graph)
      : null,
    selected?.id ?? '',
  );
  const editable = effectLanes.length > 0;
  /** Where the selected block sits in its lane, to stop moves at the ends. */
  const place = (() => {
    const lane = chainIds?.find((ids) => ids.includes(selected?.id ?? ''));
    const at = lane?.indexOf(selected!.id) ?? -1;
    return { first: at <= 0, last: !lane || at >= lane.length - 1 };
  })();
  /** A lane tile's node, and its block for a TONE3000 node ('' for an effect). */
  const laneTarget = (laneBlock: string) => {
    if (laneBlock.startsWith(laneBlockId(END, '')))
      return { node: END, block: laneBlock.slice(laneBlockId(END, '').length) };
    const node = nodes.find((n) => laneBlock.startsWith(laneBlockId(n.id, '')));
    return node
      ? {
          node: node.id,
          block: laneBlock.slice(laneBlockId(node.id, '').length),
        }
      : null;
  };
  const selectedLaneTile =
    selected && lanedNodes.has(selected.id)
      ? laneBlockId(
          selected.id,
          selected.kind === 'tone3000' ? nativeTarget : '',
        )
      : undefined;
  // Phones read split routing as a vertical tree (7.28).
  const fullRoute = matching?.manifest.oxidal
    ? chainRoute(matching.manifest.oxidal.graph)
    : null;
  /** Every split in the route, outermost first, for the desktop split row. */
  const routeSplits = (function collect(
    steps: NonNullable<typeof fullRoute>,
  ): Exclude<NonNullable<typeof fullRoute>[number], string>[] {
    return steps.flatMap((step) =>
      typeof step === 'string'
        ? []
        : [step, ...step.branches.flatMap((branch) => collect(branch))],
    );
  })(sceneLanes.length ? [] : (fullRoute ?? []));
  const routeTree =
    narrow &&
    !sceneLanes.length &&
    fullRoute?.some((step) => typeof step !== 'string')
      ? fullRoute
      : null;
  // Perform: the sounding scene's blocks and effects as switches, scene pads
  // above, the preset pads below. A Hold effect's tile engages and releases the
  // hold; any other effect's tile switches it in and out.
  const holdOf = (node: string) =>
    state.control?.controls.find(
      (c) =>
        c.target.kind === 'lv2' &&
        c.target.node === node &&
        c.target.symbol === 'hold',
    );
  const nativeSwitch = (node: string, block: string) =>
    state.control?.controls.find(
      (c) =>
        c.target.kind === 'native' &&
        c.target.node === node &&
        c.target.parameter === `block:${block}:enabled`,
    );
  const activeScene = Math.max(
    0,
    sceneBranches.findIndex((branch) => branch.id === state.control?.scene),
  );
  const activeSceneLane = sceneLanes[activeScene] ?? sceneLanes[0];
  const stageSource = activeSceneLane
    ? [activeSceneLane]
    : snapshotLanes && effectLanes.some((lane) => !lane.dim)
      ? effectLanes.filter((lane) => !lane.dim)
      : effectLanes;
  const stageLanes: RigLaneVM[] = stageSource.map((lane, _, all) => ({
    ...lane,
    tag: all.length > 1 ? (snapshotLanes ? lane.id : lane.input) : undefined,
    blocks: lane.blocks
      .filter((b) => !b.empty)
      .map((b) => {
        const hold = holdOf(laneTarget(b.id)?.node ?? '');
        return hold ? { ...b, on: hold.value === hold.maximum } : b;
      }),
  }));
  const performSwitching = switching || state.phase === 'starting';
  return {
    state,
    running,
    nodes,
    selected,
    stageRole,
    controls,
    currentSave,
    changed,
    nativeLoad,
    modelChange,
    modelPending,
    unavailable,
    measuring,
    disabled,
    nativeModels,
    slots,
    wholeNative,
    eqBlocks,
    nativeTarget,
    selectedToneId,
    eqBlock,
    selectedModel,
    visibleControls,
    saveStale,
    scale,
    describeNode,
    selectedView,
    selectedSheet,
    sceneList,
    soundingScene,
    draftScene,
    editingScene,
    editingSceneGains,
    drafts,
    addedScenes,
    draftCount,
    editingBase,
    sceneMixChanged,
    sceneMix,
    sceneBranches,
    nativeTiles,
    sceneEffectIds,
    sceneEffectSet,
    sceneLanes,
    chainIds,
    chainNodes,
    effectLanes,
    lanedNodes,
    inLane,
    selectedBranch,
    editable,
    place,
    laneTarget,
    selectedLaneTile,
    fullRoute,
    routeSplits,
    routeTree,
    holdOf,
    nativeSwitch,
    stageLanes,
    performSwitching,
  };
}
