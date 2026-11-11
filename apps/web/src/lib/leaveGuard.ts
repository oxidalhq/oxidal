/**
 * One screen at a time can ask before the app navigates away from it, such
 * as the venue EQ with an unsaved edit. The guard receives the navigation and
 * returns true when it will run it itself after asking.
 * @see docs/media.md
 */
type Guard = (leave: () => void) => boolean;
let guard: Guard | null = null;

export function setLeaveGuard(next: Guard): () => void {
  guard = next;
  return () => {
    if (guard === next) guard = null;
  };
}

/** Navigate now, or after the current screen's guard agrees. */
export function leaveScreen(go: () => void) {
  if (guard?.(go)) return;
  go();
}
