/**
 * A path's level, pan and polarity are its left and right merge gains, and the
 * rig takes one control per command. `applyTogether` sends them in order and,
 * when a later one fails, puts back the ones already sent, so a pan is never
 * left half applied.
 * @see docs/mixed-engine.md
 */

/** How a set of changes ended. */
export type Together =
  /** Every change went through. */
  | 'applied'
  /** The first change failed; nothing changed. */
  | 'failed'
  /** A later change failed and the earlier ones are back as they were. */
  | 'restored'
  /** A later change failed and an earlier one could not be put back. */
  | 'partial';

export async function applyTogether<T>(
  changes: [T, number][],
  read: (target: T) => number | undefined,
  set: (target: T, value: number) => Promise<boolean>,
): Promise<Together> {
  const undo: [T, number | undefined][] = [];
  for (const [target, value] of changes) {
    const before = read(target);
    if (await set(target, value)) {
      undo.unshift([target, before]);
      continue;
    }
    if (!undo.length) return 'failed';
    let restored = true;
    for (const [done, earlier] of undo)
      restored =
        earlier !== undefined && (await set(done, earlier)) && restored;
    return restored ? 'restored' : 'partial';
  }
  return 'applied';
}
