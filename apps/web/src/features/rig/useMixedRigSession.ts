import { useCallback, useEffect, useRef, useState } from 'react';

import {
  installedLv2,
  libraryCatalog,
  type Lv2Plugin,
  presetArtwork,
  publishRig,
  removalPreview,
  removePreset,
  type RigAudioAction,
  rigAudioCommand,
  type RigAudioState,
  rigAudioState,
  type RigControl,
  type RigDocument,
  rigDocument,
  rigLibrary,
  sceneDraft as sharedSceneDraft,
} from '../../api';
import { EditQueue } from '../../editQueue';
import type { RigPublish, VersionTarget } from '../../generated/contract';
import { errorDetails, friendlyError } from '../../lib/friendlyError';
import { useFailure } from '../../lib/useFailure';
import { useNarrow } from '../../lib/useNarrow';
import { setPerform, usePerform } from '../../performState';
import {
  discardsSceneEdits,
  playChoice,
  playScenes,
  type PresetChoice,
} from '../../presetChoices';
import {
  buildRoute,
  buildSceneRoute,
  readRoute,
  type Route,
  type RouteAt,
  routeMoveTo,
  routePathStep,
  routeStep,
  sceneTones,
} from '../../rigRoute';
import { keepScenes, updateScenes } from '../../sceneEdit';
import { canPreviewNativeBypass } from '../../sceneNativeBypass';
import {
  key,
  mixedRigViewModel,
  type SceneDraft,
  type SceneGain,
} from './mixedRigViewModel';
import { applyTogether } from './pathSides';
import {
  afterStep,
  historyTarget,
  parseHistory,
  recordEdit,
  type RigHistory,
} from './rigHistory';

/**
 * State and commands of the sounding mixed rig: confirmed-state polling, the
 * opened document, the shared scene draft, chain rebuilds, control edits and
 * copy-on-edit. `view` is the pure view model once the rig can be shown.
 * @see docs/mixed-engine.md
 * @see docs/interface.md
 */
export function useMixedRigSession({
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
  /** The rig canvas's open chooser: a gap's Add or split menu, an effect to
   * add or split in at a gap, or the effect replacing a block. */
  const [canvasChoice, setCanvasChoice] = useState<
    | { kind: 'gap' | 'add' | 'split'; at: RouteAt }
    | { kind: 'replace'; id: string }
    | null
  >(null);
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
  const [actionsOpen, setActionsOpen] = useState(false);
  const [routingSplit, setRoutingSplit] = useState<string | null>(null);
  const narrow = useNarrow();
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
  /** Preset documents by revision, fetched ahead of a switch so the new rig
   * draws at once instead of emptying while its document loads. A revision
   * is immutable, so a cached document never goes stale. */
  const documents = useRef(new Map<string, Promise<RigDocument>>());
  const [loaded, setLoaded] = useState<ReadonlyMap<string, RigDocument>>(
    () => new Map(),
  );
  const loadDocument = useCallback((id: string) => {
    let pending = documents.current.get(id);
    if (!pending) {
      pending = rigDocument(id);
      documents.current.set(id, pending);
      pending.then(
        (d) => {
          if (alive.current)
            setLoaded((m) => (m.has(id) ? m : new Map(m).set(id, d)));
        },
        // A failed read is not kept, so the next look tries again.
        () => documents.current.delete(id),
      );
    }
    return pending;
  }, []);
  useEffect(() => {
    let active = true;
    if (revision)
      void loadDocument(revision)
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
  }, [revision, loadDocument]);
  // Prepared presets (set lists, MIDI program changes) load in the background.
  const preparedKey = (state?.control?.prepared ?? [])
    .map((p) => p.revision)
    .join(' ');
  useEffect(() => {
    for (const id of preparedKey.split(' '))
      if (id) void loadDocument(id).catch(() => {});
  }, [preparedKey, loadDocument]);
  const matching =
    document?.revision === revision
      ? document
      : ((revision ? loaded.get(revision) : undefined) ?? null);
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
  const draftConflictRef = useRef(false);
  const [draftConflict, setDraftConflict] = useState(false);
  const remoteDraft = useRef<SceneDraft | null>(null);
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
        remoteDraft.current = (remote.draft as SceneDraft | null) ?? null;
        if (draftConflictRef.current) {
          draftRevision.current = remote.revision;
          return;
        }
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
        expected_revision: draftRevision.current ?? undefined,
      });
      if (saved) draftRevision.current = saved.revision;
    } catch {
      draftConflictRef.current = true;
      setDraftConflict(true);
      setError(
        'These scene edits could not be shared. Your draft is kept in this browser. Review the current scenes before trying again.',
      );
    } finally {
      draftPushes.current--;
    }
  }
  useEffect(() => {
    if (draftFromDevice.current) {
      draftFromDevice.current = false;
      return;
    }
    if (draftRevision.current !== null && !draftConflictRef.current)
      void pushDraft(sceneUpdates);
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
  /** One confirmed command. An edit of an Oxidal sound or a TONE3000 chain
   * then makes its copy in Mine, unless `promote` is false because the caller
   * sends more commands that belong to the same change and promotes after. */
  async function command(action: RigAudioAction, promote = true) {
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
      const target = action.kind === 'control' ? action.command.target : null;
      if (
        action.kind === 'control' &&
        target?.kind === 'native' &&
        current.current.control?.authoring?.some((r) => r.node === target.node)
      ) {
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
      if (
        promote &&
        ['authoring', 'control', 'eq', 'model'].includes(action.kind)
      )
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
  function saveScenes(
    withMix: boolean,
    withControls: SceneDraft['controls'] = {},
    withNativeControls: SceneDraft['native_controls'] = {},
  ) {
    const { editingScene, drafts, editingSceneGains, addedScenes } = view!;
    setSaveReview(false);
    const gains =
      withMix && editingScene
        ? { ...drafts, [editingScene.id]: editingSceneGains }
        : drafts;
    // Effect settings drafted with Update scene, plus any the caller adds.
    const controls = {
      ...(sceneUpdates?.session === current.current?.control?.session
        ? (sceneUpdates?.controls ?? {})
        : {}),
      ...withControls,
    };
    return rebuild(({ opened, live, name }) =>
      updateScenes(
        opened,
        gains,
        current.current?.control?.scene ?? undefined,
        live,
        name,
        addedScenes,
        controls,
        sceneUpdates &&
          sceneUpdates.session === current.current?.control?.session
          ? (sceneUpdates.bypass ?? {})
          : {},
        {
          ...(sceneUpdates?.session === current.current?.control?.session
            ? (sceneUpdates?.native_controls ?? {})
            : {}),
          ...withNativeControls,
        },
        current.current?.control?.capture_defaults ?? [],
        sceneUpdates &&
          sceneUpdates.session === current.current?.control?.session
          ? (sceneUpdates.native_bypass ?? {})
          : {},
        current.current?.control?.native_bypass_defaults ?? [],
      ),
    );
  }
  /** One confirmed control command against the latest confirmed state. */
  async function setControl(
    target: RigControl['target'],
    value: number,
    promote = true,
  ) {
    const cursor = current.current?.control;
    return (
      !!cursor &&
      !!(await command(
        {
          kind: 'control',
          command: {
            session: cursor.session,
            expected_revision: cursor.revision,
            target,
            value,
          },
        },
        promote,
      ))
    );
  }
  /**
   * Sets a path's left and right merge gains (level, pan, polarity) as one
   * change. The API takes one control per command, so when a later side fails
   * the sides already set are put back: a pan is never left half applied. An
   * Oxidal sound or TONE3000 chain makes its copy in Mine only once both
   * sides are set, never between them.
   */
  async function setPathSides(values: [RigControl['target'], number][]) {
    const result = await applyTogether(
      values,
      (target) =>
        current.current?.control?.controls.find(
          (c) => JSON.stringify(c.target) === JSON.stringify(target),
        )?.value,
      (target, value) => setControl(target, value, false),
    );
    if (result === 'applied') {
      const after = current.current;
      // Only an Oxidal sound or a TONE3000 chain is copied; Mine is not.
      if (!after || sourceOrigin === 'mine' || copyOnEdit) return;
      setBusy(true);
      try {
        await promoteMixedEdit(after);
      } catch (cause) {
        if (alive.current) setError(friendlyError(cause, 'update the rig'));
      } finally {
        if (alive.current) setBusy(false);
      }
    } else if (result === 'restored')
      setError(
        'That path change did not go through, so the path is back as it was. Try again.',
      );
    else if (result === 'partial')
      setError(
        'That path change went through on one side only. Check the path’s level and pan, then try again.',
      );
  }
  /**
   * Recalls a scene; a drafted update then replaces its saved snapshot live.
   * The engine recalls what the saved preset holds, so the drafted levels and
   * effect settings follow as ordinary control commands, without a ramp.
   */
  async function recallScene(scene: string) {
    const control = current.current?.control;
    if (!control) return;
    const preview =
      sceneUpdates?.session === control.session
        ? sceneUpdates.native_bypass?.[scene]
        : undefined;
    if (!canPreviewNativeBypass(preview, control.native_bypass_armed)) {
      setError(
        'Save scenes to prepare the new capture blocks before playing this draft.',
      );
      return;
    }
    const recalled = await command({
      kind: 'scene',
      command: {
        session: control.session,
        expected_revision: control.revision,
        scene,
        ...(preview?.length ? { native_bypass_preview: preview } : {}),
      },
    });
    const drafted = sceneUpdates?.session === control.session;
    const gains = (drafted && sceneUpdates.gains[scene]) || [];
    const controls = (drafted && sceneUpdates.controls?.[scene]) || [];
    const bypass = (drafted && sceneUpdates.bypass?.[scene]) || [];
    const native = (drafted && sceneUpdates.native_controls?.[scene]) || [];
    if (
      !recalled ||
      !(gains.length || controls.length || bypass.length || native.length)
    )
      return;
    const pending = current.current?.control?.branch_sleep;
    if (pending?.requested_scene && pending.active_scene !== scene) {
      // Additional controls apply to the active scene. Wait for the device
      // to finish priming and stop if another viewer selects a different scene.
      let confirmed = false;
      for (let i = 0; i < 50 && alive.current; i++) {
        await new Promise((resolve) => window.setTimeout(resolve, 100));
        const state = await rigAudioState().catch(() => null);
        if (!state?.control || state.control.session !== control.session) break;
        accept(state);
        const branch = state.control.branch_sleep;
        if (branch?.active_scene === scene && !branch.requested_scene) {
          confirmed = true;
          break;
        }
        if (branch?.requested_scene !== scene) break;
      }
      if (!confirmed) {
        setError(
          'The device has not confirmed this scene. Your additional draft settings are still available.',
        );
        return;
      }
    }
    // Once a drafted value is applied the mix no longer equals the saved scene,
    // so the engine stops naming it: remember which scene is being heard.
    setSceneDraft({ session: control.session, scene });
    const targets: [RigControl['target'], number][] = [
      ...gains.map((gain): [RigControl['target'], number] => [
        { kind: 'merge', node: gain.node, port: gain.port },
        gain.value,
      ]),
      ...controls.map((c): [RigControl['target'], number] => [
        { kind: 'lv2', node: c.node, symbol: c.symbol },
        c.value,
      ]),
      ...bypass.map((b): [RigControl['target'], number] => [
        { kind: 'bypass', node: b.node },
        b.value ? 1 : 0,
      ]),
      ...native.map((c): [RigControl['target'], number] => [
        { kind: 'native', node: c.node, parameter: c.parameter },
        c.value,
      ]),
    ];
    for (const [target, value] of targets) {
      const cursor = current.current?.control;
      // Another preset took over while the drafted values were going out.
      if (!cursor || cursor.session !== control.session) return;
      const live = cursor.controls.find(
        (c) =>
          c.target.kind === target.kind &&
          'node' in c.target &&
          'node' in target &&
          c.target.node === target.node &&
          (c.target.kind === 'merge'
            ? target.kind === 'merge' && c.target.port === target.port
            : c.target.kind === 'bypass' ||
              (c.target.kind === 'native' &&
                target.kind === 'native' &&
                c.target.parameter === target.parameter) ||
              (c.target.kind === 'lv2' &&
                target.kind === 'lv2' &&
                c.target.symbol === target.symbol)),
      );
      // A setting the sounding rig does not have is left to Save to report.
      if (!live || Math.abs(live.value - value) <= 0.0001) continue;
      if (!(await setControl(target, value))) return;
    }
  }
  /** Any preset from the picker: scene presets stay here, TONE3000 ones hand over. */
  async function choose(choice: PresetChoice, confirmed = false) {
    const { changed } = view!;
    const control = current.current?.control;
    // On stage a preset change discards unsaved edits without asking, as a
    // modeller does; the editor asks first.
    if (
      !confirmed &&
      !performing &&
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
    // Fetch the new rig's document while the device switches, so it is ready
    // the moment the new revision is reported.
    if (choice.kind === 'scenes')
      void loadDocument(choice.revision).catch(() => {});
    try {
      await playChoice(choice);
      // Show the new rig now rather than at the next status poll.
      if (alive.current) await rigAudioState().then(accept, () => {});
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
  /** This tab's Undo and Redo through the revisions its edits published. */
  const [history, setHistory] = useState<RigHistory | null>(readHistory);
  useEffect(() => {
    try {
      if (history) sessionStorage.setItem(HISTORY_KEY, JSON.stringify(history));
      else sessionStorage.removeItem(HISTORY_KEY);
    } catch {
      /* storage unavailable: the history lives only in this page */
    }
  }, [history]);
  /** The exact manifest each revision was published with, so stepping back
   * gives the same revision rather than a re-encoded copy of it. */
  const publishedJson = useRef(new Map<string, string>());
  /** Undo or Redo waiting for the player to accept losing unsaved changes. */
  const [stepping, setStepping] = useState<-1 | 1 | null>(null);
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
    { discoverPlugins = true }: { discoverPlugins?: boolean } = {},
  ) {
    const { changed } = view!;
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
          discoverPlugins ? installedLv2(rate) : [],
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
        if (!request.prepare_sleep_branches)
          publishedJson.current.set(published.revision, request.manifest_json);
        // An edit of a preset in Mine replaces it and can be undone; the
        // first edit of anything else makes a copy, undone with Discard copy.
        setHistory((h) =>
          recordEdit(
            h,
            {
              // The manifest just published: its id is the saved preset's.
              preset: manifest.id,
              from: opened.revision,
              to: published.revision,
            },
            origin === 'mine' && manifest.id === opened.manifest.id,
          ),
        );
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
  const undoTarget = historyTarget(history, revision, -1);
  const redoTarget = historyTarget(history, revision, 1);
  /**
   * Undo (-1) or Redo (1): republishes the earlier or later revision with the
   * playing one as its source, so it takes the playing one's place in the
   * library and its MIDI assignments and Keep ready move with it; then plays
   * it. Changes made since the last edit and not saved are not carried, so
   * the player confirms first (`confirmed`).
   */
  function stepHistory(step: -1 | 1, confirmed = false) {
    const target = step < 0 ? undoTarget : redoTarget;
    const opened = document?.revision === revision ? document : null;
    if (!target || !opened || editing) return;
    setStepping(null);
    if (!confirmed && view?.changed) {
      setStepping(step);
      return;
    }
    const run = async () => {
      clearEdit();
      setEditing(true);
      setError('');
      try {
        const earlier = await rigDocument(target);
        const manifest_json =
          publishedJson.current.get(target) ?? JSON.stringify(earlier.manifest);
        const published = await publishRig({
          manifest_json,
          resources: Object.fromEntries(
            earlier.manifest.resources.map((r) => [
              r.id,
              { kind: 'bundle', revision: target, resource: r.id },
            ]),
          ),
          source: { kind: 'rig', id: opened.revision },
        });
        publishedJson.current.set(published.revision, manifest_json);
        setHistory((h) =>
          h && h.revisions[h.at] === opened.revision
            ? afterStep(h, step, published.revision)
            : h,
        );
        await playScenes(published.revision);
        accept(await rigAudioState());
      } catch (cause) {
        if (alive.current)
          failEdit(
            cause,
            step < 0 ? 'undo the change' : 'redo the change',
            () => void run(),
          );
      } finally {
        if (alive.current) setEditing(false);
      }
    };
    return run();
  }
  /** Rebuilds this preset with a change to its chain of blocks. A preset
   * with scene lanes keeps its scenes and edits inside them. */
  function editChain(change: (route: Route) => Route) {
    return rebuild(({ opened, plugins, live, name, profile }) => {
      const route = change(readRoute(opened, plugins, live));
      return sceneTones(opened.manifest).length
        ? buildSceneRoute(opened, route, name)
        : keepScenes(
            opened,
            buildRoute(opened.manifest.id, name, route, profile),
          );
    });
  }
  /** Move ◀ / Move ▶: one place, stepping into or out of splits. */
  function shift(id: string, step: -1 | 1) {
    return editChain((route) => routeStep(route, id, step));
  }
  /** ▲ Path / Path ▼: the same place on the path above or below. */
  function shiftPath(id: string, step: -1 | 1) {
    return editChain((route) => routePathStep(route, id, step));
  }
  /** Clears the selected block: the block sheet closes. */
  function clearSelection() {
    if (!revision) return;
    const cleared = { revision, node: '' };
    setSelection(cleared);
    try {
      sessionStorage.setItem('oxidal.mixed.selection', JSON.stringify(cleared));
    } catch {
      /* browsing preferences are optional */
    }
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
    const target = control.target;
    const native =
      target.kind === 'native' &&
      cursor.control?.authoring?.some((r) => r.node === target.node)
        ? target
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
  const model =
    !state ||
    state.phase === 'unavailable' ||
    !state.configured ||
    (otherPlaying && state.phase !== 'running')
      ? null
      : mixedRigViewModel({
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
        });
  // The block sheet's Close clears the selection (phones: a bottom sheet).
  const view = model && {
    ...model,
    selectedSheet: model.selectedSheet && {
      ...model.selectedSheet,
      onClose: clearSelection,
    },
  };
  async function saveCopy(target?: VersionTarget) {
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
    if (
      await command(
        target
          ? { kind: 'save_version', name: name.trim(), target }
          : { kind: 'save', name: name.trim() },
      )
    )
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
      setHistory((h) => (h?.revisions.includes(copy.copy) ? null : h));
    } catch (cause) {
      setError(
        `The original is playing, but the copy remains in Mine: ${errorDetails(cause)}`,
      );
    } finally {
      resolvingCopy.current = false;
      if (alive.current) setBusy(false);
    }
  }
  /** A dragged block dropped on a gap, in its own path or another. */
  function dropBlock(id: string, at: RouteAt) {
    void editChain((route) => routeMoveTo(route, id, at));
  }
  function selectLaneTile(laneBlock: string) {
    const { laneTarget } = view!;
    const at = laneTarget(laneBlock);
    if (!revision || !at) return;
    const chosen = { revision, node: at.node };
    setSelection(chosen);
    try {
      sessionStorage.setItem('oxidal.mixed.selection', JSON.stringify(chosen));
    } catch {
      /* browsing preferences are optional */
    }
    if (at.block) setNativeSelection({ node: at.node, target: at.block });
  }
  function switchTile(tile: string) {
    const { laneTarget, holdOf, nativeSwitch } = view!;
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
  return {
    view,
    sourceOrigin,
    connected,
    revision,
    matching,
    picker,
    setPicker,
    adding,
    setAdding,
    laneSlot,
    setLaneSlot,
    insertion,
    setInsertion,
    busy,
    setBusy,
    actionsOpen,
    setActionsOpen,
    routingSplit,
    setRoutingSplit,
    switching,
    discarding,
    setDiscarding,
    eqBusy,
    setEqBusy,
    setNativeSelection,
    error,
    setError,
    editFailure,
    clearEdit,
    readError,
    name,
    setName,
    saveOpening,
    setSaveOpening,
    setSceneDraft,
    sceneUpdates,
    setSceneUpdates,
    sceneSharing: {
      conflict: draftConflict,
      retry: async () => {
        const remote = await sharedSceneDraft();
        if (!remote) return;
        draftRevision.current = remote.revision;
        remoteDraft.current = (remote.draft as SceneDraft | null) ?? null;
        draftConflictRef.current = false;
        setDraftConflict(false);
        setError('');
        await pushDraft(sceneUpdates);
      },
      discard: () => {
        draftConflictRef.current = false;
        setDraftConflict(false);
        draftFromDevice.current = true;
        setSceneUpdates(remoteDraft.current);
        setError('');
      },
    },
    namingScene,
    setNamingScene,
    saveReview,
    setSaveReview,
    copyOnEdit,
    edit,
    setEdit,
    current,
    alive,
    sending,
    generation,
    queue,
    latest,
    accept,
    command,
    saveScenes,
    setPathSides,
    recallScene,
    choose,
    editing,
    performing,
    setPerforming,
    unsaved,
    setUnsaved,
    undoTarget,
    redoTarget,
    stepHistory,
    stepping,
    setStepping,
    rebuild,
    editChain,
    shift,
    shiftPath,
    clearSelection,
    canvasChoice,
    setCanvasChoice,
    switchPrepared,
    open,
    finish,
    saveCopy,
    resolveMixedCopy,
    dropBlock,
    selectLaneTile,
    switchTile,
    setSelection,
  };
}

type MixedRigSession = ReturnType<typeof useMixedRigSession>;
type MixedRigView = NonNullable<MixedRigSession['view']>;
export type RigViewProps = { rig: MixedRigSession; vm: MixedRigView };

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

const HISTORY_KEY = 'oxidal.mixed.history';
/** The Undo and Redo history this tab kept, if it is well formed. */
function readHistory(): RigHistory | null {
  try {
    return parseHistory(
      JSON.parse(sessionStorage.getItem(HISTORY_KEY) ?? 'null'),
    );
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
