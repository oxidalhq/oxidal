import { CaretDown, Lightning } from '@phosphor-icons/react';

import { Button } from '../components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '../components/ui/popover';
import { cn } from '../lib/cn';

/** A preset the device keeps loaded so switching to it is instant. */
export type ReadyPreset = {
  id: string;
  name: string;
  /**
   * playing: the sound you hear; processing: loaded and still rendering a
   * tail; sleeping: loaded, using no processing.
   */
  state: 'playing' | 'processing' | 'sleeping';
  /** Modified since saving, or why it cannot be switched to. */
  note?: string;
  unavailable?: boolean;
};

const STATE_WORDS: Record<ReadyPreset['state'], string> = {
  playing: 'Playing',
  processing: 'Finishing its tail',
  sleeping: 'Ready',
};

/**
 * Presets kept loaded for instant switching, on the chain bar's audio line:
 * "4 loaded". It opens a list with each preset's state (a filled light for
 * the one you hear, a pulsing one while a tail rings out, an empty one when
 * it sleeps) and switches on a press, without restarting audio. Presets, not
 * scenes. Always in view, whatever the panel below is showing.
 * @see docs/interface.md
 */
export function ReadyPresets({
  presets,
  disabled = false,
  onSwitch,
}: {
  presets: ReadyPreset[];
  disabled?: boolean;
  onSwitch: (id: string) => void;
}) {
  if (presets.length < 2) return null;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="xs"
          className="gap-1 px-2"
          title="Presets kept loaded: switch without restarting audio"
        >
          <Lightning aria-hidden="true" />
          <span>{presets.length} loaded</span>
          <CaretDown aria-hidden="true" className="size-3" />
          <span className="sr-only">. Switch to a loaded preset</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="center"
        aria-label="Loaded presets"
        className="w-80 max-w-[calc(100vw-2rem)]"
      >
        <div className="grid gap-2">
          <header className="grid gap-0.5">
            <h3 className="m-0 text-sm font-semibold">Loaded presets</h3>
            <p className="m-0 text-xs text-muted-foreground">
              Switch instantly, without restarting audio. These are presets, not
              scenes.
            </p>
          </header>
          <ul className="m-0 grid list-none p-0" role="list">
            {presets.map((preset) => {
              const playing = preset.state === 'playing';
              return (
                <li key={preset.id}>
                  <button
                    type="button"
                    disabled={disabled || playing || preset.unavailable}
                    aria-current={playing || undefined}
                    onClick={() => onSwitch(preset.id)}
                    className="grid min-h-touch w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-md px-2 text-left hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring disabled:hover:bg-transparent [&:disabled:not([aria-current])]:opacity-50"
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        'size-2.5 rounded-full border border-brand',
                        playing && 'bg-brand',
                        preset.state === 'processing' &&
                          'bg-brand/50 motion-safe:animate-pulse',
                      )}
                    />
                    <span className="grid min-w-0">
                      <span
                        className={cn(
                          'truncate text-sm',
                          playing && 'font-semibold',
                        )}
                      >
                        {preset.name}
                      </span>
                      {preset.note && (
                        <span className="truncate text-xs text-muted-foreground">
                          {preset.note}
                        </span>
                      )}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {preset.unavailable
                        ? 'Unavailable'
                        : STATE_WORDS[preset.state]}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </PopoverContent>
    </Popover>
  );
}
