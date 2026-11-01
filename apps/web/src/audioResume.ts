import type { AudioProbe } from './api';

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

export const resumeUnavailable =
  "Reconnect and check this session's saved input and output above before resuming.";
