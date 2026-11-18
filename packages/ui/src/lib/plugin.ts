/** "fx_mix" → "Fx mix": the label for a plugin control that has no name of its own. */
export function controlLabel(control: { name?: string; symbol: string }) {
  if (control.name) return control.name;
  const words = control.symbol.replace(/[_-]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
