import {
  type AudioState,
  graphAudioCommand,
  type GraphAudioState,
  graphAudioState,
  playbackCommand,
  playbackState,
  rigAudioCommand,
  type RigAudioState,
  rigAudioState,
} from '../../api';

type Opening =
  | { owner: 'native'; state: AudioState }
  | { owner: 'effects'; state: GraphAudioState }
  | { owner: 'mixed'; state: RigAudioState };

/** Keep the cursor the player reviewed. A later edit or recall invalidates it. */
export async function playingCopySource(): Promise<Opening | null> {
  const [native, effects, mixed] = await Promise.all([
    playbackState(),
    graphAudioState(),
    rigAudioState(),
  ]);
  if (
    [native, effects, mixed].filter((state) => state.phase === 'running')
      .length !== 1
  )
    return null;
  if (native.phase === 'running') return { owner: 'native', state: native };
  if (effects.phase === 'running' && effects.control && !effects.control.edit)
    return { owner: 'effects', state: effects };
  if (mixed.phase === 'running' && mixed.control && !mixed.save?.running)
    return { owner: 'mixed', state: mixed };
  return null;
}

export async function copyPlaying(
  opening: Opening,
  name: string,
  signal: AbortSignal,
) {
  let saved: string | null | undefined;
  if (opening.owner === 'mixed') {
    const cursor = opening.state.control!;
    const copyId = crypto.randomUUID().replaceAll('-', '');
    let state = await rigAudioCommand(opening.state, {
      kind: 'copy_playing',
      name,
      copy_id: copyId,
    });
    const deadline = Date.now() + 65000;
    for (;;) {
      signal.throwIfAborted();
      const receipt = state.save;
      if (
        !receipt ||
        receipt.copy_id !== copyId ||
        receipt.source_session !== cursor.session ||
        receipt.source_control_revision !== cursor.revision
      )
        throw new Error('The save receipt changed.');
      if (receipt.error) throw new Error(receipt.error);
      if (!receipt.running) {
        saved = receipt.saved_revision;
        break;
      }
      if (Date.now() >= deadline)
        throw new Error('The copy is still unconfirmed.');
      await new Promise((resolve) => setTimeout(resolve, 400));
      signal.throwIfAborted();
      state = await rigAudioState();
    }
  } else if (opening.owner === 'native') {
    saved = (await playbackCommand(opening.state, { kind: 'save_copy', name }))
      .saved_copy;
  } else {
    saved = (
      await graphAudioCommand(opening.state, { kind: 'copy_playing', name })
    ).saved_copy;
  }
  if (!saved) throw new Error('The device did not confirm a saved copy.');
  return saved;
}
