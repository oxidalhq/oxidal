const gearLabels: Record<string, string> = {
  amp: 'Amp head',
  combo: 'Combo amp',
  'amp-cab': 'Full rig (amp + cab)',
  'full-rig': 'Full rig',
  cab: 'Cabinet',
  pedal: 'Pedal',
  outboard: 'Outboard',
  space: 'Space',
  experimental: 'Experimental',
  ir: 'Impulse response',
};
export function gearLabel(gear: string) {
  return gearLabels[gear] ?? (gear || 'Model');
}
