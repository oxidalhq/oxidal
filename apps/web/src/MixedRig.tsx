import { friendlyError, errorDetails } from './lib/friendlyError';
import { AddBlockChooser } from './AddBlockChooser';
import { MasterLevel } from './MasterLevel';
import { ScenePads } from './ScenePads';
import { SceneChange } from './SceneChange';
import { SlotChooser } from './SlotChooser';
import { lv2Effect, terminalEffect } from './rigDraft';
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
  Lightning,
  PlugsConnected,
  ArrowsClockwise,
} from '@phosphor-icons/react';
import { RigTopology } from './RigTopology';
import { GearIcon } from './GearIcon';
import { ChainView, LedToggle, RigTile } from './ChainView';
import type { RigBlockVM, RigLaneVM } from './rigChain';
import {
  blockKind,
  chainLanes,
  chainRoute,
  isRigBlockNode,
  routeBranchOf,
} from './rigChain';
import {
  buildRoute,
  readRoute,
  routeAddBranch,
  routeAddPath,
  routeCopyBranch,
  routeInsert,
  routeLanes,
  routeMove,
  routeRemove,
  routeRemoveBranch,
  type Route,
} from './rigRoute';
import { NativeAuthoring } from './NativeAuthoring';
import { SceneMidi } from './SceneMidi';
import { ModelPicker } from './ModelPicker';
import { ArtworkDeck } from './AssetArtwork';
import { ToneDetails } from './ToneDetails';
import { PerformView } from './PerformView';
import { setPerform, usePerform } from './performState';
import { LiveEq } from './LiveEq';
import { RecoveryNotice } from './RecoveryNotice';
import { useCallback, useEffect, useRef, useState } from 'react';
import { rigNodeLabel } from './rigDraft';
import { Button } from './components/ui/button';
import { Badge } from './components/ui/badge';
import { AdjustmentDialog } from './AdjustmentDialog';
import { FailureNotice } from './components/ui/failure';
import { useFailure } from './lib/useFailure';
import { TouchAdjust } from './TouchAdjust';
import { EditQueue } from './editQueue';
import { controlDisplay, controlLabel, lv2Control } from './lv2Control';
import {
  rigAudioState,
  sceneDraft as sharedSceneDraft,
  presetArtwork,
  installedLv2,
  libraryCatalog,
  publishRig,
  rigLibrary,
  rigAudioCommand,
  rigDocument,
  removalPreview,
  removePreset,
  type RigAudioState,
  type RigAudioAction,
  type RigControl,
  type RigDocument,
  type Lv2Plugin,
} from './api';
import type { RigPublish } from './generated/contract';
import {
  addSceneEffect,
  branchEffects,
  removeSceneEffect,
  updateScenes,
  type NewScene,
} from './sceneEdit';
import { requestMidiAssignments } from './midiNavigation';
import { TunerButton } from './TunerButton';

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
  /** Failed chain edits keep their recovery action (7.24). */
  const {
    failure: editFailure,
    fail: failEdit,
    clear: clearEdit,
  } = useFailure();
  const [readError, setReadError] = useState('');
  const [name, setName] = useState('');
  const [saveOpening, setSaveOpening] = useState<RigAudioState | null>(null);
  const [sceneDraft, setSceneDraft] = useState<{
    session: string;
    scene: string;
  } | null>(readSceneEdit);
  /** Update scene writes here; Save persists it (7.7). Bound to one session. */
  const [sceneUpdates, setSceneUpdates] = useState<SceneDraft | null>(
    readSceneDraft,
  );
  const [namingScene, setNamingScene] = useState<string | null>(null);
  /** Save while the heard mix differs from its scene asks what to keep (V37). */
  const [saveReview, setSaveReview] = useState(false);
  const [copyOnEdit, setCopyOnEdit] = useState<{
    copy: string;
    source: string;
    sourceName: string;
  } | null>(() => {
    try {
      const saved: unknown = JSON.parse(
        sessionStorage.getItem('oxidal.mixed.copy-on-edit') ?? 'null',
      );
      return saved &&
        typeof saved === 'object' &&
        'copy' in saved &&
        typeof saved.copy === 'string' &&
        'source' in saved &&
        typeof saved.source === 'string' &&
        'sourceName' in saved &&
        typeof saved.sourceName === 'string'
        ? {
            copy: saved.copy,
            source: saved.source,
            sourceName: saved.sourceName,
          }
        : null;
    } catch {
      return null;
    }
  });
  const promoting = useRef(false);
  const resolvingCopy = useRef(false);
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
        if (alive.current) setReadError(friendlyError(cause, 'read the rig'));
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
          if (active) setError(friendlyError(e, 'update the rig'));
        });
    return () => {
      active = false;
    };
  }, [revision]);
  const matching = document?.revision === revision ? document : null;
  const sourceOrigin = (() => {
    const value = matching?.manifest.extensions['urn:oxidal:authoring']?.origin;
    return value === 'tone3000' || value === 'oxidal_example' ? value : 'mine';
  })();
  // Unsaved scene updates survive a reload of this tab; they stay bound to
  // the audio session, so a restarted or different preset ignores them.
  useEffect(() => {
    try {
      if (sceneUpdates)
        sessionStorage.setItem(SCENE_DRAFT_KEY, JSON.stringify(sceneUpdates));
      else sessionStorage.removeItem(SCENE_DRAFT_KEY);
    } catch {
      /* storage unavailable: the draft lives only in this page */
    }
  }, [sceneUpdates]);
  // The device holds the same draft for every browser (7.7): another tab or
  // device sees Update scene at once, and a new tab picks it up. An older
  // daemon without it leaves the draft to this tab, as before.
  const draftRevision = useRef<number | null>(null);
  const draftFromDevice = useRef(false);
  const draftPushes = useRef(0);
  const draftShared = useRef(true);
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const remote = await sharedSceneDraft();
        if (!active) return;
        if (!remote) {
          draftShared.current = false;
          return;
        }
        if (draftPushes.current || remote.revision === draftRevision.current)
          return;
        const first = draftRevision.current === null;
        draftRevision.current = remote.revision;
        if (first && !remote.draft) {
          // This tab kept a draft from before; share it.
          setSceneUpdates((local) => {
            if (local) void pushDraft(local);
            return local;
          });
          return;
        }
        const next = (remote.draft as SceneDraft | null) ?? null;
        setSceneUpdates((local) => {
          if (JSON.stringify(local) === JSON.stringify(next)) return local;
          draftFromDevice.current = true;
          return next;
        });
      } catch {
        /* unreachable for now; the next poll tries again */
      } finally {
        if (active && draftShared.current)
          timer = setTimeout(() => void poll(), 1500);
      }
    };
    void poll();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, []);
  async function pushDraft(draft: SceneDraft | null) {
    if (!draftShared.current) return;
    draftPushes.current++;
    try {
      const saved = await sharedSceneDraft({
        draft: draft && { ...draft, added: draft.added ?? [] },
      });
      if (saved) draftRevision.current = saved.revision;
    } catch {
      /* kept in this tab; the next change shares it again */
    } finally {
      draftPushes.current--;
    }
  }
  useEffect(() => {
    if (draftFromDevice.current) {
      draftFromDevice.current = false;
      return;
    }
    if (draftRevision.current !== null) void pushDraft(sceneUpdates);
  }, [sceneUpdates]);
  useEffect(() => {
    try {
      if (sceneDraft)
        sessionStorage.setItem(SCENE_EDIT_KEY, JSON.stringify(sceneDraft));
      else sessionStorage.removeItem(SCENE_EDIT_KEY);
    } catch {
      /* storage unavailable */
    }
  }, [sceneDraft]);
  useEffect(() => {
    if (copyOnEdit)
      sessionStorage.setItem(
        'oxidal.mixed.copy-on-edit',
        JSON.stringify(copyOnEdit),
      );
    else sessionStorage.removeItem('oxidal.mixed.copy-on-edit');
  }, [copyOnEdit]);
  useEffect(() => {
    if (
      !resolvingCopy.current &&
      revision &&
      copyOnEdit &&
      revision !== copyOnEdit.copy
    )
      setCopyOnEdit(null);
  }, [revision, copyOnEdit]);
  useEffect(() => {
    if (copyOnEdit) setPerform({ on: false });
  }, [copyOnEdit]);
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
  async function promoteMixedEdit(after: RigAudioState) {
    const source = matching;
    if (
      !source ||
      sourceOrigin === 'mine' ||
      copyOnEdit ||
      promoting.current ||
      !after.control?.modified
    )
      return;
    promoting.current = true;
    try {
      const copyName =
        Array.from(source.manifest.name).slice(0, 100).join('').trim() ||
        'My preset';
      let cursor = await rigAudioCommand(after, {
        kind: 'save',
        name: copyName,
      });
      accept(cursor);
      const until = performance.now() + 65_000;
      while (cursor.save?.running) {
        if (performance.now() > until)
          throw new Error(
            'Automatic copy timed out; check Mine before retrying.',
          );
        await new Promise((resolve) => setTimeout(resolve, 150));
        cursor = await rigAudioState();
        accept(cursor);
      }
      if (cursor.save?.error) throw new Error(cursor.save.error);
      const copy = cursor.save?.saved_revision;
      if (!copy) throw new Error('Automatic copy did not return a revision.');
      await playScenes(copy);
      accept(await rigAudioState());
      setCopyOnEdit({
        copy,
        source: source.revision,
        sourceName: source.manifest.name,
      });
    } finally {
      promoting.current = false;
    }
  }
  async function command(action: RigAudioAction) {
    if (!current.current || sending.current) return;
    const control = current.current.control;
    if (action.kind === 'branch' && control?.scene)
      setSceneDraft({ session: control.session, scene: control.scene });
    generation.current++;
    sending.current = true;
    setBusy(true);
    setError('');
    try {
      let next: RigAudioState;
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
        next = await rigAudioCommand(cursor, {
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
        });
        accept(next);
      } else {
        next = await rigAudioCommand(current.current, action);
        accept(next);
      }
      if (['authoring', 'control', 'eq', 'model'].includes(action.kind))
        await promoteMixedEdit(next);
      return true;
    } catch (cause) {
      setError(friendlyError(cause, 'update the rig'));
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
  /** Saves the scene draft in one publish; `withMix` also updates the scene
   * being edited to the mix heard now. */
  function saveScenes(withMix: boolean) {
    setSaveReview(false);
    const gains =
      withMix && editingScene
        ? { ...drafts, [editingScene.id]: editingSceneGains }
        : drafts;
    return rebuild(({ opened, live, name }) =>
      updateScenes(
        opened,
        gains,
        current.current?.control?.scene ?? undefined,
        live,
        name,
        addedScenes,
      ),
    );
  }
  /** Sets one path's merge level on both channels, one confirmed command each. */
  async function setPathLevel(targets: RigControl['target'][], value: number) {
    for (const target of targets) {
      const cursor = current.current?.control;
      if (
        !cursor ||
        !(await command({
          kind: 'control',
          command: {
            session: cursor.session,
            expected_revision: cursor.revision,
            target,
            value,
          },
        }))
      )
        return;
    }
  }
  /** Recalls a scene; a drafted update then replaces its saved snapshot live. */
  async function recallScene(scene: string) {
    const control = current.current?.control;
    if (!control) return;
    const recalled = await command({
      kind: 'scene',
      command: {
        session: control.session,
        expected_revision: control.revision,
        scene,
      },
    });
    const draft =
      sceneUpdates?.session === control.session
        ? sceneUpdates.gains[scene]
        : undefined;
    for (const gain of recalled ? (draft ?? []) : []) {
      const cursor = current.current?.control;
      if (!cursor || cursor.scene !== scene) return;
      const live = cursor.controls.find(
        (c) =>
          c.target.kind === 'merge' &&
          c.target.node === gain.node &&
          c.target.port === gain.port,
      );
      if (live && Math.abs(live.value - gain.value) <= 0.0001) continue;
      if (
        !(await command({
          kind: 'control',
          command: {
            session: cursor.session,
            expected_revision: cursor.revision,
            target: { kind: 'merge', node: gain.node, port: gain.port },
            value: gain.value,
          },
        }))
      )
        return;
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
      if (alive.current) setError(friendlyError(cause, 'update the rig'));
    } finally {
      if (alive.current) setSwitching(false);
    }
  }
  const [editing, setEditing] = useState(false);
  /** The stage view: scene pads and effect switches, nothing to edit. */
  const { on: performing } = usePerform();
  const setPerforming = (on: boolean) => setPerform({ on });
  /** An edit waiting for the player to accept losing unsaved block edits. */
  const [unsaved, setUnsaved] = useState<(() => Promise<void>) | null>(null);
  /** Builds the next version of this preset, plays it and hides the one it
   * replaces, so the library keeps one preset. Edits to the blocks inside a
   * TONE3000 chain that were not saved are not carried over, so the player
   * confirms first. */
  function rebuild(
    make: (context: {
      opened: RigDocument;
      plugins: Lv2Plugin[];
      live: Record<string, Record<string, number>>;
      name: string;
      profile: string;
    }) => RigPublish,
  ) {
    const run = async () => {
      const opened = document?.revision === revision ? document : null;
      if (!opened || editing) return;
      clearEdit();
      setEditing(true);
      setError('');
      try {
        const rate =
          current.current?.configured?.stream.input.sample_rate ?? 48000;
        const live: Record<string, Record<string, number>> = {};
        for (const c of current.current?.control?.controls ?? [])
          if (c.target.kind === 'lv2')
            (live[c.target.node] ??= {})[c.target.symbol] = c.value;
        const [plugins, library, catalog] = await Promise.all([
          installedLv2(rate),
          rigLibrary(),
          libraryCatalog(),
        ]);
        const listed = catalog.items.find(
          (i) => i.kind === 'rig' && i.id === opened.revision,
        );
        const origin = listed?.origin ?? sourceOrigin;
        const request = make({
          opened,
          plugins,
          live,
          name: listed?.name ?? opened.manifest.name,
          profile: library.native_profile,
        });
        const manifest = JSON.parse(
          request.manifest_json,
        ) as RigDocument['manifest'];
        if (origin !== 'mine') {
          manifest.id = crypto.randomUUID();
          manifest.extensions['urn:oxidal:authoring'] = {
            ...(manifest.extensions['urn:oxidal:authoring'] ?? {}),
            origin: 'mine',
          };
          request.manifest_json = JSON.stringify(manifest);
        }
        request.source = { kind: 'rig', id: opened.revision };
        const published = await publishRig(request);
        await playScenes(published.revision);
        accept(await rigAudioState());
        // The daemon puts the new revision in the earlier one's place (7.2).
        if (origin !== 'mine')
          setCopyOnEdit({
            copy: published.revision,
            source: opened.revision,
            sourceName: listed?.name ?? opened.manifest.name,
          });
      } catch (cause) {
        if (alive.current)
          failEdit(cause, 'change the preset', () => void run());
      } finally {
        if (alive.current) setEditing(false);
      }
    };
    if (changed) setUnsaved(() => run);
    else return run();
  }
  /** Rebuilds this preset with a change to its chain of blocks. */
  function editChain(change: (route: Route) => Route) {
    return rebuild(({ opened, plugins, live, name, profile }) =>
      buildRoute(
        opened.manifest.id,
        name,
        change(readRoute(opened, plugins, live)),
        profile,
      ),
    );
  }
  /** One place left or right within the block's lane. */
  function shift(id: string, step: -1 | 1) {
    return editChain((route) => {
      const lanes = routeLanes(route);
      const lane = lanes.findIndex((l) => l.some((b) => b.id === id));
      const at = lanes[lane]?.findIndex((b) => b.id === id) ?? -1;
      return routeMove(route, id, at + step, lane);
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
      if (alive.current) setError(friendlyError(cause, 'update the rig'));
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
        if (alive.current) setError(friendlyError(e, 'update the rig'));
      },
    );
  }
  async function finish(cancel: boolean) {
    const pending = queue.current;
    if (!pending) return;
    setBusy(true);
    try {
      if (cancel) await pending.cancel();
      else {
        await pending.finish(latest.current);
        if (current.current) await promoteMixedEdit(current.current);
      }
    } catch (e) {
      if (alive.current) setError(friendlyError(e, 'update the rig'));
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
  async function resolveMixedCopy(keep: boolean) {
    const copy = copyOnEdit;
    if (!copy || busy) return;
    if (keep) {
      setCopyOnEdit(null);
      return;
    }
    setBusy(true);
    resolvingCopy.current = true;
    setError('');
    try {
      await playScenes(copy.source);
      accept(await rigAudioState());
      const preview = await removalPreview({
        entry_kind: 'rig',
        id: copy.copy,
      });
      if (preview.blocked)
        throw new Error(
          `The automatic copy could not be discarded: ${preview.blocked}`,
        );
      await removePreset({
        entry_kind: 'rig',
        id: copy.copy,
        expected_preview: preview.token,
        delete_models: false,
      });
      setCopyOnEdit(null);
    } catch (cause) {
      setError(
        `The original is playing, but the copy remains in Mine: ${errorDetails(cause)}`,
      );
    } finally {
      resolvingCopy.current = false;
      if (alive.current) setBusy(false);
    }
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
          face: <GearIcon gear={gear} name={name} />,
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
      (gain) => gain.value > 0 && gain.node.startsWith(`scene-feed-${index}-`),
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
    void editChain((route) => routeMove(route, id, index, lane));
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
  function switchTile(tile: string) {
    const at = laneTarget(tile);
    const control = current.current?.control;
    if (!at || !control) return;
    const hold = holdOf(at.node);
    const toggle = hold ?? (at.block ? nativeSwitch(at.node, at.block) : null);
    const bypass = control.controls.find(
      (c) => c.target.kind === 'bypass' && c.target.node === at.node,
    );
    const [target, value] = toggle
      ? [
          toggle.target,
          toggle.value === toggle.minimum ? toggle.maximum : toggle.minimum,
        ]
      : bypass
        ? [bypass.target, bypass.value === 1 ? 0 : 1]
        : [null, 0];
    if (!target) return;
    void command({
      kind: 'control',
      command: {
        session: control.session,
        expected_revision: control.revision,
        target,
        value,
      },
    });
  }
  const performSwitching = switching || state.phase === 'starting';
  if (performing && (running || performSwitching))
    return (
      <>
        <PerformView
          now={{
            session: state.session,
            playing: running,
            name: matching?.manifest.name,
            modified: !!changed,
          }}
          lanes={stageLanes}
          disabled={disabled || !!edit || editing || performSwitching}
          switching={performSwitching}
          onToggle={switchTile}
          onEdit={() => setPerforming(false)}
          scenes={
            !!state.control?.scenes?.scenes.length && (
              <ScenePads
                scenes={state.control.scenes.scenes}
                active={state.control.scene}
                fading={!!state.control.scene_transitioning}
                disabled={disabled || !!edit}
                onSelect={(scene) => void recallScene(scene)}
              />
            )
          }
          selector={
            <RigPresetSelector
              current={{
                key: revision
                  ? choiceKey({
                      kind: 'scenes',
                      revision,
                    })
                  : '',
                name: matching?.manifest.name,
                modified: !!changed,
                refresh: revision,
              }}
              disabled={
                disabled ||
                busy ||
                switching ||
                !!edit ||
                !!picker ||
                !!copyOnEdit
              }
              pads
              all
              onSelect={(choice) => void choose(choice)}
            />
          }
        />
        {error && <p role="alert">{error}</p>}
      </>
    );
  return (
    <section
      className="panel rig-editor space-y-3"
      aria-label="Sounding mixed rig"
      data-loading={performSwitching || undefined}
    >
      <div className="rig-performance-header">
        <RigPresetSelector
          current={{
            key: revision
              ? choiceKey({
                  kind: 'scenes',
                  revision,
                })
              : '',
            name: matching?.manifest.name,
            modified: !!changed,
            refresh: revision,
          }}
          disabled={
            disabled || busy || switching || !!edit || !!picker || !!copyOnEdit
          }
          onSelect={(choice) => void choose(choice)}
        />
        <Button
          variant="outline"
          aria-label="MIDI assignments"
          title="Assign this preset's scenes, switches and controls"
          disabled={disabled || busy || switching || !!edit || !!picker}
          onClick={requestMidiAssignments}
        >
          <PlugsConnected aria-hidden="true" />
          <span className="phone-hidden">MIDI</span>
        </Button>
        <Button
          variant="outline"
          aria-label="Save copy"
          title={
            draftCount ? 'Save or discard your scene updates first' : undefined
          }
          disabled={
            disabled ||
            !matching ||
            !!edit ||
            !!picker ||
            !!state.save?.running ||
            draftCount > 0
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
        <Button
          aria-label="Perform view"
          title="Scene pads and effect switches for playing live"
          disabled={!running || disabled || !!edit || editing}
          onClick={() => setPerforming(true)}
        >
          <Lightning aria-hidden="true" />
          <span className="phone-hidden">Perform</span>
        </Button>
        <TunerButton disabled={!running} />
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
      {performSwitching && (
        <div className="rig-switching" role="status" aria-live="polite">
          <ArrowsClockwise aria-hidden="true" />
          <span>
            <strong>Preparing preset…</strong>
            <small>The chain will appear when its audio state is ready.</small>
          </span>
        </div>
      )}
      {copyOnEdit && (
        <div
          className="rounded-md border border-border bg-card p-3"
          role="status"
        >
          <strong>Editing a copy of {copyOnEdit.sourceName}</strong>
          <p className="caption">
            Your first change created this preset in Mine. The original is
            unchanged.
          </p>
          <div className="action-row">
            <Button disabled={busy} onClick={() => void resolveMixedCopy(true)}>
              Keep copy
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => void resolveMixedCopy(false)}
            >
              Discard copy
            </Button>
          </div>
        </div>
      )}
      {unsaved && (
        <AdjustmentDialog
          title="Keep your edits?"
          onCancel={() => setUnsaved(null)}
        >
          <p>
            This changes the preset&apos;s effects by building a new version of
            it. Edits you made to the blocks inside its TONE3000 chains and have
            not saved are not carried over. Save a copy first to keep them.
          </p>
          <div className="action-row">
            <Button variant="outline" onClick={() => setUnsaved(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                const run = unsaved;
                setUnsaved(null);
                void run();
              }}
            >
              Continue
            </Button>
          </div>
        </AdjustmentDialog>
      )}
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
      {!!state.control?.prepared?.length && (
        <details className="ready-presets">
          <summary>
            <span>Ready to switch</span>
            <Badge>{state.control.prepared.length + 1} presets</Badge>
            <span className="ready-presets-state">
              {state.control.prepared.length + 1} loaded ·{' '}
              {1 +
                state.control.prepared.filter((preset) => preset.rendering)
                  .length}{' '}
              processing
            </span>
          </summary>
          <p className="caption">
            Loaded presets can switch without reopening audio. Playing is the
            sound you hear; Processing is still rendering a tail; Sleeping is
            loaded but using no DSP. These are presets, not scenes.
          </p>
          <div
            className="ready-presets-list"
            role="group"
            aria-label="Ready presets"
          >
            <div className="ready-preset-current">
              <strong>{matching?.manifest.name ?? 'Current preset'}</strong>
              <Badge>Playing</Badge>
              <Badge>Processing</Badge>
            </div>
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
                {!p.error && (
                  <Badge>{p.rendering ? 'Processing' : 'Sleeping'}</Badge>
                )}
              </Button>
            ))}
          </div>
        </details>
      )}
      {!!state.control?.scenes?.scenes.length && (
        <ScenePads
          extra={
            matching && (
              <SceneChange
                preset={matching.manifest.id}
                disabled={disabled}
                trails={
                  matching.manifest.extensions['urn:oxidal:authoring']
                    ?.scene_tails === 'preserve'
                }
              />
            )
          }
          scenes={state.control.scenes.scenes}
          active={state.control.scene}
          fading={!!state.control.scene_transitioning}
          disabled={disabled || !!edit}
          onSelect={(scene) => {
            const control = current.current?.control;
            if (control) {
              setSceneDraft({ session: control.session, scene });
              void recallScene(scene);
            }
          }}
        />
      )}
      {editingScene && (
        <details
          className="scene-context"
          open={sceneMixChanged || draftCount > 0 || undefined}
        >
          <summary>
            <span>
              {sceneMixChanged ? 'Editing scene' : 'Current scene'} ·{' '}
              <strong>{editingScene.name}</strong>
            </span>
            {sceneMixChanged ? (
              <Badge>Modified mix</Badge>
            ) : drafts[editingScene.id] ? (
              <Badge>Updated · not saved</Badge>
            ) : (
              !!sceneMix.length && (
                <span className="scene-context-mix">
                  {sceneMix
                    .filter((branch) => branch.value > 0)
                    .map(
                      (branch) =>
                        `${branch.name} ${Math.round(branch.value * 100)}%`,
                    )
                    .join(' · ') || 'All branches muted'}
                </span>
              )
            )}
          </summary>
          <p className="caption">
            {sceneMixChanged
              ? 'Branch routing changed for this scene. Update scene keeps this mix in your edits; Save keeps it in the preset.'
              : 'A scene recalls the branch levels shown here.'}{' '}
            Block controls are shared by every scene; use Save to keep those
            whole-preset edits.
          </p>
          {!!sceneMix.length && (
            <div className="scene-context-levels" aria-label="Scene mix">
              {sceneMix.map((branch) => (
                <Badge
                  key={branch.name}
                  data-state={branch.value > 0 ? 'active' : 'muted'}
                >
                  {branch.name} · {Math.round(branch.value * 100)}%
                </Badge>
              ))}
            </div>
          )}
          {sceneMixChanged && (
            <div className="scene-context-actions">
              <Button
                variant="outline"
                disabled={disabled || editing || !!edit || !!picker || busy}
                onClick={() => void recallScene(editingScene.id)}
              >
                Discard changes
              </Button>
              <Button
                disabled={disabled || editing || !!edit || !!picker}
                onClick={() => {
                  const session = state.control?.session;
                  if (!session) return;
                  setSceneUpdates({
                    session,
                    gains: { ...drafts, [editingScene.id]: editingSceneGains },
                    added: addedScenes,
                  });
                }}
              >
                Update scene
              </Button>
              <Button
                variant="outline"
                disabled={disabled || editing || !!edit || !!picker}
                onClick={() => setNamingScene('')}
              >
                Save as new scene…
              </Button>
            </div>
          )}
          {saveReview && (
            <AdjustmentDialog
              title="Save this preset?"
              onCancel={() => setSaveReview(false)}
            >
              <p>
                The mix you hear differs from {editingScene.name}. Choose what
                the preset keeps. Shared block settings are saved either way.
              </p>
              <div className="control-stack">
                <Button onClick={() => void saveScenes(true)}>
                  Update {editingScene.name} and save
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setSaveReview(false);
                    setNamingScene('');
                  }}
                >
                  Save as new scene…
                </Button>
                <Button
                  variant="outline"
                  disabled={draftCount === 0}
                  onClick={() => void saveScenes(false)}
                >
                  Save without this mix
                </Button>
                <Button variant="ghost" onClick={() => setSaveReview(false)}>
                  Cancel
                </Button>
              </div>
            </AdjustmentDialog>
          )}
          {namingScene !== null && (
            <AdjustmentDialog
              title="Save as new scene"
              onCancel={() => setNamingScene(null)}
            >
              <form
                className="control-stack"
                onSubmit={(event) => {
                  event.preventDefault();
                  const session = state.control?.session;
                  const label = namingScene.trim();
                  if (!session || !label) return;
                  setSceneUpdates({
                    session,
                    gains: drafts,
                    added: [
                      ...addedScenes,
                      {
                        id: `scene-${crypto.randomUUID().slice(0, 8)}`,
                        name: label,
                        gains: editingSceneGains,
                      },
                    ],
                  });
                  setNamingScene(null);
                }}
              >
                <label className="field">
                  <span>Scene name</span>
                  <input
                    className="h-11 w-full rounded-md border border-input bg-card px-3"
                    value={namingScene}
                    maxLength={128}
                    autoFocus
                    onChange={(event) => setNamingScene(event.target.value)}
                  />
                </label>
                <p className="caption">
                  Keeps the mix you hear now as a new scene. {editingScene.name}{' '}
                  stays as it was. Save keeps it in the preset.
                </p>
                <div className="action-row">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setNamingScene(null)}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" disabled={!namingScene.trim()}>
                    Add scene
                  </Button>
                </div>
              </form>
            </AdjustmentDialog>
          )}
          {(draftCount > 0 || sceneMixChanged) && (
            <div className="scene-context-actions" aria-label="Scene edits">
              <span className="caption" role="status">
                {draftCount === 0
                  ? 'The mix you hear is not saved in a scene yet.'
                  : draftCount === 1
                    ? '1 scene updated · not saved yet.'
                    : `${draftCount} scenes updated · not saved yet.`}
                {addedScenes.length > 0 &&
                  ` New: ${addedScenes.map((scene) => scene.name).join(', ')}.`}
              </span>
              <Button
                variant="outline"
                disabled={disabled || editing || !!edit || !!picker || busy}
                onClick={() => {
                  setSceneUpdates(null);
                  void recallScene(editingScene.id);
                }}
              >
                Discard scene updates
              </Button>
              <Button
                disabled={disabled || editing || !!edit || !!picker}
                onClick={() =>
                  sceneMixChanged ? setSaveReview(true) : void saveScenes(false)
                }
              >
                Save preset
              </Button>
            </div>
          )}
        </details>
      )}
      <RecoveryNotice message={state.recovery_error} />
      {(error || readError || state.error) && (
        <p role="alert" className="error">
          {error || readError || state.error}
        </p>
      )}
      <FailureNotice
        failure={editFailure}
        busy={editing}
        onRefresh={() => {
          clearEdit();
          void rigAudioState().then(accept, () => {});
        }}
      />
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
      {running && selectedToneId != null && (
        <ToneDetails toneId={selectedToneId} />
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
                if (alive.current)
                  setError(friendlyError(cause, 'update the rig'));
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
            void editChain((route) => {
              const effect =
                slot.node === END ? terminalEffect(plugin) : lv2Effect(plugin);
              if (slot.node === END)
                return routeInsert(
                  route,
                  Number(slot.target),
                  Infinity,
                  effect,
                );
              // An empty slot inside a TONE3000 chain: the effect goes after it.
              const lanes = routeLanes(route);
              const lane = lanes.findIndex((l) =>
                l.some((b) => b.id === slot.node),
              );
              const at = lanes[lane]!.findIndex((b) => b.id === slot.node);
              return routeInsert(route, lane, at + 1, effect);
            });
          }}
        />
      )}
      {laneSlot &&
        !effectLanes.length &&
        sceneLanes.length > 0 &&
        state.configured && (
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
              // The effect goes at the end of this scene, after its TONE3000 chain.
              const branch =
                slot.node === END
                  ? sceneBranches[Number(slot.target)]?.id
                  : slot.node;
              if (!branch) return;
              void rebuild(({ opened, live, name }) =>
                addSceneEffect(
                  opened,
                  branch,
                  slot.node === END
                    ? terminalEffect(plugin)
                    : lv2Effect(plugin),
                  live,
                  name,
                ),
              );
            }}
          />
        )}
      {laneSlot && !effectLanes.length && !sceneLanes.length && (
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
            <h3 className="selected-node-title">{selectedView.label}</h3>
            {sceneEffectSet.has(selected.id) && (
              <div className="action-row" role="group" aria-label="Arrange">
                <Button
                  variant="ghost"
                  disabled={disabled || !!edit || editing}
                  onClick={() =>
                    void rebuild(({ opened, live, name }) =>
                      removeSceneEffect(opened, selected.id, live, name),
                    )
                  }
                >
                  <Trash aria-hidden="true" /> Remove
                </Button>
              </div>
            )}
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
                    void editChain((route) => routeRemove(route, selected.id))
                  }
                >
                  <Trash aria-hidden="true" /> Remove
                </Button>
              </div>
            )}
            {inLane &&
              editable &&
              !sceneLanes.length &&
              selectedBranch.paths > 0 &&
              (() => {
                const sides = ['left', 'right'].map((side) =>
                  state.control?.controls.find(
                    (c) =>
                      c.target.kind === 'merge' &&
                      c.target.node === `${selectedBranch.merge}-${side}` &&
                      c.target.port === selectedBranch.port,
                  ),
                );
                if (!sides[0] || !sides[1]) return null;
                return (
                  <PathLevel
                    key={`${selectedBranch.merge}:${selectedBranch.port}:${sides[0].value}`}
                    path={selectedBranch.port + 1}
                    value={sides[0].value}
                    disabled={disabled || !!edit || editing || busy}
                    onCommit={(value) =>
                      setPathLevel(
                        sides.map((side) => side!.target),
                        value,
                      )
                    }
                  />
                );
              })()}
            {inLane && editable && !sceneLanes.length && (
              <div
                className="action-row"
                role="group"
                aria-label={`Routing for ${selectedView.label}`}
              >
                <Button
                  variant="outline"
                  disabled={disabled || !!edit || editing}
                  onClick={() =>
                    void editChain((route) => routeAddPath(route, selected.id))
                  }
                >
                  {selectedView.block.kind === 'cab'
                    ? 'Dual cab: add a cab path'
                    : 'Add parallel path'}
                </Button>
                {selectedBranch.found && selectedBranch.paths > 0 && (
                  <>
                    <Button
                      variant="outline"
                      disabled={disabled || !!edit || editing}
                      onClick={() =>
                        void editChain((route) =>
                          routeAddBranch(route, selected.id),
                        )
                      }
                    >
                      Add branch
                    </Button>
                    <Button
                      variant="outline"
                      disabled={disabled || !!edit || editing}
                      onClick={() =>
                        void editChain((route) =>
                          routeCopyBranch(route, selected.id),
                        )
                      }
                    >
                      Copy branch
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={disabled || !!edit || editing}
                      onClick={() =>
                        void editChain((route) =>
                          routeRemoveBranch(route, selected.id),
                        )
                      }
                    >
                      Remove branch
                    </Button>
                  </>
                )}
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
            collapseSettings
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
      {nativeLoad.engines > 0 && (
        <div className="rig-load-summary" aria-label="Native processing load">
          <Badge>
            {nativeLoad.engines}{' '}
            {nativeLoad.engines === 1 ? 'NAM block' : 'NAM blocks'}
          </Badge>
          <Badge>{nativeLoad.blocks} chain blocks</Badge>
          {nativeLoad.full + nativeLoad.lite + nativeLoad.scaled > 0 && (
            <Badge>
              A2 size · {nativeLoad.full} Full · {nativeLoad.lite} Lite
              {nativeLoad.scaled > 0 ? ` · ${nativeLoad.scaled} scaled` : ''}
            </Badge>
          )}
          {!!nativeLoad.oversampling.length && (
            <Badge>Oversampling · {nativeLoad.oversampling.join(' / ')}</Badge>
          )}
        </div>
      )}
      <SceneMidi
        trigger={false}
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

/** A path's level into its merge, set on both channels when released (7.26).
 * Live and unsaved until Save, like every other control. */
function PathLevel({
  path,
  value,
  disabled,
  onCommit,
}: {
  path: number;
  value: number;
  disabled: boolean;
  onCommit: (value: number) => Promise<void>;
}) {
  const [draft, setDraft] = useState(value);
  const commit = () => {
    if (Math.abs(draft - value) > 0.0001) void onCommit(draft);
  };
  return (
    <label className="field">
      <span>
        Path {path} level · {Math.round(draft * 100)}%
      </span>
      <input
        type="range"
        aria-label={`Path ${path} level`}
        min={0}
        max={2}
        step={0.05}
        value={draft}
        disabled={disabled}
        onChange={(event) => setDraft(Number(event.target.value))}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={commit}
      />
    </label>
  );
}

type SceneGain = { node: string; port: number; value: number };
type SceneDraft = {
  session: string;
  gains: Record<string, SceneGain[]>;
  added?: NewScene[];
};
const SCENE_DRAFT_KEY = 'oxidal.mixed.scene-draft';
const isGains = (value: unknown): value is SceneGain[] =>
  Array.isArray(value) &&
  value.every(
    (g) =>
      typeof g === 'object' &&
      g !== null &&
      typeof (g as SceneGain).node === 'string' &&
      typeof (g as SceneGain).port === 'number' &&
      typeof (g as SceneGain).value === 'number',
  );
/** The scene draft this tab kept, if it is well formed. */
function readSceneDraft(): SceneDraft | null {
  try {
    const value: unknown = JSON.parse(
      sessionStorage.getItem(SCENE_DRAFT_KEY) ?? 'null',
    );
    if (typeof value !== 'object' || value === null) return null;
    const draft = value as SceneDraft;
    if (
      typeof draft.session !== 'string' ||
      typeof draft.gains !== 'object' ||
      draft.gains === null ||
      !Object.values(draft.gains).every(isGains) ||
      !(draft.added ?? []).every(
        (scene) =>
          typeof scene?.id === 'string' &&
          typeof scene.name === 'string' &&
          isGains(scene.gains),
      )
    )
      return null;
    return draft;
  } catch {
    return null;
  }
}

const SCENE_EDIT_KEY = 'oxidal.mixed.scene-edit';
/** The scene this tab was editing, so its panel returns after a reload. */
function readSceneEdit(): { session: string; scene: string } | null {
  try {
    const value: unknown = JSON.parse(
      sessionStorage.getItem(SCENE_EDIT_KEY) ?? 'null',
    );
    const edit = value as { session?: unknown; scene?: unknown } | null;
    return edit &&
      typeof edit.session === 'string' &&
      typeof edit.scene === 'string'
      ? { session: edit.session, scene: edit.scene }
      : null;
  } catch {
    return null;
  }
}
