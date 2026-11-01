type Timing = {
  deadline_us: number;
  process_us_p95: number;
  process_us_max: number;
  process_us_peak?: number | null;
};

// Leave margin for scheduling jitter, controls and transition overlap. These
// are early-warning bands, not a claim that a lower reading guarantees audio.
const P95_HEADROOM_WARNING = 75;
const PEAK_HEADROOM_WARNING = 85;

export function processingHeadroom(audio: Timing | null | undefined) {
  if (!audio || audio.deadline_us <= 0)
    return { p95: null, peak: null, tight: false };
  const p95 = (100 * audio.process_us_p95) / audio.deadline_us;
  const peak =
    (100 * Math.max(audio.process_us_peak ?? 0, audio.process_us_max)) /
    audio.deadline_us;
  return {
    p95,
    peak,
    tight: p95 >= P95_HEADROOM_WARNING || peak >= PEAK_HEADROOM_WARNING,
  };
}
