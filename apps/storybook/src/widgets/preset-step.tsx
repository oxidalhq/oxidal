import { CaretLeft, CaretRight } from '@phosphor-icons/react';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import { Caption, Eyebrow, Title } from '@/components/ui/text';

/**
 * Where you are in the set list and the two buttons that move you: the
 * stage's main control after the scenes. The name is the biggest thing on
 * the screen; the position and the list name sit beneath it in small caps
 * and a caption. Buttons are stage size and work from a footswitch too.
 */
export function PresetStepper({
  name,
  position,
  count,
  list,
  unsaved = false,
  disabled = false,
  busy = false,
  size = 'lg',
  onPrevious,
  onNext,
  className,
}: {
  name: string;
  /** 1-based position in the list. */
  position: number;
  count: number;
  /** The set list's name, if one is playing. */
  list?: string;
  unsaved?: boolean;
  disabled?: boolean;
  busy?: boolean;
  size?: 'md' | 'lg';
  onPrevious: () => void;
  onNext: () => void;
  className?: string;
}) {
  const buttons = size === 'lg' ? 'icon-lg' : 'icon';
  return (
    <div
      data-slot="preset-stepper"
      className={cn(
        'grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3',
        className,
      )}
    >
      <Button
        variant="outline"
        size={buttons}
        aria-label="Previous preset"
        disabled={disabled || busy || position <= 1}
        onClick={onPrevious}
      >
        <CaretLeft weight="bold" />
      </Button>
      <div className="grid min-w-0 justify-items-center gap-0.5 text-center">
        <Eyebrow>
          {position} of {count}
          {list ? ` · ${list}` : ''}
        </Eyebrow>
        <Title
          size={size === 'lg' ? 'display' : 'lg'}
          className="w-full truncate"
          aria-live="polite"
        >
          {name}
        </Title>
        {unsaved && <Caption className="text-xs">Unsaved edits</Caption>}
      </div>
      <Button
        variant="outline"
        size={buttons}
        aria-label="Next preset"
        disabled={disabled || busy || position >= count}
        onClick={onNext}
      >
        <CaretRight weight="bold" />
      </Button>
    </div>
  );
}
