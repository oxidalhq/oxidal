import { createContext, useContext } from 'react';
import type { MidiMapping, MidiMessage, MidiTargetInfo } from '../lib/midi';

export type MidiApi = {
  mappings: MidiMapping[];
  setMappings: (mappings: MidiMapping[]) => void;
  /** Controls on screen that can be mapped. */
  targets: MidiTargetInfo[];
  register: (
    info: MidiTargetInfo,
    handler: (message: MidiMessage) => void,
  ) => () => void;
  /** The MIDI view: every mappable control is marked; a tap learns it. */
  view: boolean;
  setView: (on: boolean) => void;
  learning: string | null;
  learn: (target: string | null) => void;
  /** A message from a controller (the device, Web MIDI, or the pretend controller). */
  receive: (message: MidiMessage) => void;
  last: MidiMessage | null;
};

export const MidiContext = createContext<MidiApi | null>(null);

/** The MIDI state, or null outside a MidiProvider (controls then show no MIDI). */
export function useMidi() {
  return useContext(MidiContext);
}
