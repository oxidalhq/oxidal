import {
  graphAudioCommand,
  graphAudioState,
  nativeState,
  libraryCatalog,
  presetDetails,
  type PresetDetails,
  playbackCommand,
  playbackState,
  presetLibrary,
  rigAudioCommand,
  rigAudioState,
  rigLibrary,
  type AudioState,
  keepReady,
  setKeepReady,
} from './api';

/**
 * One list of presets for every view. A preset is anything you load: a single
 * TONE3000 chain, or several in parallel switched by scenes. Which engine plays
 * it is an implementation detail; choosing one stops the other first.
 * @see docs/audio.md
 */
type PresetOrigin = 'tone3000' | 'oxidal_example' | 'mine';
export type PresetChoice = {
  details?: PresetDetails;
  origin: PresetOrigin;
} & (
  | { kind: 'tone3000'; id: string; owned: boolean; name: string }
  | {
      kind: 'scenes';
      revision: string;
      name: string;
      scenes: string[];
      topology: 'serial' | 'parallel' | 'scenes';
      nativeInstances: number;
      lv2Instances: number;
    }
);

export const choiceKey = (
  c:
    | { kind: 'scenes'; revision: string }
    | { kind: 'tone3000'; id: string; owned: boolean },
) =>
  c.kind === 'scenes'
    ? `scenes:${c.revision}`
    : `${c.owned ? 'copy' : 'original'}:${c.id}`;

/** Key of the preset a TONE3000 session is playing, or '' for a draft. */
export const tone3000Key = (state: AudioState | null | undefined) =>
  state?.configured && !state.configured.draft
    ? choiceKey({
        kind: 'tone3000',
        id: state.configured.preset_id,
        owned: state.configured.owned,
      })
    : '';

/** Boost keys the daemon matches against what is playing (see boosts.rs). */
export const boostKey = {
  tone3000: (id: string, owned: boolean) =>
    `tone3000:${owned ? 'copy' : 'original'}:${id}`,
  scenes: (presetId: string) => `scenes:${presetId}`,
  scene: (presetId: string, sceneId: string) => `scenes:${presetId}#${sceneId}`,
};

export const rigTopologyLabel = (rig: {
  scenes: string[];
  topology: 'serial' | 'parallel' | 'scenes';
  native_instances: number;
  lv2_instances: number;
}) =>
  [
    rig.topology === 'scenes'
      ? `${rig.scenes.length} ${rig.scenes.length === 1 ? 'scene' : 'scenes'}`
      : rig.topology === 'parallel'
        ? 'Parallel paths'
        : 'Serial chain',
    `${rig.native_instances} NAM ${rig.native_instances === 1 ? 'block' : 'blocks'}`,
    `${rig.lv2_instances} ${rig.lv2_instances === 1 ? 'effect' : 'effects'}`,
  ].join(' · ');

export const choiceTopologyLabel = (choice: PresetChoice) =>
  choice.kind === 'scenes'
    ? rigTopologyLabel({
        scenes: choice.scenes,
        topology: choice.topology,
        native_instances: choice.nativeInstances,
        lv2_instances: choice.lv2Instances,
      })
    : '';

/** One device set list; source failures remain visible and do not hide other formats. */
export async function loadPresetChoices(): Promise<{
  items: PresetChoice[];
  error: string;
}> {
  const [originals, native, rigs, catalog, details] = await Promise.allSettled([
    presetLibrary(),
    nativeState(),
    rigLibrary(),
    libraryCatalog(),
    presetDetails(),
  ]);
  const items: PresetChoice[] = [
    ...(rigs.status === 'fulfilled' ? rigs.value.presets : []).map(
      (p): PresetChoice => ({
        kind: 'scenes',
        revision: p.revision,
        name: p.name,
        scenes: p.scenes ?? [],
        topology: p.topology,
        nativeInstances: p.native_instances,
        lv2Instances: p.lv2_instances,
        origin: p.origin,
      }),
    ),
    ...(native.status === 'fulfilled' ? native.value.owned : []).map(
      (p): PresetChoice => ({
        kind: 'tone3000',
        id: p.id,
        name: p.preset.name,
        owned: true,
        origin: 'mine',
      }),
    ),
    ...(originals.status === 'fulfilled' ? originals.value : []).map(
      (p): PresetChoice => ({
        kind: 'tone3000',
        id: p.sha256,
        name: p.name,
        owned: false,
        origin: 'tone3000',
      }),
    ),
  ];
  if (catalog.status === 'fulfilled') {
    const listed = new Map(
      catalog.value.items.map((item, index) => [
        `${item.kind}:${item.id}`,
        { item, index },
      ]),
    );
    const identity = (item: PresetChoice) =>
      `${item.kind === 'scenes' ? 'rig' : item.owned ? 'owned' : 'original'}:${item.kind === 'scenes' ? item.revision : item.id}`;
    // A save may finish between source requests. Unknown entries still join the
    // end; a confirmed archived entry must not reappear from an older response.
    for (let i = items.length - 1; i >= 0; i--) {
      const row = listed.get(identity(items[i]!));
      if (row?.item.archived) items.splice(i, 1);
      else if (row)
        items[i] = {
          ...items[i]!,
          name: row.item.name,
          origin: row.item.origin ?? items[i]!.origin,
        };
    }
    items.sort(
      (a, b) =>
        (listed.get(identity(a))?.index ?? Infinity) -
        (listed.get(identity(b))?.index ?? Infinity),
    );
  }
  if (details.status === 'fulfilled') {
    const saved = new Map(
      details.value.entries.map((e) => [
        `${e.entry.kind}:${e.entry.id}`,
        e.details,
      ]),
    );
    for (const item of items) {
      item.details = saved.get(
        `${item.kind === 'scenes' ? 'rig' : item.owned ? 'owned' : 'original'}:${item.kind === 'scenes' ? item.revision : item.id}`,
      );
    }
  }
  const failed = [
    originals.status === 'rejected' && 'originals',
    native.status === 'rejected' && 'saved copies',
    rigs.status === 'rejected' && 'presets with scenes',
    catalog.status === 'rejected' && 'set-list order',
  ].filter(Boolean);
  const metadataWarning =
    details.status === 'rejected' ? 'Preset details unavailable.' : '';
  return {
    items,
    error: [
      metadataWarning,
      failed.length === 4
        ? 'Preset list unavailable'
        : failed.length
          ? `Some presets are unavailable (${failed.join(', ')})`
          : '',
    ]
      .filter(Boolean)
      .join(' '),
  };
}

const KEEP_READY = 'oxidal.prepared-rigs';
export const GAPLESS_BANK_SIZE = 4;
const revisionPattern = /^[a-f0-9]{64}$/;
/** What an older Oxidal kept in this browser; only an import source now. */
function browserKeepReady(): string[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEEP_READY) ?? '[]');
    return Array.isArray(saved)
      ? [
          ...new Set(
            saved.filter(
              (v): v is string =>
                typeof v === 'string' && revisionPattern.test(v),
            ),
          ),
        ].slice(0, GAPLESS_BANK_SIZE)
      : [];
  } catch {
    return [];
  }
}
/**
 * Presets kept loaded for gapless switching, stored on the device (7.7). When
 * the device has none, this browser's earlier choice is imported once; two
 * browsers' lists are never merged.
 */
export async function readKeepReady(): Promise<string[]> {
  const device = (await keepReady()).revisions;
  const local = browserKeepReady();
  if (!device.length && local.length) {
    const imported = await setKeepReady(local).catch(() => null);
    try {
      localStorage.removeItem(KEEP_READY);
    } catch {
      /* browser storage unavailable */
    }
    return imported?.revisions ?? [];
  }
  return device;
}
export async function writeKeepReady(revisions: string[]): Promise<string[]> {
  return (
    await setKeepReady(
      [...new Set(revisions)]
        .filter((revision) => revisionPattern.test(revision))
        .slice(0, GAPLESS_BANK_SIZE),
    )
  ).revisions;
}

/** The bounded adjacent bank containing a selected Library rig. */
export function gaplessBank(revision: string, ordered: string[]): string[] {
  const unique = [...new Set(ordered)].filter((id) =>
    /^[a-f0-9]{64}$/.test(id),
  );
  const index = unique.indexOf(revision);
  if (index < 0) return [revision];
  const start = Math.floor(index / GAPLESS_BANK_SIZE) * GAPLESS_BANK_SIZE;
  return unique.slice(start, start + GAPLESS_BANK_SIZE);
}

const RELEASE_MS = 10000;
async function released(read: () => Promise<{ device_owned: boolean }>) {
  const until = performance.now() + RELEASE_MS;
  while ((await read()).device_owned) {
    if (performance.now() > until)
      throw new Error('The other preset did not stop in time. Try again.');
    await new Promise((r) => setTimeout(r, 150));
  }
}

/**
 * Stops every engine holding the interface except `keep`, which can change
 * preset in place, and waits until the interface is free.
 */
async function freeInterface(keep: 'tone3000' | null) {
  const [native, rig, graph] = await Promise.all([
    playbackState(),
    rigAudioState(),
    graphAudioState(),
  ]);
  if (keep !== 'tone3000' && native.device_owned) {
    await playbackCommand(native, { kind: 'stop' });
    await released(playbackState);
  }
  if (rig.device_owned) {
    await rigAudioCommand(rig, { kind: 'stop' });
    await released(rigAudioState);
  }
  if (graph.device_owned) {
    await graphAudioCommand(graph, { kind: 'stop' });
    await released(graphAudioState);
  }
  // Every engine shares the unit's audio setup; take whichever has one.
  return (
    rig.configured?.stream ??
    native.configured?.stream ??
    graph.configured?.stream ??
    null
  );
}

/** Plays a TONE3000 preset, stopping a preset with scenes if one is playing. */
export async function playTone3000(id: string, owned: boolean) {
  await freeInterface('tone3000');
  return playbackCommand(await playbackState(), {
    kind: 'load_preset',
    preset_id: id,
    owned,
  });
}

/**
 * Plays a preset with scenes: a gapless switch when it is kept ready, a resume
 * with its unsaved edits when it was the last one playing, else a fresh start.
 */
export async function playScenes(revision: string, adjacent: string[] = []) {
  const rig = await rigAudioState();
  if (rig.phase === 'running' && rig.control && rig.configured) {
    if (rig.configured.revision === revision) return;
    const ready = rig.control.prepared?.find(
      (p) => p.revision === revision && !p.error,
    );
    if (ready) {
      await rigAudioCommand(rig, {
        kind: 'switch',
        command: {
          session: rig.control.session,
          expected_revision: rig.control.revision,
          revision,
          fade_frames: Math.max(
            2,
            Math.round(rig.configured.stream.input.sample_rate / 100),
          ),
        },
      });
      return;
    }
  }
  if (rig.configured?.revision === revision && rig.phase !== 'running') {
    // Resuming keeps the unsaved edits the daemon holds for this preset.
    await freeInterface(null);
    await rigAudioCommand(await rigAudioState(), { kind: 'restart' });
    return;
  }
  const stream = await freeInterface(null);
  if (!stream)
    throw new Error(
      'Choose the input, output and buffer in Settings → Audio first.',
    );
  const keep = await readKeepReady().catch(() => []);
  const bank = keep.length
    ? keep
    : gaplessBank(revision, adjacent.length ? adjacent : [revision]);
  await rigAudioCommand(await rigAudioState(), {
    kind: 'start',
    settings: {
      revision,
      stream,
      recall: null,
      prepared: bank
        .filter((id) => id !== revision)
        .map((id) => ({ revision: id, recall: null })),
    },
  });
}

/** Whether opening `choice` discards unsaved edits to the playing scenes preset. */
export function discardsSceneEdits(
  choice: PresetChoice,
  playing: { revision?: string; modified?: boolean; ready?: string[] },
) {
  return (
    choice.kind === 'scenes' &&
    !!playing.modified &&
    choice.revision !== playing.revision &&
    !(playing.ready ?? []).includes(choice.revision)
  );
}

export function playChoice(choice: PresetChoice) {
  return choice.kind === 'scenes'
    ? playScenes(choice.revision)
    : playTone3000(choice.id, choice.owned);
}
