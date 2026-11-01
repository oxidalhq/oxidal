import { describe, expect, it } from 'vitest';
import type { AudioProbe } from './api';
import { canResumeAudio } from './audioResume';

const input: AudioProbe = {
  endpoint: 'hw:CARD=Jogg,DEV=0',
  direction: 'capture',
  sample_rate: 48000,
  channels: 1,
  format: 's24_packed',
  period_frames: 48,
  periods: 3,
};
const output: AudioProbe = {
  ...input,
  direction: 'playback',
  channels: 2,
};

describe('stopped audio resume', () => {
  it('requires both saved directions to have been checked exactly', () => {
    expect(canResumeAudio({ input, output }, input, output)).toBe(true);
    expect(canResumeAudio({ input, output }, null, output)).toBe(false);
    expect(canResumeAudio({ input, output }, input, null)).toBe(false);
  });

  it('rejects a check made with different stream settings', () => {
    expect(
      canResumeAudio(
        { input, output },
        { ...input, period_frames: 128 },
        output,
      ),
    ).toBe(false);
    expect(
      canResumeAudio({ input, output }, input, {
        ...output,
        endpoint: 'hw:CARD=HDMI,DEV=0',
      }),
    ).toBe(false);
  });
});
