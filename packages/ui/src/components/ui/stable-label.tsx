import { cn } from '../../lib/cn';

/**
 * A label whose wording changes with state ("On" and "Off", "Learn" and
 * "Listening…") without changing size: every wording sits in the same grid
 * cell and only the current one is visible, so the control is always as
 * wide as its longest wording and nothing beside it moves. Hidden wordings
 * are not read out.
 */
export function StableLabel({
  value,
  options,
  className,
}: {
  /** The wording to show; it should be one of `options`. */
  value: string;
  /** Every wording this label can show. */
  options: string[];
  className?: string;
}) {
  const all = options.includes(value) ? options : [...options, value];
  return (
    <span data-slot="stable-label" className={cn('inline-grid', className)}>
      {all.map((text) => (
        <span
          key={text}
          className={cn(
            'text-center [grid-area:1/1]',
            text !== value && 'invisible',
          )}
          aria-hidden={text !== value || undefined}
        >
          {text}
        </span>
      ))}
    </span>
  );
}
