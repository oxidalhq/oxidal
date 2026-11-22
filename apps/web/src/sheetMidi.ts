import type {
  SheetMidiCommand,
  SubscribeSheetMidi,
} from '@oxidal/design-system/widgets/sheet-viewer';

import type { MidiAction } from './api';

const listeners = new Set<(command: SheetMidiCommand) => void>();

export const subscribeSheetMidi: SubscribeSheetMidi = (listener) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** Apply changes between consecutive daemon snapshots. Reconnecting starts with a fresh baseline. */
export function publishSheetMidi(previous: MidiAction, current: MidiAction) {
  if (current.seq <= previous.seq) return;
  const presses = Math.max(
    0,
    (current.sheet_scroll_presses ?? 0) - (previous.sheet_scroll_presses ?? 0),
  );
  const speed =
    current.sheet_speed && current.sheet_speed.seq > previous.seq
      ? current.sheet_speed.speed
      : undefined;
  if (presses || speed !== undefined) {
    for (const listener of listeners) listener({ presses, speed });
  }
}
