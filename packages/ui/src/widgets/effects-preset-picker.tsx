import { useState } from 'react';

import { Button } from '../components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
} from '../components/ui/dialog';
import { PresetNameButton, PresetSteps } from './preset-steps';

export type EffectsPresetOption = {
  id: string;
  name: string;
  unavailable?: string;
};

/** Effects-only presets use the same name, list and step controls as Rig. */
export function EffectsPresetPicker({
  name,
  current,
  items,
  disabled,
  loading,
  stopped,
  edited,
  onOpen,
  onChoose,
}: {
  name: string;
  current?: string | null;
  items: EffectsPresetOption[];
  disabled?: boolean;
  loading?: boolean;
  stopped?: boolean;
  edited?: boolean;
  onOpen: () => void;
  onChoose: (item: EffectsPresetOption, source: 'list' | 'step') => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const matched = items.filter((item) =>
    item.name.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const available = items.filter((item) => !item.unavailable);
  const index = available.findIndex((item) => item.id === current);
  const previous = index >= 0 ? available[index - 1] : available.at(-1);
  const next = available[index + 1];
  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-1">
      <PresetNameButton
        className="inline-flex min-h-touch min-w-0 items-center justify-between gap-2 text-left font-semibold [&_svg]:shrink-0"
        name={name}
        label={stopped ? 'Choose an effects preset' : 'Playing preset'}
        disabled={disabled}
        onOpen={() => {
          setQuery('');
          setOpen(true);
          onOpen();
        }}
      >
        <span className="min-w-0 truncate">{name}</span>
      </PresetNameButton>
      <PresetSteps
        previous={previous?.name}
        next={next?.name}
        disabled={disabled || loading}
        onStep={(direction) => {
          const item = direction < 0 ? previous : next;
          if (item) onChoose(item, 'step');
        }}
      />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader title="Choose an effects preset" closeLabel="Close" />
          <DialogBody className="grid gap-2">
            <input
              type="search"
              aria-label="Find an effects preset"
              placeholder="Find an effects preset…"
              className="min-h-touch min-w-0 rounded-md border px-3"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            {!matched.length && (
              <p role="status">
                {loading
                  ? 'Loading saved effects presets…'
                  : query
                    ? 'No matching presets.'
                    : 'No saved effects presets.'}
              </p>
            )}
            {matched.map((item) => {
              const playing = !stopped && item.id === current;
              return (
                <div key={item.id} className="grid gap-1">
                  <Button
                    variant="outline"
                    className="h-auto justify-start [overflow-wrap:anywhere] whitespace-normal"
                    aria-current={playing || undefined}
                    disabled={
                      disabled || !!item.unavailable || (playing && !edited)
                    }
                    onClick={() => {
                      setOpen(false);
                      onChoose(item, 'list');
                    }}
                  >
                    {item.name}
                  </Button>
                  {item.unavailable && (
                    <span className="text-sm text-muted-foreground">
                      {item.unavailable}
                    </span>
                  )}
                </div>
              );
            })}
          </DialogBody>
        </DialogContent>
      </Dialog>
    </div>
  );
}
