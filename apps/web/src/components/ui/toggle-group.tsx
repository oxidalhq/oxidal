import * as React from 'react';
import * as ToggleGroupPrimitive from '@radix-ui/react-toggle-group';

export function ToggleGroup({
  className = '',
  ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Root>) {
  return (
    <ToggleGroupPrimitive.Root
      className={`ui-toggle-group ${className}`}
      {...props}
    />
  );
}
export function ToggleGroupItem({
  className = '',
  ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Item>) {
  return (
    <ToggleGroupPrimitive.Item
      className={`ui-toggle-item ${className}`}
      {...props}
    />
  );
}
