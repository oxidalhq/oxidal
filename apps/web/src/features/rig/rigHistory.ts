/**
 * Undo and Redo on the rig canvas. Every edit publishes a new revision of the
 * preset and the one it replaces is kept, so this editing session's history
 * is a list of revisions of one preset (one manifest id). Undo republishes the
 * earlier revision with the playing one as its source: the library keeps one
 * preset, Keep ready and MIDI assignments move to it, and nothing is deleted.
 * Pure, so the stepping rules are tested without a rig.
 * @see docs/interface.md
 * @see docs/mixed-engine.md
 */

/** This editing session's revisions of one preset, oldest first. */
export type RigHistory = {
  /** The manifest id every revision shares. */
  preset: string;
  revisions: string[];
  /** The revision that is playing, as far as this history knows. */
  at: number;
};

/** Revisions kept to step through; older ones stay saved, just unreachable. */
export const HISTORY_LIMIT = 50;

/**
 * The history after an edit published `to` in place of `from`. `replaced` is
 * whether the new revision took the earlier one's place (an edit of a preset
 * in Mine); a first edit of an Oxidal sound or a TONE3000 chain makes a copy
 * instead (a working copy, unsaved until Save a copy), whose history starts
 * at that copy ("Discard changes" goes back).
 */
export function recordEdit(
  history: RigHistory | null,
  edit: { preset: string; from: string; to: string },
  replaced: boolean,
): RigHistory {
  const { preset, from, to } = edit;
  if (!replaced) return { preset, revisions: [to], at: 0 };
  const continues =
    !!history &&
    history.preset === preset &&
    history.revisions[history.at] === from;
  // An edit after Undo drops what Redo could have brought back.
  const base = continues ? history.revisions.slice(0, history.at + 1) : [from];
  const revisions = base.at(-1) === to ? base : [...base, to];
  const kept = revisions.slice(-HISTORY_LIMIT);
  return { preset, revisions: kept, at: kept.length - 1 };
}

/** The revision Undo (-1) or Redo (1) would bring back, or null. */
export function historyTarget(
  history: RigHistory | null,
  playing: string | null | undefined,
  step: -1 | 1,
): string | null {
  if (!history || !playing || history.revisions[history.at] !== playing)
    return null;
  return history.revisions[history.at + step] ?? null;
}

/**
 * The history after a step republished its target as `published`. The same
 * manifest gives the same revision; a re-encoded one gives a new revision with
 * the same content, which takes the target's place.
 */
export function afterStep(
  history: RigHistory,
  step: -1 | 1,
  published: string,
): RigHistory {
  const at = history.at + step;
  if (at < 0 || at >= history.revisions.length) return history;
  const revisions = [...history.revisions];
  revisions[at] = published;
  return { ...history, revisions, at };
}

/** A history read back from storage, if it is well formed. */
export function parseHistory(value: unknown): RigHistory | null {
  if (typeof value !== 'object' || value === null) return null;
  const { preset, revisions, at } = value as Partial<RigHistory>;
  return typeof preset === 'string' &&
    Array.isArray(revisions) &&
    revisions.length > 0 &&
    revisions.length <= HISTORY_LIMIT &&
    revisions.every((r) => typeof r === 'string') &&
    typeof at === 'number' &&
    Number.isInteger(at) &&
    at >= 0 &&
    at < revisions.length
    ? { preset, revisions, at }
    : null;
}

/** Inputs where Cmd/Ctrl+Z belongs to the text being typed. */
const TEXT_INPUTS = new Set([
  '',
  'text',
  'search',
  'email',
  'url',
  'tel',
  'password',
  'number',
  'date',
  'time',
  'datetime-local',
  'month',
  'week',
]);

/** Whether a key press is aimed at a text field or a dialog, not the canvas. */
export function typingIn(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target.closest('[role="dialog"], [role="alertdialog"]')) return true;
  if (target instanceof HTMLTextAreaElement) return true;
  if (target instanceof HTMLInputElement)
    return TEXT_INPUTS.has(target.type.toLowerCase());
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      target.closest('[contenteditable]:not([contenteditable="false"])') !==
        null)
  );
}

/**
 * Cmd/Ctrl+Z is Undo; Shift+Cmd/Ctrl+Z, and Ctrl+Y on Windows and Linux, is
 * Redo. Never while typing in a text field, where the field undoes its text.
 */
export function historyShortcut(
  event: Pick<
    KeyboardEvent,
    | 'key'
    | 'metaKey'
    | 'ctrlKey'
    | 'shiftKey'
    | 'altKey'
    | 'target'
    | 'defaultPrevented'
    | 'isComposing'
  >,
): 'undo' | 'redo' | null {
  if (
    event.defaultPrevented ||
    event.isComposing ||
    event.altKey ||
    !(event.metaKey || event.ctrlKey) ||
    typingIn(event.target)
  )
    return null;
  const key = event.key.toLowerCase();
  if (key === 'z') return event.shiftKey ? 'redo' : 'undo';
  if (key === 'y' && event.ctrlKey && !event.metaKey && !event.shiftKey)
    return 'redo';
  return null;
}
