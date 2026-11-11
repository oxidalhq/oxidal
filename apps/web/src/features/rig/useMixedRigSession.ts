import { EditQueue } from '../../editQueue';
import {
  type Lv2Plugin,
  type RigAudioAction,
  type RigAudioState,
  type RigControl,
  type RigDocument,
  installedLv2,
  libraryCatalog,
  presetArtwork,
  publishRig,
  removalPreview,
  removePreset,
  rigAudioCommand,
  rigAudioState,
  rigDocument,
  rigLibrary,
  sceneDraft as sharedSceneDraft,
} from '../../api';
import {
  type PresetChoice,
  discardsSceneEdits,
  playChoice,
  playScenes,
} from '../../presetChoices';
import type { RigPublish } from '../../generated/contract';
import {
  type Route,
  type RouteAt,
  buildRoute,
  buildSceneRoute,
  readRoute,
  routeMoveTo,
  routePathStep,
  routeStep,
  sceneTones,
} from '../../rigRoute';
import { errorDetails, friendlyError } from '../../lib/friendlyError';
import { keepScenes, updateScenes } from '../../sceneEdit';
import { setPerform, usePerform } from '../../performState';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useFailure } from '../../lib/useFailure';
import { useNarrow } from '../../lib/useNarrow';
import {
  key,
  mixedRigViewModel,
  type SceneDraft,
  type SceneGain,
} from './mixedRigViewModel';

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
   * add or split in at a gap, or the effect replacing a block (S-15). */
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
  function saveScenes(
    withMix: boolean,
    withControls: SceneDraft['controls'] = {},
  ) {
    const { editingScene, drafts, editingSceneGains, addedScenes } = view!;
    setSaveReview(false);
    const gains =
      withMix && editingScene
        ? { ...drafts, [editingScene.id]: editingSceneGains }
        : drafts;
    // Effect settings drafted with Update scene (D-6), plus any the caller adds.
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
      ),
    );
  }
  /** One confirmed control command against the latest confirmed state. */
  async function setControl(target: RigControl['target'], value: number) {
    const cursor = current.current?.control;
    return (
      !!cursor &&
      !!(await command({
        kind: 'control',
        command: {
          session: cursor.session,
          expected_revision: cursor.revision,
          target,
          value,
        },
      }))
    );
  }
  /**
   * Sets a path's left and right merge gains (level, pan, polarity). The API
   * takes one control per command, so when a later side fails the sides
   * already set are put back: a pan is never left half applied.
   */
  async function setPathSides(values: [RigControl['target'], number][]) {
    const applied: [RigControl['target'], number][] = [];
    for (const [target, value] of values) {
      const before = current.current?.control?.controls.find(
        (c) => JSON.stringify(c.target) === JSON.stringify(target),
      )?.value;
      if (await setControl(target, value)) {
        if (before !== undefined) applied.unshift([target, before]);
        continue;
      }
      if (!applied.length) return;
      let restored = true;
      for (const [done, earlier] of applied)
        restored = (await setControl(done, earlier)) && restored;
      if (restored)
        setError(
          'That path change did not go through, so the path is back as it was. Try again.',
        );
      return;
    }
  }
  /**
   * Recalls a scene; a drafted update then replaces its saved snapshot live.
   * The engine recalls what the saved preset holds, so the drafted levels and
   * effect settings follow as ordinary control commands, without a ramp.
   */
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
    const drafted = sceneUpdates?.session === control.session;
    const gains = (drafted && sceneUpdates.gains[scene]) || [];
    const controls = (drafted && sceneUpdates.controls?.[scene]) || [];
    if (!recalled || !(gains.length || controls.length)) return;
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
    ];
    for (const [target, value] of targets) {
      const cursor = current.current?.control;
      // Another preset took over while the drafted values were going out.
      if (!cursor || cursor.session !== control.session) return;
      const live = cursor.controls.find(
        (c) =>
          c.target.kind === target.kind &&
          c.target.node === target.node &&
          (c.target.kind === 'merge'
            ? target.kind === 'merge' && c.target.port === target.port
            : c.target.kind === 'lv2' &&
              target.kind === 'lv2' &&
              c.target.symbol === target.symbol),
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
  /** Rebuilds this preset with a change to its chain of blocks. A preset
   * with scene lanes keeps its scenes and edits inside them (S-15). */
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
