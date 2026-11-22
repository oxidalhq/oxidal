import { CaretDown, CaretUp } from '@phosphor-icons/react';

import { cn } from '../lib/cn';

export function SilentBranchesToggle({
  names,
  expanded,
  onToggle,
  className,
}: {
  names: string[];
  expanded: boolean;
  onToggle: () => void;
  className?: string;
}) {
  const Icon = expanded ? CaretUp : CaretDown;
  return (
    <button
      type="button"
      aria-expanded={expanded}
      onClick={onToggle}
      className={cn(
        'inline-flex min-h-8 max-w-full items-center gap-1.5 justify-self-start rounded-full border border-dashed border-wire px-3 text-left text-xs text-muted-foreground hover:border-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring max-sm:min-h-touch',
        className,
      )}
    >
      <Icon aria-hidden="true" className="size-3.5 shrink-0" />
      {expanded
        ? `Fold ${names.length} silent branches`
        : `Show ${names.length} silent: ${names.join(', ')}`}
    </button>
  );
}
