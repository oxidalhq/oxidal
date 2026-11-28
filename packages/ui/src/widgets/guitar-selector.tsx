import { CaretDown, Check } from '@phosphor-icons/react';

import { Button } from '../components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu';
import { cn } from '../lib/cn';

/**
 * The guitar plugged in, under the IN meter: "IN · Telecaster ⌄ · −6 dB".
 * Choosing another applies its input trim before every rig. Takes the
 * device's guitar profiles as they are stored (name and trim in dB).
 * @see docs/interface.md
 */

export type GuitarChoice = {
  id: string;
  name: string;
  /** Input trim in dB (−24 to +24), applied before every rig. */
  trim_db?: number;
};

/** "−6 dB", "+1.5 dB", "0 dB". */
function formatTrim(db = 0) {
  if (db === 0) return '0 dB';
  const text = Math.abs(db).toFixed(Number.isInteger(db) ? 0 : 1);
  return `${db < 0 ? '−' : '+'}${text} dB`;
}

export function GuitarSelector({
  guitars,
  active,
  onSelect,
  onManage,
  items = [],
  onOpenChange,
  disabled = false,
  className,
}: {
  guitars: GuitarChoice[];
  /** The guitar plugged in now; null when none is chosen. */
  active: string | null;
  onSelect: (id: string) => void;
  /** Opens the Guitars page, at the end of the list. */
  onManage?: () => void;
  /**
   * More choices after the guitars, such as always using this guitar for the
   * playing preset.
   */
  items?: {
    id: string;
    label: string;
    onSelect: () => void;
    disabled?: boolean;
  }[];
  /** The list opened or closed, such as to read what is playing. */
  onOpenChange?: (open: boolean) => void;
  disabled?: boolean;
  className?: string;
}) {
  const current = guitars.find((g) => g.id === active) ?? null;
  return (
    <DropdownMenu onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="xs"
          disabled={disabled}
          title="Choose the guitar plugged in"
          className={cn('gap-1.5', className)}
        >
          <span className="small-caps text-xs text-muted-foreground">In</span>
          {current ? current.name : 'No guitar chosen'}
          <CaretDown className="size-3.5" aria-hidden="true" />
          {current && (
            <span className="font-mono text-xs text-muted-foreground tabular-nums">
              {formatTrim(current.trim_db)}
            </span>
          )}
          <span className="sr-only">. Choose the guitar</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>Guitar</DropdownMenuLabel>
        {guitars.length === 0 && (
          <p className="m-0 px-2 py-1.5 text-sm text-muted-foreground">
            No guitars set up yet.
          </p>
        )}
        {guitars.map((g) => (
          <DropdownMenuItem key={g.id} onSelect={() => onSelect(g.id)}>
            <span className="grid min-w-0 flex-1 gap-0.5">
              <span className="truncate font-medium">{g.name}</span>
              <span className="text-xs text-muted-foreground">
                Trim {formatTrim(g.trim_db)}
              </span>
            </span>
            {g.id === active && (
              <Check aria-label="Plugged in" className="shrink-0" />
            )}
          </DropdownMenuItem>
        ))}
        {items.length > 0 && (
          <>
            <DropdownMenuSeparator />
            {items.map((item) => (
              <DropdownMenuItem
                key={item.id}
                disabled={item.disabled}
                onSelect={item.onSelect}
              >
                {item.label}
              </DropdownMenuItem>
            ))}
          </>
        )}
        {onManage && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onManage}>
              Set up guitars…
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
