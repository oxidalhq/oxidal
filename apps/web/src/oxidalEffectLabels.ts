/**
 * Mode-aware option names for Oxidal's own effects. An LV2 option list is
 * fixed, so Motion's Shape can only declare A, B and C; what each one is
 * depends on the Mode, and the rig shows that name instead.
 * @see docs/native-motion.md
 */
import type { Control } from './generated/contract';

const MOTION_URI_PREFIX = 'urn:oxidal:plugin:motion#';
const MOMENT_URI_PREFIX = 'urn:oxidal:plugin:moment#';

/** Shape names for each Motion mode, by mode value (0 Chorus … 8 Ring). */
const motionShapes: readonly (readonly [string, string, string])[] = [
  ['Two voices', 'Ensemble', 'Shimmering ensemble'],
  ['Classic', 'Through-zero', 'Inverted'],
  ['Four stages', 'Six stages', 'Eight stages'],
  ['Lamp', 'Heavy lamp', 'Even'],
  ['Horn and drum', 'Horn only', 'Brake'],
  ['Sine', 'Triangle', 'Rounded square'],
  ['Sine', 'Triangle', 'Rounded square'],
  ['Sine', 'Triangle', 'Drifting sine'],
  ['Sine', 'Square', 'Octave up'],
];

/** The Shape control of a Motion block with names for its current Mode. */
function withMotionShapeNames(control: Control, mode: number): Control {
  const names = motionShapes[Math.round(mode)];
  if (!names) return control;
  const scale_points = names.map((label, value) => ({ label, value }));
  const display = names[Math.round(control.value)] ?? control.display;
  return { ...control, scale_points, display };
}

/** Apply mode-aware names to one node's controls when it is Motion. */
export function oxidalEffectControls(
  controls: Control[],
  pluginUri: string | undefined,
): Control[] {
  if (pluginUri?.startsWith(MOMENT_URI_PREFIX)) {
    const value = (symbol: string) =>
      controls.find(
        (c) => c.target.kind === 'lv2' && c.target.symbol === symbol,
      )?.value;
    const loop = value('loopmode');
    const wet = value('wetmode');
    const labels: Record<string, string | undefined> = {
      length:
        loop === 0
          ? 'Loop length'
          : loop === 1 || loop === 2
            ? 'Slice size'
            : undefined,
      move:
        loop === 0
          ? 'Tape speed'
          : loop === 1
            ? 'Travel'
            : loop === 2
              ? 'Sensitivity'
              : undefined,
      time:
        wet === 0
          ? 'Size and decay'
          : wet === 1
            ? 'Delay time'
            : wet === 2
              ? 'Sample size'
              : undefined,
      shape:
        wet === 0
          ? 'Echo spread'
          : wet === 1
            ? 'Feedback'
            : wet === 2
              ? 'Pitch speed'
              : undefined,
    };
    return controls.map((c) => {
      const label = c.target.kind === 'lv2' && labels[c.target.symbol];
      return label ? { ...c, label } : c;
    });
  }
  if (!pluginUri?.startsWith(MOTION_URI_PREFIX)) return controls;
  const mode = controls.find(
    (c) => c.target.kind === 'lv2' && c.target.symbol === 'mode',
  );
  if (!mode) return controls;
  return controls.map((c) =>
    c.target.kind === 'lv2' && c.target.symbol === 'shape'
      ? withMotionShapeNames(c, mode.value)
      : c,
  );
}
