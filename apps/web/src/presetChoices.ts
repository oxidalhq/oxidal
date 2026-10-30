import {
  graphAudioCommand,
  graphAudioState,
  nativeState,
  playbackCommand,
  playbackState,
  presetLibrary,
  rigAudioCommand,
  rigAudioState,
  rigLibrary,
  type AudioState,
} from './api';

/**
 * One list of presets for every view. A preset is anything you load: a single
 * TONE3000 chain, or several in parallel switched by scenes. Which engine plays
 * it is an implementation detail; choosing one stops the other first.
 * @see docs/audio.md
 */
export type PresetChoice =
  | { kind: 'tone3000'; id: string; owned: boolean; name: string }
  | { kind: 'scenes'; revision: string; name: string; scenes: string[] };

export const choiceKey = (c: PresetChoice) =>
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
        name: '',
      })
    : '';

/** Boost keys the daemon matches against what is playing (see boosts.rs). */
export const boostKey = {
  tone3000: (id: string, owned: boolean) =>
    `tone3000:${owned ? 'copy' : 'original'}:${id}`,
  scenes: (presetId: string) => `scenes:${presetId}`,
  scene: (presetId: string, sceneId: string) => `scenes:${presetId}#${sceneId}`,
};

export const scenesLabel = (scenes: string[]) =>
  scenes.length > 1 ? `${scenes.length} scenes` : '';

/** Scene presets, saved copies, then originals; each source fails alone. */
export async function loadPresetChoices(): Promise<{
  items: PresetChoice[];
  error: string;
}> {
  const [originals, native, rigs] = await Promise.allSettled([
    presetLibrary(),
    nativeState(),
    rigLibrary(),
  ]);
  const items: PresetChoice[] = [
    ...(rigs.status === 'fulfilled' ? rigs.value.presets : []).map(
      (p): PresetChoice => ({
        kind: 'scenes',
        revision: p.revision,
        name: p.name,
        scenes: p.scenes ?? [],
      }),
    ),
    ...(native.status === 'fulfilled' ? native.value.owned : []).map(
      (p): PresetChoice => ({
        kind: 'tone3000',
        id: p.id,
        name: p.preset.name,
        owned: true,
      }),
    ),
    ...(originals.status === 'fulfilled' ? originals.value : []).map(
      (p): PresetChoice => ({
        kind: 'tone3000',
        id: p.sha256,
        name: p.name,
        owned: false,
      }),
    ),
  ];
  const failed = [
    originals.status === 'rejected' && 'originals',
    native.status === 'rejected' && 'saved copies',
    rigs.status === 'rejected' && 'presets with scenes',
  ].filter(Boolean);
  return {
    items,
    error:
      failed.length === 3
        ? 'Preset list unavailable'
        : failed.length
          ? `Some presets are unavailable (${failed.join(', ')})`
          : '',
  };
}

const KEEP_READY = 'oxidal.prepared-rigs';
/** Presets with scenes the player keeps loaded for gapless switching. */
export function readKeepReady(): string[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEEP_READY) ?? '[]');
    return Array.isArray(saved)
      ? saved.filter(
          (v): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v),
        )
      : [];
  } catch {
    return [];
  }
}
export function writeKeepReady(revisions: string[]) {
  try {
    localStorage.setItem(KEEP_READY, JSON.stringify(revisions));
  } catch {
    /* browser storage unavailable */
  }
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
export async function playScenes(revision: string) {
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
  const keep = readKeepReady();
  await rigAudioCommand(await rigAudioState(), {
    kind: 'start',
    settings: {
      revision,
      stream,
      recall: null,
      prepared: [...new Set(keep)]
        .filter((id) => id !== revision)
        .map((id) => ({ revision: id, recall: null })),
    },
  });
  // A started preset joins the ready set, so switching back stays gapless.
  if (keep.length) writeKeepReady([...new Set([...keep, revision])]);
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
