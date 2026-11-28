import { CaretDown, Check, SquaresFour } from '@phosphor-icons/react';
import * as React from 'react';

import { Button } from '../components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '../components/ui/popover';
import { Separator } from '../components/ui/separator';
import { Caption } from '../components/ui/text';
import { cn } from '../lib/cn';

export type ChangeScopeValue = 'scene' | 'preset';

/**
 * Where a change goes, as one quiet line beside the preset's name. It stays
 * out of the way on the whole preset, and shows the scene's colour and name
 * while changes belong to one scene, so that is never missed.
 */
export function ChangeScope({
  scope,
  sceneName,
  sceneColour,
  onScope,
  onEditScenes,
  size = 'sm',
  className,
}: {
  scope: ChangeScopeValue;
  /** The scene playing now. */
  sceneName: string;
  sceneColour?: string;
  onScope: (scope: ChangeScopeValue) => void;
  onEditScenes: () => void;
  /** `xs` for a slim bar; touch screens keep the full target either way. */
  size?: 'sm' | 'xs';
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const id = React.useId();
  const options: { value: ChangeScopeValue; name: string; about: string }[] = [
    {
      value: 'preset',
      name: 'Whole preset',
      about: 'Every scene hears the change.',
    },
    {
      value: 'scene',
      name: 'This scene',
      about: `Only ${sceneName} changes: on or off, branch levels, values and blocks you add. Moving or removing a block still changes the whole preset.`,
    },
  ];
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-slot="change-scope"
          className={cn(
            'inline-flex items-center gap-1.5 rounded-md px-1.5 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [@media(pointer:coarse)]:min-h-touch',
            size === 'xs' ? 'min-h-control-xs' : 'min-h-control',
            scope === 'scene' && 'text-foreground',
            className,
          )}
        >
          {scope === 'scene' && (
            <span
              aria-hidden="true"
              className="size-2 shrink-0 rounded-full bg-brand"
              style={sceneColour ? { background: sceneColour } : undefined}
            />
          )}
          <span className="truncate">
            Changes: {scope === 'scene' ? `${sceneName} only` : 'whole preset'}
          </span>
          <CaretDown className="size-3.5 shrink-0" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="grid w-80 gap-2 p-2">
        <span className="px-2 pt-1 small-caps text-sm font-medium text-muted-foreground">
          Changes apply to
        </span>
        <div role="radiogroup" aria-label="Changes apply to" className="grid">
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={scope === o.value}
              aria-labelledby={`${id}-${o.value}`}
              aria-describedby={`${id}-${o.value}-about`}
              onClick={() => {
                onScope(o.value);
                setOpen(false);
              }}
              className="grid min-h-touch grid-cols-[1.25rem_minmax(0,1fr)] items-start gap-2 rounded-md px-2 py-2 text-left hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
            >
              <span className="grid h-5 place-items-center">
                {scope === o.value && (
                  <Check className="size-4" aria-hidden="true" />
                )}
              </span>
              <span className="grid min-w-0 gap-0.5">
                <span id={`${id}-${o.value}`} className="text-sm font-medium">
                  {o.name}
                </span>
                <Caption
                  as="span"
                  id={`${id}-${o.value}-about`}
                  className="text-xs"
                >
                  {o.about}
                </Caption>
              </span>
            </button>
          ))}
        </div>
        <Separator />
        <Button
          size="sm"
          variant="ghost"
          className="justify-start"
          onClick={() => {
            setOpen(false);
            onEditScenes();
          }}
        >
          <SquaresFour /> Edit scenes…
        </Button>
      </PopoverContent>
    </Popover>
  );
}
