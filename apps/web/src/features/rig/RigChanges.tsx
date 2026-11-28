import { ClockCounterClockwise } from '@phosphor-icons/react';
import { type ReactNode, useRef, useState } from 'react';

import { Button } from '@oxidal/design-system/components/button';
import { Caption } from '@oxidal/design-system/components/text';

import { rigBusy } from './mixedRigViewModel';
import type { RigViewProps } from './useMixedRigSession';
import { type RigChange, useRigChanges } from './useRigChanges';

const MESSAGES = {
  restored: 'The change did not go through. The previous values were restored.',
  partial:
    'Only part of the change went through. Check the effect values before trying again.',
};

/** What the chain bar shows about changes since the preset was saved. */
export type RigChangeTools = {
  /** How many changes are listed; 0 when nothing differs. */
  count: number;
  /** The list, each line with its own Undo. */
  list: ReactNode;
  compare: 'edited' | 'saved';
  onCompare: (to: 'edited' | 'saved') => void;
  compareDisabled: boolean;
  /** The saved sound is playing and the edits are held. */
  hearingSaved: boolean;
};

/**
 * What changed since the preset was saved, for the chain bar: a count that
 * opens the list (each line with its own Undo) and an Edited / Saved switch
 * to hear the saved sound and come back to your edits. The edits are held
 * while the saved sound plays; changing anything then counts as a new edit.
 * @see docs/interface.md
 */
export function useRigChangeTools({ rig, vm }: RigViewProps): RigChangeTools {
  const live = useRigChanges({ rig, vm });
  const session = vm.state.control?.session;
  const [kept, setKept] = useState<{
    session: typeof session;
    changes: RigChange[];
  } | null>(null);
  const busy = useRef(false);
  const waiting = rigBusy(vm, rig);

  // Editing while the saved sound plays starts a new edit, and a different
  // preset or a save ends the comparison: drop the held edits either way.
  if (kept && (live.length > 0 || kept.session !== session)) setKept(null);
  const held = kept?.changes ?? null;
  const setHeld = (changes: RigChange[] | null) =>
    setKept(changes ? { session, changes } : null);

  const shown = held ?? live;
  const viewing = held ? 'saved' : 'edited';

  const apply = async (
    values: [RigChange['target'], number][],
    then: () => void,
  ) => {
    if (busy.current || !values.length) return;
    busy.current = true;
    try {
      await rig.setControlsTogether(values, MESSAGES);
      then();
    } finally {
      busy.current = false;
    }
  };
  const compare = (to: 'edited' | 'saved') => {
    if (to === viewing) return;
    if (to === 'saved')
      void apply(
        live.map((c) => [c.target, c.saved]),
        () => setHeld(live),
      );
    else if (held)
      void apply(
        held.map((c) => [c.target, c.current]),
        () => setHeld(null),
      );
  };

  return {
    count: shown.length,
    compare: viewing,
    onCompare: compare,
    compareDisabled: waiting,
    hearingSaved: !!held,
    list: (
      <div className="grid gap-2">
        <p className="m-0 text-sm font-semibold">Changes since saved</p>
        <ul aria-label="Changes list" className="m-0 grid list-none gap-0 p-0">
          {shown.map((change) => (
            <li
              key={change.key}
              className="grid min-h-10 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 border-b border-border py-1 last:border-b-0"
            >
              <ClockCounterClockwise
                className="size-4 text-muted-foreground"
                aria-hidden="true"
              />
              <span className="min-w-0 font-mono text-xs break-words tabular-nums">
                {change.text}
              </span>
              <Button
                size="sm"
                variant="ghost"
                disabled={waiting || !!held}
                aria-label={`Undo: ${change.text}`}
                onClick={() =>
                  void apply([[change.target, change.saved]], () => {})
                }
              >
                Undo
              </Button>
            </li>
          ))}
        </ul>
        <Caption>
          Discard live edits in More puts everything back at once.
        </Caption>
      </div>
    ),
  };
}
