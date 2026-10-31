import * as React from 'react';
import * as SliderPrimitive from '@radix-ui/react-slider';

/** shadcn slider composition with a full touch target around the track. */
export function Slider({
  className = '',
  value,
  defaultValue = [0],
  'aria-label': label,
  ...props
}: React.ComponentProps<typeof SliderPrimitive.Root>) {
  const values = value ?? defaultValue;
  return (
    <SliderPrimitive.Root
      className={`ui-slider ${className}`}
      value={value}
      defaultValue={defaultValue}
      {...props}
    >
      <SliderPrimitive.Track className="ui-slider-track">
        <SliderPrimitive.Range className="ui-slider-range" />
      </SliderPrimitive.Track>
      {values.map((_, index) => (
        <SliderPrimitive.Thumb
          key={index}
          className="ui-slider-thumb"
          aria-label={label}
        />
      ))}
    </SliderPrimitive.Root>
  );
}
