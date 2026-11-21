const gearLabels: Record<string, string> = {
  amp: 'Amp head',
  combo: 'Combo amp',
  'amp-cab': 'Amp + cab',
  'full-rig': 'Amp + cab',
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
