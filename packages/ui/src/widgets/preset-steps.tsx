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
  size = 'sm',
  only,
  onStep,
}: {
  previous?: string;
  next?: string;
  disabled?: boolean;
  /** `xs` in the floating capsule: borderless, the capsule's height. */
  size?: 'sm' | 'xs';
  /** One arrow on its own, so the two can flank the preset's name. */
  only?: 'previous' | 'next';
  onStep: (direction: -1 | 1) => void;
}) {
  const arrow = (direction: -1 | 1) => {
    const label = direction < 0 ? 'Previous preset' : 'Next preset';
    const name = direction < 0 ? previous : next;
    const Icon = direction < 0 ? CaretLeft : CaretRight;
    return (
      <Button
        key={direction}
        size={size === 'xs' ? 'icon-xs' : 'icon-sm'}
        variant={size === 'xs' ? 'ghost' : 'outline'}
        aria-label={name ? label + ': ' + name : label}
        title={name ? label + ': ' + name : label}
        disabled={disabled || !name}
        onClick={() => onStep(direction)}
      >
        <Icon aria-hidden="true" />
      </Button>
    );
  };
  if (only) return arrow(only === 'previous' ? -1 : 1);
  return (
    <div
      role="group"
      aria-label="Switch preset"
      className={
        size === 'xs'
          ? 'inline-flex shrink-0 items-center'
          : 'inline-flex shrink-0 items-center gap-1'
      }
    >
      {([-1, 1] as const).map(arrow)}
    </div>
  );
}
