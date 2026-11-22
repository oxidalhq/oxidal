import { MagnifyingGlass, X } from '@phosphor-icons/react';
import { type RefObject, useRef } from 'react';

import { Button } from '@oxidal/design-system/components/button';

export function LibrarySearch({
  label,
  clearLabel,
  placeholder,
  value,
  onChange,
  inputRef,
  maxLength,
}: {
  label: string;
  clearLabel?: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  inputRef?: RefObject<HTMLInputElement | null>;
  maxLength?: number;
}) {
  const ownRef = useRef<HTMLInputElement>(null);
  const ref = inputRef ?? ownRef;
  return (
    <div className="relative min-w-0">
      <label className="relative block">
        <span className="sr-only">{label}</span>
        <MagnifyingGlass
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <input
          type="search"
          ref={ref}
          value={value}
          maxLength={maxLength}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
          className="h-touch w-full rounded-md border border-input bg-background pr-touch pl-10 text-sm focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-search-cancel-button]:appearance-none"
        />
      </label>
      {value && clearLabel && (
        <Button
          aria-label={clearLabel}
          variant="ghost"
          size="icon"
          className="absolute top-0 right-0"
          onClick={() => {
            onChange('');
            ref.current?.focus();
          }}
        >
          <X aria-hidden="true" />
        </Button>
      )}
    </div>
  );
}
