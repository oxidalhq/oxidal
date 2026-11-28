import { MusicNotes } from '@phosphor-icons/react';

import { Button } from '@oxidal/design-system/components/button';

import { requestTuner } from './tunerNavigation';

/** The Rig screen's way into the tuner; its label hides on phone headers. */
export function TunerButton({
  disabled,
  compact = false,
}: {
  disabled?: boolean;
  compact?: boolean;
}) {
  return (
    <Button
      variant={compact ? 'ghost' : 'outline'}
      size={compact ? 'sm' : 'md'}
      aria-label="Open tuner"
      title="Tuner"
      disabled={disabled}
      onClick={requestTuner}
    >
      {!compact && <MusicNotes aria-hidden="true" />}
      <span className={compact ? undefined : 'max-sm:sr-only'}>Tuner</span>
    </Button>
  );
}
