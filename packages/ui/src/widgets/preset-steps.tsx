import { CaretLeft, CaretRight } from '@phosphor-icons/react';

import { Button } from '../components/ui/button';

/** Quick recall leaves the chain in view. The caller supplies confirmed neighbours. */
export function PresetSteps({
  previous,
  next,
  disabled = false,
  onStep,
}: {
  previous?: string;
  next?: string;
  disabled?: boolean;
  onStep: (direction: -1 | 1) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Switch preset"
      className="inline-flex shrink-0 items-center gap-1"
    >
      {([-1, 1] as const).map((direction) => {
        const label = direction < 0 ? 'Previous preset' : 'Next preset';
        const name = direction < 0 ? previous : next;
        const Icon = direction < 0 ? CaretLeft : CaretRight;
        return (
          <Button
            key={direction}
            size="icon"
            variant="outline"
            aria-label={name ? label + ': ' + name : label}
            title={name ? label + ': ' + name : label}
            disabled={disabled || !name}
            onClick={() => onStep(direction)}
          >
            <Icon aria-hidden="true" />
          </Button>
        );
      })}
    </div>
  );
}
