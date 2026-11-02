import { MusicNotes } from '@phosphor-icons/react';
import { Button } from './components/ui/button';
import { requestTuner } from './tunerNavigation';

/** The Rig screen's way into the tuner; its label hides on phone headers. */
export function TunerButton({ disabled }: { disabled?: boolean }) {
  return (
    <Button
      variant="outline"
      aria-label="Open tuner"
      title="Tuner"
      disabled={disabled}
      onClick={requestTuner}
    >
      <MusicNotes aria-hidden="true" />
      <span className="phone-hidden">Tuner</span>
    </Button>
  );
}
