import { CaretDown, CaretLeft, CaretRight } from '@phosphor-icons/react';
import type { ReactNode } from 'react';

import { Button } from '../components/ui/button';

export function PresetNameButton({
  name,
  label = 'Playing preset',
  disabled,
  className,
  onOpen,
  children,
}: {
  name: string;
  label?: string;
  disabled?: boolean;
  className?: string;
  onOpen: () => void;
  children?: ReactNode;
}) {
  return (
    <button
      type="button"
      className={className}
      aria-haspopup="dialog"
      title={name}
      disabled={disabled}
      onClick={onOpen}
    >
      <span className="sr-only">{label}:</span> {children ?? name}
      <CaretDown aria-hidden="true" />
    </button>
  );
}

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
