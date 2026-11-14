import { probeAudio, type AudioProbe } from './api';

function sameProbe(checked: AudioProbe | null, saved: AudioProbe) {
  return (
    checked?.endpoint === saved.endpoint &&
    checked.direction === saved.direction &&
    checked.sample_rate === saved.sample_rate &&
    checked.channels === saved.channels &&
    checked.format === saved.format &&
    checked.period_frames === saved.period_frames &&
    checked.periods === saved.periods
  );
}

/** A stopped session may reopen only after its exact device setup was checked. */
export function canResumeAudio(
  stream: { input: AudioProbe; output: AudioProbe },
  input: AudioProbe | null,
  output: AudioProbe | null,
) {
  return sameProbe(input, stream.input) && sameProbe(output, stream.output);
}

/**
 * Check a stopped session's exact saved input and output, as Check does, so
 * Resume never needs a separate check first. Throws when the interface no
 * longer accepts them; nothing is started then.
 */
export async function checkSavedStream(stream: {
  input: AudioProbe;
  output: AudioProbe;
}) {
  const input = await probeAudio(stream.input);
  const output = await probeAudio(stream.output);
  if (!canResumeAudio(stream, input.configuration, output.configuration))
    throw new Error(
      "The interface no longer accepts this session's saved input and output. Reconnect it, or check the audio settings above.",
    );
}

export const resumeUnavailable =
  "Resume checks this session's saved input and output first.";
