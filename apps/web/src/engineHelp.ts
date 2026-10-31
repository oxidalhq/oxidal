/**
 * Plain-language help for native engine settings and device-default display.
 * These seven settings are unit/session scope on native rigs (kept across presets,
 * not saved in them); hybrid nodes carry them per rig.
 * @see docs/native-tone3000.md
 */
export const settingHelp: Record<string, string> = {
  targetLoudness:
    'Loudness the models are normalised to, so different captures sit at a similar level.',
  calibrateInput:
    'Matches the input level to the reference the captures expect from your interface.',
  inputCalibrationLevel:
    'Reference input level used when input calibration is on.',
  osEnabled:
    'Runs the models at a higher internal rate to reduce aliasing. Uses more DSP.',
  osFactor: 'How much higher the internal rate is. Higher costs more DSP.',
  pitchEnabled: 'Turns on the pitch engine used by Pitch shift. Off saves DSP.',
  pitchWindow:
    'Analysis window for the pitch engine. Longer tracks low notes better but adds latency.',
};

/** Device-default values are normalized; show them in the units the engine reports. */
export function formatDefault(target: string, value: number): string | null {
  switch (target) {
    case 'targetLoudness':
      return `${(value * 60 - 60).toFixed(1)} LUFS`;
    case 'pitchWindow':
      return `${[20, 30, 40, 60][Math.round(value * 3)]} ms`;
    case 'calibrateInput':
    case 'osEnabled':
      return value === 1 ? 'On' : 'Off';
    case 'inputCalibrationLevel':
      return `${(value * 120 - 60).toFixed(2)} dB`;
    case 'osFactor':
      return value === 0
        ? '2x'
        : value === 0.5
          ? '4x'
          : value === 1
            ? '8x'
            : null;
    default:
      return null;
  }
}
