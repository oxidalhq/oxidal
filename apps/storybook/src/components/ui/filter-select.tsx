import { cn } from '../../lib/cn';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './select';

/**
 * One filter over a list. It shows its current choice and gains a stronger
 * edge while it is narrowing the list, so a filtered list is never mistaken
 * for the whole one.
 */
export function FilterSelect({
  label,
  value,
  onValue,
  options,
  all = `Every ${label.toLowerCase()}`,
  base = 'all',
  className,
}: {
  label: string;
  value: string;
  onValue: (value: string) => void;
  /** Value and wording of each choice. */
  options: [string, string][];
  /** The wording of the "no filter" choice; `null` when there is none. */
  all?: string | null;
  /** The value that means the list is not narrowed. */
  base?: string;
  className?: string;
}) {
  return (
    <Select value={value} onValueChange={onValue}>
      <SelectTrigger
        aria-label={label}
        className={cn(
          'h-9 w-auto min-w-36',
          value !== base && 'border-foreground',
          className,
        )}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {all !== null && <SelectItem value="all">{all}</SelectItem>}
        {options.map(([v, text]) => (
          <SelectItem key={v} value={v}>
            {text}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
