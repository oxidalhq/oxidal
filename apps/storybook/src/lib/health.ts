import type {
  ResourceReadings,
  ResourceState,
} from '../widgets/resource-strip';

export type Health = {
  tone: 'good' | 'busy' | 'hot' | 'off';
  /** One or two words everyone understands. */
  word: string;
  /** What it means and what to do, in a sentence. */
  advice: string;
};

/**
 * The device's state in one word. The thresholds follow the audio period:
 * processing near the deadline or any new dropouts is "Busy"; a peak over
 * 90 % of the period or the chip at 80 °C is "Running hot"; the rest "All good".
 */
export function healthOf(
  readings: ResourceReadings,
  state: ResourceState = 'live',
): Health {
  if (state === 'disconnected')
    return {
      tone: 'off',
      word: 'Disconnected',
      advice:
        'This screen lost the device. It reconnects on its own; check the Wi-Fi if it does not.',
    };
  if (state === 'stopped')
    return {
      tone: 'off',
      word: 'Audio stopped',
      advice:
        'No sound is being processed. Start audio from the Rig, or check Audio setup.',
    };
  if (state === 'stale')
    return {
      tone: 'busy',
      word: 'Waiting',
      advice: 'Readings are a few seconds old; the device may be busy.',
    };
  const peak = readings.dsp?.peak ?? 0;
  const p95 = readings.dsp?.p95 ?? 0;
  const temperature = readings.temperature ?? 0;
  if (peak > 0.9 || temperature >= 80)
    return {
      tone: 'hot',
      word: 'Running hot',
      advice:
        temperature >= 80
          ? 'The device is hot. Give it air, or use a lighter preset.'
          : 'Processing is close to its limit. A larger buffer or a lighter preset gives it room.',
    };
  if ((readings.xruns ?? 0) > 0)
    return {
      tone: 'busy',
      word: 'Dropouts',
      advice:
        'The sound broke up for a moment. A larger buffer in Settings › Audio usually stops it.',
    };
  if (p95 > 0.7 || (readings.cpu ?? 0) > 85)
    return {
      tone: 'busy',
      word: 'Busy',
      advice: 'Working hard but keeping up.',
    };
  if ((readings.clips ?? 0) > 0)
    return {
      tone: 'busy',
      word: 'Clipping',
      advice:
        'The output is clipping. Lower the output level or the loudest block.',
    };
  return { tone: 'good', word: 'All good', advice: 'Plenty of headroom.' };
}
