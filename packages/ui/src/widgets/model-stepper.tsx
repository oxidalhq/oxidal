import {
  ArrowCounterClockwise,
  CaretLeft,
  CaretRight,
} from '@phosphor-icons/react';

import { Button } from '../components/ui/button';

export function ModelStepper({
  label,
  name,
  count,
  index,
  units,
  title,
  disabled,
  stepDisabled,
  backLabel = 'Back to the model it started with',
  backUnavailable,
  onStep,
  onBack,
}: {
  label: string;
  name: string;
  count: number;
  index: number;
  units: 'models' | 'IRs';
  title?: string;
  disabled?: boolean;
  stepDisabled?: boolean;
  backLabel?: string;
  backUnavailable?: string;
  onStep: (direction: -1 | 1) => void;
  onBack?: () => void;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      title={title}
      data-slot="model-stepper"
      className="flex items-center gap-0.5 rounded-lg border border-border bg-background px-1"
    >
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label="Previous model"
        disabled={disabled || stepDisabled}
        onClick={() => onStep(-1)}
      >
        <CaretLeft />
      </Button>
      <span className="grid min-w-0 flex-1 text-center">
        <span className="truncate text-sm font-medium">{name}</span>
        <span className="font-mono text-2xs text-muted-foreground tabular-nums">
          {index >= 0
            ? `${index + 1} of ${count} ${units}`
            : `${count} ${units} to try`}
        </span>
      </span>
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label="Next model"
        disabled={disabled || stepDisabled}
        onClick={() => onStep(1)}
      >
        <CaretRight />
      </Button>
      <span title={backUnavailable}>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={backUnavailable ?? backLabel}
          disabled={disabled || !onBack}
          onClick={onBack}
        >
          <ArrowCounterClockwise />
        </Button>
      </span>
    </div>
  );
}
