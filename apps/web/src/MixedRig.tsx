import { AddBlockChooser } from './AddBlockChooser';
import { MasterLevel } from './MasterLevel';
import { ScenePads } from './ScenePads';
import { SceneChange } from './SceneChange';
import { SlotChooser } from './SlotChooser';
import { lv2Effect } from './rigDraft';
import {
  buildLanes,
  insertBlock,
  moveBlock,
  readLanes,
  removeBlock,
  type Lanes,
} from './rigEdit';
import { BoostControl } from './BoostControl';
import { GuitarPicker } from './GuitarSettings';
import { RigPresetSelector } from './RigPresetSelector';
import {
  boostKey,
  choiceKey,
  discardsSceneEdits,
  playChoice,
  playScenes,
  type PresetChoice,
} from './presetChoices';
import {
  assertAuditionOwner,
  confirmedControlDisplay,
  controlGroup,
} from './rigControls';
import {
  SlidersHorizontal,
  Waveform,
  MusicNotes,
  ArrowsSplit,
  FloppyDisk,
  Play,
  Stop,
  CaretLeft,
  CaretRight,
  Trash,
} from '@phosphor-icons/react';
import { RigTopology } from './RigTopology';
import { GearIcon } from './GearIcon';
import { ChainView, LedToggle, RigTile } from './ChainView';
import type { RigBlockVM, RigLaneVM } from './rigChain';
import { blockKind, chainLanes } from './rigChain';
import { NativeAuthoring } from './NativeAuthoring';
import { SceneMidi } from './SceneMidi';
import { ModelPicker } from './ModelPicker';
import { ArtworkDeck } from './AssetArtwork';
import { LiveEq } from './LiveEq';
import { RecoveryNotice } from './RecoveryNotice';
import { useCallback, useEffect, useRef, useState } from 'react';
import { rigNodeLabel } from './rigDraft';
import { Button } from './components/ui/button';
import { AdjustmentDialog } from './AdjustmentDialog';
import { TouchAdjust } from './TouchAdjust';
import { EditQueue } from './editQueue';
import { controlDisplay, controlLabel, lv2Control } from './lv2Control';
import {
  rigAudioState,
  presetArtwork,
  installedLv2,
  libraryCatalog,
  publishRig,
  rigLibrary,
  rigAudioCommand,
  rigDocument,
  type RigAudioState,
  type RigAudioAction,
  type RigControl,
  type RigDocument,
} from './api';

const key = (c: RigControl) => JSON.stringify(c.target);
/** Actual mixed readback only; an edited document never masquerades as sounding. */
/** A tile id unique across scene lanes: the branch node, then its block. */
const laneBlockId = (node: string, block: string) => `${node}::${block}`;
/** The node part of an end-of-lane + tile. */
const END = 'end';

export function MixedRig({
  connected,
  onPlaying,
  onPresent,
  otherPlaying,
}: {
  connected: boolean;
  onPlaying: (name: string | null) => void;
  onPresent: (present: boolean) => void;
  otherPlaying: boolean;
}) {
  const [state, setState] = useState<RigAudioState | null>(null);
  const [document, setDocument] = useState<RigDocument | null>(null);
  const [selection, setSelection] = useState<{
    revision: string;
    node: string;
  } | null>(() => {
    try {
      const v: unknown = JSON.parse(
        sessionStorage.getItem('oxidal.mixed.selection') ?? 'null',
      );
      return v &&
        typeof v === 'object' &&
        'revision' in v &&
        typeof v.revision === 'string' &&
        'node' in v &&
        typeof v.node === 'string'
        ? { revision: v.revision, node: v.node }
        : null;
    } catch {
      return null;
    }
  });
  const [picker, setPicker] = useState<{
    opening: RigAudioState;
    request?: number;
    node: string;
    target: string;
    name: string;
    insert: boolean;
    format?: 'nam' | 'ir';
    allowedFormat?: 'nam' | 'ir';
  } | null>(null);
  const [adding, setAdding] = useState(false);
  // An empty lane slot the player tapped: which node, which slot.
  const [laneSlot, setLaneSlot] = useState<{
    node: string;
    target: string;
  } | null>(null);
  const [insertion, setInsertion] = useState<{
    opening: RigAudioState;
    node: string;
    format: 'nam' | 'ir';
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [switching, setSwitching] = useState(false);
  // A scenes preset waiting on the player: opening it drops unsaved edits here.
  const [discarding, setDiscarding] = useState<PresetChoice | null>(null);
  const [eqBusy, setEqBusy] = useState(false);
  const [nativeSelection, setNativeSelection] = useState<{
    node: string;
    target: string;
  } | null>(null);
  const [error, setError] = useState('');
  const [readError, setReadError] = useState('');
  const [name, setName] = useState('');
  const [saveOpening, setSaveOpening] = useState<RigAudioState | null>(null);
  const [edit, setEdit] = useState<{
    control: RigControl;
    value: number;
  } | null>(null);
  const current = useRef<RigAudioState | null>(null);
  const alive = useRef(false);
  const sending = useRef(false);
  const generation = useRef(0);
  const queue = useRef<EditQueue<RigAudioState> | null>(null);
  const latest = useRef(0);
  const accept = useCallback((next: RigAudioState) => {
    if (!alive.current) return;
    if (
      current.current?.session === next.session &&
      current.current.revision > next.revision
    )
      return;
    current.current = next;
    setState(next);
  }, []);
  useEffect(() => {
    alive.current = true;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      const requested = generation.current;
      try {
        const next = await rigAudioState();
        if (
          alive.current &&
          !sending.current &&
          requested === generation.current
        ) {
          accept(next);
          setReadError('');
        }
      } catch (cause) {
        if (alive.current) setReadError(String(cause));
      } finally {
        if (alive.current)
          timer = setTimeout(
            () => void tick(),
            current.current?.control?.authoring?.some(
              (row) =>
                row.status.tools &&
                (row.status.tools.tuner_enabled ||
                  row.status.tools.balance.state === 'listening' ||
                  row.status.tools.alignment.state === 'listening'),
            )
              ? 150
              : 750,
          );
      }
    };
    void tick();
    return () => {
      alive.current = false;
      clearTimeout(timer);
      void queue.current?.finish(latest.current).catch(() => {});
    };
  }, [accept]);
  const revision = state?.configured?.revision;
  useEffect(() => {
    let active = true;
    if (revision)
      void rigDocument(revision)
        .then((d) => {
          if (active) {
            setDocument(d);
            setName(d.manifest.name);
          }
        })
        .catch((e: unknown) => {
          if (active) setError(String(e));
        });
    return () => {
      active = false;
    };
  }, [revision]);
  const matching = document?.revision === revision ? document : null;
  // Each TONE3000 block's type (amp, cab, pedal…) for its icon, by node and
  // block id, read from the artwork of the preset the node was made from.
  const [gears, setGears] = useState<Record<string, Record<string, string>>>(
    {},
  );
  useEffect(() => {
    const abort = new AbortController();
    const instances = matching?.manifest.tone3000.instances ?? [];
    const resources = matching?.manifest.resources ?? [];
    void Promise.all(
      instances.map(async (instance) => {
        const sha = resources.find((r) => r.id === instance.preset)?.sha256;
        if (!sha) return [instance.id, {}] as const;
        for (const owned of [true, false]) {
          try {
            const items = await presetArtwork(sha, owned, abort.signal);
            return [
              instance.id,
              Object.fromEntries(items.map((i) => [i.block_id, i.gear ?? ''])),
            ] as const;
          } catch {
            /* try the other library, then go without icons */
          }
        }
        return [instance.id, {}] as const;
      }),
    ).then((pairs) => {
      if (!abort.signal.aborted) setGears(Object.fromEntries(pairs));
    });
    return () => abort.abort();
  }, [matching]);
  useEffect(() => {
    onPlaying(
      state?.phase === 'running' ? (matching?.manifest.name ?? 'Rig') : null,
    );
  }, [state?.phase, matching, onPlaying]);
  useEffect(() => {
    onPresent(
      !!state?.configured && state.phase !== 'unavailable' && !otherPlaying,
    );
  }, [state?.configured, state?.phase, otherPlaying, onPresent]);
  async function command(action: RigAudioAction) {
    if (!current.current || sending.current) return;
    generation.current++;
    sending.current = true;
    setBusy(true);
    setError('');
    try {
      if (
        action.kind === 'control' &&
        action.command.target.kind === 'native' &&
        current.current.control?.authoring?.some(
          (r) => r.node === action.command.target.node,
        )
      ) {
        const target = action.command.target;
        const token = crypto.randomUUID();
        let cursor = current.current;
        cursor = await rigAudioCommand(cursor, {
          kind: 'authoring',
          command: {
            session: cursor.control!.session,
            expected_revision: cursor.control!.revision,
            node: target.node,
            action: {
              kind: 'gesture',
              edit: {
                phase: 'begin',
                owner: 'mixed-toggle',
                token,
                target: target.parameter,
              },
            },
          },
        });
        accept(
          await rigAudioCommand(cursor, {
            kind: 'authoring',
            command: {
              session: cursor.control!.session,
              expected_revision: cursor.control!.revision,
              node: target.node,
              action: {
                kind: 'gesture',
                edit: {
                  phase: 'commit',
                  owner: 'mixed-toggle',
                  token,
                  sequence: 1,
                  value: action.command.value,
                },
              },
            },
          }),
        );
      } else accept(await rigAudioCommand(current.current, action));
      return true;
    } catch (cause) {
      setError(String(cause));
      try {
        accept(await rigAudioState());
      } catch {
        /* retain confirmed state */
      }
      return false;
    } finally {
      sending.current = false;
      if (alive.current) setBusy(false);
    }
  }
  /** Any preset from the picker: scene presets stay here, TONE3000 ones hand over. */
  async function choose(choice: PresetChoice, confirmed = false) {
    const control = current.current?.control;
    if (
      !confirmed &&
      discardsSceneEdits(choice, {
        revision,
        modified: !!changed,
        ready: control?.prepared?.map((p) => p.revision),
      })
    ) {
      setDiscarding(choice);
      return;
    }
    setDiscarding(null);
    setSwitching(true);
    setError('');
    try {
      await playChoice(choice);
    } catch (cause) {
      if (alive.current) setError(String(cause));
    } finally {
      if (alive.current) setSwitching(false);
    }
  }
  const [editing, setEditing] = useState(false);
  /** Rebuilds this preset with a change to its blocks, plays the new version
   * and hides the one it replaces, so the library keeps one preset. */
  async function editChain(change: (lanes: Lanes) => Lanes) {
    const opened = document?.revision === revision ? document : null;
    if (!opened || editing) return;
    setEditing(true);
    setError('');
    try {
      const rate =
        current.current?.configured?.stream.input.sample_rate ?? 48000;
      const live: Record<string, Record<string, number>> = {};
      for (const c of current.current?.control?.controls ?? [])
        if (c.target.kind === 'lv2')
          (live[c.target.node] ??= {})[c.target.symbol] = c.value;
      const next = change(readLanes(opened, await installedLv2(rate), live));
      const [library, catalog] = await Promise.all([
        rigLibrary(),
        libraryCatalog(),
      ]);
      const listed = catalog.items.find(
        (i) => i.kind === 'rig' && i.id === opened.revision,
      );
      const published = await publishRig(
        buildLanes(
          opened.manifest.id,
          listed?.name ?? opened.manifest.name,
          next,
          library.native_profile,
        ),
      );
      await playScenes(published.revision);
      if (listed) {
        const latest = await libraryCatalog();
        await libraryCatalog({
          expected_revision: latest.revision,
          entry_kind: 'rig',
          id: opened.revision,
          action: { kind: 'visibility', archived: true },
        });
      }
    } catch (cause) {
      if (alive.current) setError(String(cause));
    } finally {
      if (alive.current) setEditing(false);
    }
  }
  /** One place left or right within the block's lane. */
  function shift(id: string, step: -1 | 1) {
    return editChain((lanes) => {
      const lane = lanes.find((l) => l.some((b) => b.id === id)) ?? [];
      return moveBlock(lanes, id, lane.findIndex((b) => b.id === id) + step);
    });
  }
  async function switchPrepared(revision: string) {
    const cursor = current.current;
    if (!cursor?.control || !cursor.configured) return;
    await command({
      kind: 'switch',
      command: {
        session: cursor.control.session,
        expected_revision: cursor.control.revision,
        revision,
        fade_frames: Math.max(
          2,
          Math.round(cursor.configured.stream.input.sample_rate / 100),
        ),
      },
    });
  }
  function open(control: RigControl) {
    if (!current.current?.control || queue.current || sending.current) return;
    let cursor = current.current;
    const opening = control.value;
    latest.current = opening;
    setEdit({ control, value: opening });
    setError('');
    const native =
      control.target.kind === 'native' &&
      cursor.control?.authoring?.some((r) => r.node === control.target.node)
        ? control.target
        : null;
    const token = crypto.randomUUID();
    const ready = native
      ? rigAudioCommand(cursor, {
          kind: 'authoring',
          command: {
            session: cursor.control!.session,
            expected_revision: cursor.control!.revision,
            node: native.node,
            action: {
              kind: 'gesture',
              edit: {
                phase: 'begin',
                owner: 'mixed',
                token,
                target: native.parameter,
              },
            },
          },
        }).then((next) => {
          cursor = next;
          accept(next);
        })
      : Promise.resolve();
    void ready.catch((cause) => {
      if (alive.current) setError(String(cause));
    });
    queue.current = new EditQueue<RigAudioState>(
      'mixed',
      token,
      ready,
      async (e) => {
        const value = e.phase === 'cancel' ? opening : e.value;
        if (
          (!native || e.phase === 'preview') &&
          cursor.control?.controls.find((c) => key(c) === key(control))
            ?.value === value
        )
          return cursor;
        if (!cursor.control) throw new Error('Sounding controls changed');
        generation.current++;
        sending.current = true;
        try {
          cursor = native
            ? await rigAudioCommand(cursor, {
                kind: 'authoring',
                command: {
                  session: cursor.control.session,
                  expected_revision: cursor.control.revision,
                  node: native.node,
                  action: { kind: 'gesture', edit: e },
                },
              })
            : await rigAudioCommand(cursor, {
                kind: 'control',
                command: {
                  session: cursor.control.session,
                  expected_revision: cursor.control.revision,
                  target: control.target,
                  value,
                },
              });
          return cursor;
        } finally {
          sending.current = false;
        }
      },
      accept,
      (e) => {
        if (alive.current) setError(String(e));
      },
    );
  }
  async function finish(cancel: boolean) {
    const pending = queue.current;
    if (!pending) return;
    setBusy(true);
    try {
      if (cancel) await pending.cancel();
      else await pending.finish(latest.current);
    } catch (e) {
      if (alive.current) setError(String(e));
    } finally {
      queue.current = null;
      if (alive.current) {
        setEdit(null);
        setBusy(false);
      }
    }
  }
  if (
    !state ||
    state.phase === 'unavailable' ||
    !state.configured ||
    (otherPlaying && state.phase !== 'running')
  )
    return null;
  const running = state.phase === 'running';
  const selectorNodes = new Set(
    state.control?.scenes?.scenes.flatMap((scene) =>
      scene.gains.map((gain) => gain.node),
    ) ?? [],
  );
  const internalNodes =
    matching?.manifest.extensions['urn:oxidal:authoring']?.internal_nodes;
  const hiddenNodes = new Set(
    Array.isArray(internalNodes)
      ? internalNodes.filter((id): id is string => typeof id === 'string')
      : [],
  );
  const nodes =
    matching?.manifest.oxidal?.graph.nodes.filter(
      (n) =>
        !['input', 'output', 'split'].includes(n.kind) &&
        !selectorNodes.has(n.id) &&
        !(n.kind === 'merge' && hiddenNodes.has(n.id)),
    ) ?? [];
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
  const disabled = unavailable || !!measuring;
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
  async function saveCopy() {
    const cursor = current.current;
    if (
      !cursor ||
      !saveOpening ||
      cursor.session !== saveOpening.session ||
      cursor.revision !== saveOpening.revision ||
      cursor.control?.session !== saveOpening.control?.session ||
      cursor.control?.revision !== saveOpening.control?.revision
    ) {
      setError('The rig changed. Close and reopen Save copy.');
      return;
    }
    if (await command({ kind: 'save', name: name.trim() }))
      setSaveOpening(null);
  }
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
        face: <GearIcon gear={gear} name={hint} />,
      },
    };
  };
  const selectedView = selected && describeNode(selected);
  // Scenes rigs: each branch is a whole native preset. Draw it as a chain lane
  // of its own blocks, in scene order, with the sounding scene's lane bright.
  const sceneList = state.control?.scenes?.scenes ?? [];
  const soundingScene = sceneList.find((s) => s.id === state.control?.scene);
  const sceneBranches = sceneList.length
    ? nodes.filter((n) => n.kind === 'tone3000').slice(0, sceneList.length)
    : [];
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
          face: <GearIcon gear={gear} name={name} />,
        };
      });
  };
  const sceneLanes: RigLaneVM[] = sceneBranches.map((n, index) => {
    const scene = sceneList[index];
    return {
      id: scene?.name ?? n.id,
      input: String(index + 1),
      dim: !!scene && state.control?.scene !== scene.id,
      blocks: nativeTiles(n),
    };
  });
  // Presets with effects: a straight chain, or a split into lanes, drawn like
  // every other chain. Other shapes keep the routing view.
  const chainIds =
    !sceneLanes.length && matching?.manifest.oxidal
      ? chainLanes(matching.manifest.oxidal.graph)
      : null;
  const chainNodes = new Set(chainIds?.flat() ?? []);
  const effectLanes: RigLaneVM[] = (chainIds ?? []).map((ids, index) => ({
    id: chainIds!.length > 1 ? `Lane ${index + 1}` : 'Chain',
    input: chainIds!.length > 1 ? String(index + 1) : 'IN',
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
    // Mono adapters belong to their effect's tile, never a tile of their own.
    ...(chainIds ? nodes.filter((n) => /-(mono|stereo)$/.test(n.id)) : []).map(
      (n) => n.id,
    ),
  ]);
  const inLane = !!selected && lanedNodes.has(selected.id);
  /** A dragged effect dropped before tile `before` in `lane` (null: the end). */
  function dropBlock(tile: string, lane: number, before: string | null) {
    const id = laneTarget(tile)?.node;
    const ids = chainIds?.[lane];
    if (!id || !ids) return;
    const rest = ids.filter((n) => n !== id);
    const at = before ? laneTarget(before) : null;
    let index = rest.length;
    if (at && at.node !== END) {
      const node = rest.indexOf(at.node);
      // Before a TONE3000 chain only at its first tile; otherwise after it.
      const first = effectLanes[lane]?.blocks.find(
        (b) => laneTarget(b.id)?.node === at.node,
      );
      if (node >= 0) index = first?.id === before ? node : node + 1;
    }
    if (chainIds?.findIndex((l) => l.includes(id)) === lane)
      if (ids.indexOf(id) === index) return;
    void editChain((lanes) => moveBlock(lanes, id, index, lane));
  }
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
  return (
    <section className="panel space-y-3" aria-label="Sounding mixed rig">
      <div className="rig-performance-header">
        <RigPresetSelector
          current={{
            key: revision
              ? choiceKey({ kind: 'scenes', revision, name: '', scenes: [] })
              : '',
            name: matching?.manifest.name,
            modified: !!changed,
            refresh: revision,
          }}
          disabled={disabled || busy || switching || !!edit || !!picker}
          onSelect={(choice) => void choose(choice)}
        />
        <Button
          variant="outline"
          aria-label="Save copy"
          disabled={
            disabled || !matching || !!edit || !!picker || !!state.save?.running
          }
          onClick={() => {
            setName(matching!.manifest.name);
            setSaveOpening(state);
            setError('');
          }}
        >
          <FloppyDisk aria-hidden="true" />
          <span className="phone-hidden">
            {state.save?.running ? 'Saving…' : 'Save'}
          </span>
        </Button>
        {state.device_owned ? (
          <Button
            variant="outline"
            aria-label={
              state.phase === 'starting' ? 'Cancel loading' : 'Stop audio'
            }
            disabled={!connected || busy || eqBusy || !!edit || !!picker}
            onClick={() => void command({ kind: 'stop' })}
          >
            <Stop aria-hidden="true" />
            <span className="phone-hidden">
              {state.phase === 'starting' ? 'Cancel' : 'Stop'}
            </span>
          </Button>
        ) : (
          <Button
            aria-label="Resume audio"
            disabled={!connected || busy}
            onClick={() => void command({ kind: 'restart' })}
          >
            <Play aria-hidden="true" />
            <span className="phone-hidden">Resume</span>
          </Button>
        )}
      </div>
      {discarding && (
        <AdjustmentDialog
          title="Discard unsaved changes?"
          onCancel={() => setDiscarding(null)}
        >
          <p>
            {matching?.manifest.name ?? 'This preset'} has unsaved changes.
            Opening {discarding.name} discards them, because only one preset
            with scenes keeps its edits at a time. Keep both ready to switch
            without losing either.
          </p>
          <div className="action-row">
            <Button variant="outline" onClick={() => setDiscarding(null)}>
              Keep editing
            </Button>
            <Button onClick={() => void choose(discarding, true)}>
              Discard and open
            </Button>
          </div>
        </AdjustmentDialog>
      )}
      {(state.phase !== 'running' || switching) && (
        <p role="status" className="caption">
          {switching
            ? 'Changing preset…'
            : state.phase === 'starting'
              ? 'Preparing sound…'
              : state.phase === 'failed'
                ? 'Audio needs attention'
                : 'Audio stopped'}
        </p>
      )}
      <MasterLevel
        extra={
          <>
            <GuitarPicker />
            {matching && (
              <BoostControl
                targets={[
                  {
                    key: boostKey.scenes(matching.manifest.id),
                    label: matching.manifest.name,
                  },
                  ...(soundingScene
                    ? [
                        {
                          key: boostKey.scene(
                            matching.manifest.id,
                            soundingScene.id,
                          ),
                          label: `Scene · ${soundingScene.name}`,
                        },
                      ]
                    : []),
                ]}
              />
            )}
          </>
        }
      />
      {!!state.control?.scenes?.scenes.length && (
        <ScenePads
          extra={
            matching && (
              <SceneChange preset={matching.manifest.id} disabled={disabled} />
            )
          }
          scenes={state.control.scenes.scenes}
          active={state.control.scene}
          fading={!!state.control.scene_transitioning}
          disabled={disabled || !!edit}
          onSelect={(scene) => {
            const control = current.current?.control;
            if (control)
              void command({
                kind: 'scene',
                command: {
                  session: control.session,
                  expected_revision: control.revision,
                  scene,
                },
              });
          }}
        />
      )}
      {!!state.control?.prepared?.length && (
        <div
          className="flex flex-wrap items-center gap-2"
          role="group"
          aria-label="Prepared presets"
        >
          {state.control.prepared.map((p) => (
            <Button
              key={p.revision}
              className="h-auto min-h-11 max-w-full min-w-0 text-left whitespace-normal"
              variant="outline"
              disabled={disabled || !!edit || !!p.error}
              onClick={() => void switchPrepared(p.revision)}
            >
              <span className="min-w-0 break-words">
                {p.name}
                {p.error ? ' · Unavailable' : p.modified ? ' · Modified' : ''}
              </span>
            </Button>
          ))}
        </div>
      )}
      <RecoveryNotice message={state.recovery_error} />
      {(error || readError || state.error) && (
        <p role="alert" className="error">
          {error || readError || state.error}
        </p>
      )}
      {(sceneLanes.length > 0 || effectLanes.length > 0) && (
        <ChainView
          label={sceneLanes.length ? 'Scene branches' : 'Chain'}
          parallel={sceneLanes.length > 0 || effectLanes.length > 1}
          onAdd={(laneBlock) => {
            const at = laneTarget(laneBlock);
            if (at?.block) setLaneSlot({ node: at.node, target: at.block });
          }}
          lanes={sceneLanes.length ? sceneLanes : effectLanes}
          movable={
            editable && !editing
              ? (tile) =>
                  nodes.find((n) => n.id === laneTarget(tile)?.node)?.kind ===
                  'lv2'
              : undefined
          }
          onMove={editable ? dropBlock : undefined}
          selected={
            selected && lanedNodes.has(selected.id)
              ? laneBlockId(
                  selected.id,
                  selected.kind === 'tone3000' ? nativeTarget : '',
                )
              : undefined
          }
          disabled={!!edit || !!picker}
          onSelect={(laneBlock) => {
            const at = laneTarget(laneBlock);
            if (!revision || !at) return;
            setSelection({ revision, node: at.node });
            if (at.block)
              setNativeSelection({ node: at.node, target: at.block });
          }}
        />
      )}
      <RigTopology
        graph={matching?.manifest.oxidal?.graph ?? { nodes: [], edges: [] }}
        visible={nodes.filter((n) => !lanedNodes.has(n.id)).map((n) => n.id)}
        selected={selected?.id}
      >
        {(id) => {
          const n = nodes.find((node) => node.id === id)!;
          const view = describeNode(n);
          return (
            <div key={n.id} data-node={n.id} className="mixed-node">
              <RigTile
                block={view.block}
                selected={n.id === selected?.id}
                disabled={!!edit || !!picker}
                onSelect={() => {
                  if (!revision) return;
                  const selected = { revision, node: n.id };
                  setSelection(selected);
                  try {
                    sessionStorage.setItem(
                      'oxidal.mixed.selection',
                      JSON.stringify(selected),
                    );
                  } catch {
                    /* browsing preferences are optional */
                  }
                }}
              />
            </div>
          );
        }}
      </RigTopology>
      {running && selected && wholeNative && (
        <div
          className="flex flex-wrap items-center gap-2"
          aria-label="Native model controls"
        >
          {(
            [
              ['global', 'Tone', SlidersHorizontal],
              ['gate', 'Gate', Waveform],
              ['pitch', 'Pitch', MusicNotes],
              ['stereo', 'Stereo', ArrowsSplit],
            ] as const
          )
            .filter(([target]) =>
              controls.some(
                (c) =>
                  c.target.kind === 'native' &&
                  !c.target.parameter.startsWith('block:') &&
                  controlGroup(c.target.parameter) ===
                    (target === 'global' ? 'tone' : target),
              ),
            )
            .map(([target, title, Icon]) => (
              <Button
                key={target}
                variant="ghost"
                aria-pressed={nativeTarget === target}
                disabled={disabled || !!edit}
                onClick={() =>
                  setNativeSelection({ node: selected.id, target })
                }
              >
                <Icon aria-hidden="true" />
                {title}
              </Button>
            ))}
          {/* Scene lanes select models by their tiles; other rigs list them here. */}
          {!inLane &&
            eqBlocks.map((block, index) => {
              const control = controls.find(
                (c) =>
                  c.target.kind === 'native' &&
                  c.target.parameter === `block:${block.block_id}:enabled`,
              );
              const title =
                control?.label.replace(
                  /(?: · (?:left|right))? · enabled$/,
                  '',
                ) ?? 'Model';
              return (
                <Button
                  key={block.block_id}
                  variant="outline"
                  aria-label={`Select model ${index + 1}`}
                  aria-pressed={nativeTarget === block.block_id}
                  disabled={disabled || !!edit}
                  className="h-auto min-h-11 max-w-full min-w-0 whitespace-normal"
                  onClick={() =>
                    setNativeSelection({
                      node: selected.id,
                      target: block.block_id,
                    })
                  }
                >
                  <span className="min-w-0 break-words">
                    {index + 1} · {title}
                  </span>
                </Button>
              );
            })}
          <div className="ml-auto flex flex-wrap gap-2">
            {eqBlock && (
              <Button
                variant="outline"
                disabled={disabled || !!edit}
                onClick={() =>
                  setPicker({
                    opening: state,
                    node: selected.id,
                    target: eqBlock.block_id,
                    name: 'Selected model',
                    insert: false,
                  })
                }
              >
                Change model
              </Button>
            )}
            {slots.length > 0 && (
              <Button
                variant="outline"
                aria-label="Add block"
                disabled={disabled || !!edit}
                onClick={() => setAdding(true)}
              >
                Add
              </Button>
            )}
          </div>
          {adding && selected && (
            <AddBlockChooser
              onCancel={() => setAdding(false)}
              onChoose={(format) => {
                setAdding(false);
                setInsertion({ opening: state, node: selected.id, format });
              }}
            />
          )}
        </div>
      )}
      {running && selectedModel && (
        <ArtworkDeck model id={selectedModel.asset} />
      )}
      {running && selected && nativeModels && !wholeNative && eqBlock && (
        <Button
          variant="outline"
          disabled={disabled || !!edit}
          onClick={() =>
            setPicker({
              opening: state,
              node: selected.id,
              target: eqBlock.block_id,
              name: stageRole === 'cab' ? 'Cab IR' : 'Amp capture',
              insert: false,
              allowedFormat: stageRole === 'cab' ? 'ir' : 'nam',
            })
          }
        >
          {stageRole === 'cab' ? 'Change cab IR' : 'Change amp capture'}
        </Button>
      )}
      {modelPending && (
        <div className="flex flex-wrap items-center gap-2" role="status">
          <span>
            {modelChange.progress.phase === 'applying'
              ? 'Applying model…'
              : 'Preparing model…'}
          </span>
          <Button
            variant="outline"
            disabled={busy}
            onClick={async () => {
              generation.current++;
              sending.current = true;
              setBusy(true);
              try {
                const fresh = await rigAudioState();
                if (
                  fresh.control?.session !== state.control?.session ||
                  fresh.control?.model_change?.node !== modelChange.node ||
                  fresh.control?.model_change?.progress.request !==
                    modelChange.progress.request
                )
                  throw new Error(
                    'Model selection changed. Review it before cancelling.',
                  );
                accept(
                  await rigAudioCommand(fresh, {
                    kind: 'model',
                    command: {
                      session: fresh.control.session,
                      expected_revision: fresh.control.revision,
                      node: modelChange.node,
                      operation: { kind: 'cancel' },
                    },
                  }),
                );
              } catch (cause) {
                if (alive.current) setError(String(cause));
              } finally {
                sending.current = false;
                if (alive.current) setBusy(false);
              }
            }}
          >
            Cancel model
          </Button>
        </div>
      )}
      {modelChange?.progress.error && (
        <p role="alert" className="error">
          {modelChange.progress.error}
        </p>
      )}
      {laneSlot && effectLanes.length > 0 && state.configured && (
        <SlotChooser
          sampleRate={state.configured.stream.input.sample_rate}
          presetName={matching?.manifest.name ?? 'this preset'}
          modified={!!changed}
          allowEffects
          modelsAllowed={laneSlot.node !== END}
          placement="here"
          onCancel={() => setLaneSlot(null)}
          onModel={(format) => {
            setPicker({
              opening: state,
              node: laneSlot.node,
              target: laneSlot.target,
              name: 'Empty slot',
              insert: true,
              format,
            });
            setLaneSlot(null);
          }}
          onEffect={(plugin) => {
            const slot = laneSlot;
            setLaneSlot(null);
            void editChain((lanes) => {
              const effect = lv2Effect(plugin);
              if (slot.node === END)
                return insertBlock(
                  lanes,
                  Number(slot.target),
                  Infinity,
                  effect,
                );
              // An empty slot inside a TONE3000 chain: the effect goes after it.
              const lane = lanes.findIndex((l) =>
                l.some((b) => b.id === slot.node),
              );
              const at = lanes[lane]!.findIndex((b) => b.id === slot.node);
              return insertBlock(lanes, lane, at + 1, effect);
            });
          }}
        />
      )}
      {laneSlot && !effectLanes.length && (
        <AddBlockChooser
          onCancel={() => setLaneSlot(null)}
          onChoose={(format) => {
            setPicker({
              opening: state,
              node: laneSlot.node,
              target: laneSlot.target,
              name: 'Empty slot',
              insert: true,
              format,
            });
            setLaneSlot(null);
          }}
        />
      )}
      {insertion && (
        <AdjustmentDialog
          title={`Add ${insertion.format.toUpperCase()} · position`}
          onCancel={() => setInsertion(null)}
        >
          <p className="caption">
            Choose an available position in the selected native chain.
          </p>
          <div
            className="grid gap-2"
            aria-label="Available insertion positions"
          >
            {insertion.opening.control?.slots
              ?.find((row) => row.node === insertion.node)
              ?.slots.map((slot) => (
                <Button
                  key={slot.target}
                  variant="outline"
                  disabled={
                    disabled ||
                    state.session !== insertion.opening.session ||
                    state.revision !== insertion.opening.revision ||
                    state.control?.session !==
                      insertion.opening.control?.session ||
                    state.control?.revision !==
                      insertion.opening.control?.revision
                  }
                  onClick={() => {
                    const latest = current.current;
                    if (
                      !latest ||
                      latest.session !== insertion.opening.session ||
                      latest.revision !== insertion.opening.revision ||
                      latest.control?.session !==
                        insertion.opening.control?.session ||
                      latest.control?.revision !==
                        insertion.opening.control?.revision
                    )
                      return;
                    setPicker({
                      opening: insertion.opening,
                      node: insertion.node,
                      target: slot.target,
                      name: `${slot.position.lane === 0 ? 'Left' : 'Right'} chain · position ${slot.position.index + 1}`,
                      insert: true,
                      format: insertion.format,
                    });
                    setInsertion(null);
                  }}
                >
                  {slot.position.lane === 0 ? 'Left' : 'Right'} chain · position{' '}
                  {slot.position.index + 1}
                </Button>
              ))}
          </div>
          {(state.session !== insertion.opening.session ||
            state.revision !== insertion.opening.revision ||
            state.control?.session !== insertion.opening.control?.session ||
            state.control?.revision !==
              insertion.opening.control?.revision) && (
            <p role="status">
              The chain changed. Close and choose the position again.
            </p>
          )}
        </AdjustmentDialog>
      )}
      {picker && (
        <ModelPicker
          name={picker.name}
          initialFormat={picker.format}
          allowedFormat={picker.allowedFormat}
          intent={picker.insert ? 'add' : 'replace'}
          comparison={
            picker.insert
              ? undefined
              : {
                  pending: modelPending,
                  appliedAsset:
                    modelChange?.node === picker.node &&
                    modelChange?.progress.request === picker.request &&
                    modelChange.progress.phase === 'applied'
                      ? modelChange.progress.assignment.asset
                      : undefined,
                  error:
                    modelChange?.node === picker.node &&
                    modelChange?.progress.request === picker.request
                      ? modelChange.progress.error
                      : undefined,
                  blocked:
                    state.session !== picker.opening.session ||
                    state.control?.session !== picker.opening.control?.session,
                }
          }
          onClose={() => setPicker(null)}
          onAudition={async (asset) => {
            generation.current++;
            sending.current = true;
            setBusy(true);
            try {
              const current = await rigAudioState();
              if (
                current.control?.session !== picker.opening.control?.session ||
                !current.control ||
                (picker.request != null &&
                  current.control.model_change?.node !== picker.node)
              )
                throw new Error(
                  'The playing preset changed. Close and reopen the model browser.',
                );
              assertAuditionOwner(
                picker.opening,
                current,
                picker.request,
                current.control.model_change?.progress,
              );
              const control = current.control;
              const next = await rigAudioCommand(current, {
                kind: 'model',
                command: {
                  session: control.session,
                  expected_revision: control.revision,
                  node: picker.node,
                  operation: {
                    kind: 'prepare',
                    assignment: { target: picker.target, asset },
                  },
                },
              });
              accept(next);
              if (alive.current) {
                setPicker({
                  ...picker,
                  request: next.control?.model_change?.progress.request,
                });
                setError('');
              }
            } finally {
              sending.current = false;
              if (alive.current) setBusy(false);
            }
          }}
        />
      )}
      {running &&
        selectedView &&
        (selectedView.branch || selectedView.bypass) && (
          <div className="selected-node" aria-label="Selected block">
            <h3 className="min-w-0 flex-1 break-words">{selectedView.label}</h3>
            {editable && selected.kind === 'lv2' && (
              <div className="action-row" role="group" aria-label="Arrange">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Move ${selectedView.label} left`}
                  disabled={disabled || !!edit || editing || place.first}
                  onClick={() => void shift(selected.id, -1)}
                >
                  <CaretLeft aria-hidden="true" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Move ${selectedView.label} right`}
                  disabled={disabled || !!edit || editing || place.last}
                  onClick={() => void shift(selected.id, 1)}
                >
                  <CaretRight aria-hidden="true" />
                </Button>
                <Button
                  variant="ghost"
                  disabled={disabled || !!edit || editing}
                  onClick={() =>
                    void editChain((lanes) => removeBlock(lanes, selected.id))
                  }
                >
                  <Trash aria-hidden="true" /> Remove
                </Button>
              </div>
            )}
            {selectedView.branch ? (
              <LedToggle
                on={selectedView.branch.enabled}
                kind={selectedView.block.kind}
                state={selectedView.branch.partial ? 'Mixed' : undefined}
                label={`Toggle branch ${selectedView.branch.name}`}
                disabled={disabled || !!edit}
                onToggle={() =>
                  void command({
                    kind: 'branch',
                    command: {
                      session: state.control!.session,
                      expected_revision: state.control!.revision,
                      branch: selectedView.branch!.id,
                      enabled: !selectedView.branch!.enabled,
                    },
                  })
                }
              />
            ) : (
              <LedToggle
                on={selectedView.bypass!.value !== 1}
                kind={selectedView.block.kind}
                label={`${selectedView.label} on`}
                disabled={disabled || !!edit}
                onToggle={() =>
                  void command({
                    kind: 'control',
                    command: {
                      session: state.control!.session,
                      expected_revision: state.control!.revision,
                      target: selectedView.bypass!.target,
                      value: selectedView.bypass!.value === 1 ? 0 : 1,
                    },
                  })
                }
              />
            )}
          </div>
        )}
      {running && (
        <div
          className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4"
          aria-label="Selected effect controls"
        >
          {visibleControls.map((c) => (
            <Button
              key={key(c)}
              className="h-auto min-h-16 flex-col items-start gap-1 p-3 text-left whitespace-normal"
              variant="outline"
              disabled={disabled || !!edit}
              onClick={() => {
                if (c.toggle && state.control) {
                  void command({
                    kind: 'control',
                    command: {
                      session: state.control.session,
                      expected_revision: state.control.revision,
                      target: c.target,
                      value: c.value === c.minimum ? c.maximum : c.minimum,
                    },
                  });
                } else open(c);
              }}
              aria-pressed={c.toggle ? c.value !== c.minimum : undefined}
              aria-haspopup={c.toggle ? undefined : 'dialog'}
              aria-label={`Adjust ${controlLabel(c.label)}`}
            >
              <span className="break-words">{controlLabel(c.label)}</span>
              <strong className="font-mono">{controlDisplay(c)}</strong>
            </Button>
          ))}
          {!matching ? (
            <p>Reading chain…</p>
          ) : (
            !nodes.length && <p>Input → Output</p>
          )}
        </div>
      )}
      {running &&
        selected &&
        state.control?.authoring?.find((row) => row.node === selected.id) && (
          <NativeAuthoring
            key={`${state.control.session}:${selected.id}`}
            status={
              state.control.authoring.find((row) => row.node === selected.id)!
                .status
            }
            selectedBlock={eqBlock?.block_id}
            disabled={unavailable || !!edit}
            busy={busy}
            session={state.control.session}
            revision={state.control.revision}
            author={async (action) => {
              const cursor = current.current?.control;
              if (!cursor) return;
              await command({
                kind: 'authoring',
                command: {
                  session: cursor.session,
                  expected_revision: cursor.revision,
                  node: selected.id,
                  action,
                },
              });
            }}
          />
        )}
      {running && selected && eqBlock && (
        <div className="space-y-2">
          <LiveEq
            key={`${state.control!.session}:${selected.id}:${eqBlock.block_id}`}
            state={{ ...state, eq: eqBlocks }}
            blockId={eqBlock.block_id}
            disabled={
              !connected ||
              busy ||
              !!edit ||
              !!readError ||
              modelPending ||
              !!measuring
            }
            onEditing={(editing) => {
              generation.current++;
              sending.current = editing;
              setEqBusy(editing);
            }}
            onChange={accept}
            gesture={
              wholeNative
                ? async (current, edit) => {
                    const next = await rigAudioCommand(current, {
                      kind: 'authoring',
                      command: {
                        session: current.control!.session,
                        expected_revision: current.control!.revision,
                        node: selected.id,
                        action: { kind: 'gesture', edit },
                      },
                    });
                    return {
                      ...next,
                      eq:
                        next.control?.eq?.find((e) => e.node === selected.id)
                          ?.blocks ?? [],
                    };
                  }
                : undefined
            }
            send={async (current, edit) => {
              const next = wholeNative
                ? await rigAudioCommand(current, {
                    kind: 'authoring',
                    command: {
                      session: current.control!.session,
                      expected_revision: current.control!.revision,
                      node: selected.id,
                      action: { kind: 'eq', block_id: eqBlock.block_id, edit },
                    },
                  })
                : await rigAudioCommand(current, {
                    kind: 'eq',
                    command: {
                      session: current.control!.session,
                      expected_revision: current.control!.revision,
                      node: selected.id,
                      block_id: eqBlock.block_id,
                      edit,
                    },
                  });
              return {
                ...next,
                eq:
                  next.control?.eq?.find((e) => e.node === selected.id)
                    ?.blocks ?? [],
              };
            }}
          />
        </div>
      )}
      {edit && (
        <AdjustmentDialog
          title={edit.control.label}
          onCancel={() => {
            if (!busy) void finish(true);
          }}
        >
          <TouchAdjust
            label={edit.control.label}
            value={scale?.normalized(edit.value) ?? edit.value}
            baseline={
              scale?.normalized(edit.control.value) ?? edit.control.value
            }
            min={scale ? 0 : edit.control.minimum}
            max={scale ? 1 : edit.control.maximum}
            step={0.001}
            snap={scale?.snap}
            nudge={scale?.nudge}
            disabled={disabled}
            onChange={(v) => {
              const value = scale?.native(v) ?? v;
              latest.current = value;
              setEdit({ ...edit, value });
              queue.current?.preview(value);
            }}
            format={
              edit.control.target.kind === 'native'
                ? (value) => {
                    const confirmed =
                      state.control?.controls.find(
                        (item) => key(item) === key(edit.control),
                      ) ?? edit.control;
                    return confirmedControlDisplay(
                      confirmed.display,
                      (scale?.native(value) ?? value) !== confirmed.value,
                    );
                  }
                : (scale?.format ?? String)
            }
          />
          <div className="action-row">
            <Button disabled={busy} onClick={() => void finish(false)}>
              Done
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => void finish(true)}
            >
              Cancel
            </Button>
          </div>
          {error && <p role="alert">{error}</p>}
        </AdjustmentDialog>
      )}
      <SceneMidi
        state={state}
        disabled={disabled || !!edit}
        onCommand={async (action) => {
          await command(action);
        }}
      />
      {saveOpening && (
        <AdjustmentDialog
          title="Save copy"
          onCancel={() => {
            if (!busy) setSaveOpening(null);
          }}
        >
          <p className="caption">
            Keep this sound for offline use. The original rig stays unchanged.
          </p>
          <div className="form-grid">
            <label className="field">
              Preset name
              <input
                disabled={busy}
                value={name}
                maxLength={128}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <Button
              disabled={
                disabled ||
                !matching ||
                !!edit ||
                !!state.save?.running ||
                !name.trim() ||
                saveStale
              }
              onClick={() => void saveCopy()}
            >
              {busy ? 'Saving…' : 'Save'}
            </Button>
          </div>
          {saveStale && (
            <p role="status">The rig changed. Close and reopen Save copy.</p>
          )}
          {error && <p role="alert">{error}</p>}
        </AdjustmentDialog>
      )}
      {currentSave?.error && <p role="alert">{currentSave.error}</p>}
      {currentSave?.saved_revision && (
        <p role="status">
          {changed
            ? 'Saved earlier settings · newer edits remain'
            : 'Saved for offline use'}
        </p>
      )}
    </section>
  );
}
