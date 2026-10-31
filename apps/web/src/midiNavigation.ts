const OPEN_MIDI_KEY = 'oxidal-open-midi-assignments';
export const OPEN_MIDI_EVENT = 'oxidal-open-midi-assignments';

/** Opens the sounding preset's MIDI assignments after Library -> Rig navigation. */
export function requestMidiAssignments() {
  try {
    sessionStorage.setItem(OPEN_MIDI_KEY, 'true');
  } catch {
    // The same-tab event still works when browser storage is unavailable.
  }
  window.dispatchEvent(new Event(OPEN_MIDI_EVENT));
}

export function consumeMidiAssignmentRequest() {
  try {
    if (sessionStorage.getItem(OPEN_MIDI_KEY) !== 'true') return false;
    sessionStorage.removeItem(OPEN_MIDI_KEY);
    return true;
  } catch {
    return false;
  }
}
