/** A path's pan for people: Centre, or how far left or right (7.26). */
export function panLabel(pan: number): string {
  const amount = Math.round(Math.abs(pan) * 100);
  if (amount === 0) return 'Centre';
  return `${amount}% ${pan < 0 ? 'left' : 'right'}`;
}
