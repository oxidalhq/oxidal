export const OPEN_TUNER_EVENT = 'oxidal-open-tuner';

/** Opens the tuner from any Rig control; App owns the dialog. */
export function requestTuner() {
  window.dispatchEvent(new Event(OPEN_TUNER_EVENT));
}
