import {
  graphAudioCommand,
  graphAudioState,
  playbackCommand,
  playbackState,
  rigAudioCommand,
  rigAudioState,
} from '../../api';

const action = (enabled: boolean) => ({
  kind: 'host_utility' as const,
  command: { kind: 'output_mute' as const, enabled },
});

/**
 * Mute silences the output after the rig without stopping audio (7.22). It is
 * sent to whichever engine is playing; nothing playing means nothing to mute.
 * @see docs/audio.md
 */
export async function setOutputMute(enabled: boolean): Promise<void> {
  const [native, rig, graph] = await Promise.all([
    playbackState(),
    rigAudioState(),
    graphAudioState(),
  ]);
  if (rig.phase === 'running') await rigAudioCommand(rig, action(enabled));
  else if (native.phase === 'running')
    await playbackCommand(native, action(enabled));
  else if (graph.phase === 'running')
    await graphAudioCommand(graph, action(enabled));
  else throw new Error('Nothing is playing, so there is nothing to mute.');
}
