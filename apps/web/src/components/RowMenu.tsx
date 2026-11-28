import { DotsThree } from '@phosphor-icons/react';

import { Button } from '@oxidal/design-system/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@oxidal/design-system/components/dropdown-menu';
import { Caption } from '@oxidal/design-system/components/text';

export type RowAction =
  | { label: string; onSelect: () => void; disabled?: boolean }
  | { label: string; href: string; download?: boolean };

export type MenuItem = RowAction | 'separator';

export function RowMenu({
  name,
  items,
  label = `More for ${name}`,
  note,
  disabled,
  variant = 'ghost',
  size = 'icon-sm',
}: {
  name: string;
  items: MenuItem[];
  label?: string;
  note?: string;
  disabled?: boolean;
  variant?: 'ghost' | 'outline';
  /** `icon` beside full-height buttons, such as a profile's Save and Revert. */
  size?: 'icon' | 'icon-sm';
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant={variant}
          size={size}
          disabled={disabled}
          aria-label={label}
        >
          <DotsThree aria-hidden="true" weight="bold" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        aria-label={label}
        className="max-h-[var(--radix-dropdown-menu-content-available-height)] overflow-y-auto"
      >
        {items.map((item, index) =>
          item === 'separator' ? (
            <DropdownMenuSeparator key={index} />
          ) : 'href' in item ? (
            <DropdownMenuItem key={item.label} asChild disabled={disabled}>
              <a href={item.href} download={item.download}>
                {item.label}
              </a>
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem
              key={item.label}
              disabled={disabled || item.disabled}
              onSelect={item.onSelect}
            >
              {item.label}
            </DropdownMenuItem>
          ),
        )}
        {note && <Caption className="max-w-64 px-3 py-2">{note}</Caption>}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
