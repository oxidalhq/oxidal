import { Button } from './components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './components/ui/select';
import type { MidiDevices, MidiMap } from './api';

type Extra = NonNullable<MidiMap['extra_inputs']>[number];
/** The first controller plus at most three more, as the device allows. */
const MAX_EXTRA = 3;

/**
 * Further controllers heard at the same time. Each is enabled explicitly, has
 * its own channel and keeps its own Bank Select, so two pedals sending the same
 * Program or CC never share state. Learn can be limited to one of them.
 * @see docs/architecture.md
 */
export function ExtraControllers({
  map,
  devices,
  sources,
  busy,
  learnSource,
  onChange,
  onLearnSource,
}: {
  map: MidiMap;
  devices: MidiDevices | null;
  sources: { connected: boolean }[];
  busy: boolean;
  learnSource: number;
  onChange: (extras: Extra[]) => void;
  onLearnSource: (source: number) => void;
}) {
  const extras = map.extra_inputs ?? [];
  const taken = new Set([map.input, ...extras.map((e) => e.input)]);
  const free = devices?.inputs.find((device) => !taken.has(device.id));
  const nameOf = (id: string) =>
    devices?.inputs.find((device) => device.id === id)?.name ?? id;
  if (!map.input) return null;
  return (
    <section className="midi-extra" aria-label="Additional controllers">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <strong>Additional controllers</strong>
        <span className="caption">
          Each one is listened to only after you add it.
        </span>
      </div>
      {extras.map((extra, index) => (
        <div key={extra.input} className="midi-extra-row">
          <label className="field min-w-0">
            Controller {index + 2}
            <Select
              value={extra.input}
              disabled={busy}
              onValueChange={(value) =>
                onChange(
                  extras.map((e, i) =>
                    i === index ? { ...e, input: value } : e,
                  ),
                )
              }
            >
              <SelectTrigger aria-label={`Controller ${index + 2} device`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {!devices?.inputs.some((d) => d.id === extra.input) && (
                  <SelectItem value={extra.input}>
                    {extra.input} · unavailable
                  </SelectItem>
                )}
                {devices?.inputs
                  .filter((d) => d.id === extra.input || !taken.has(d.id))
                  .map((device) => (
                    <SelectItem key={device.id} value={device.id}>
                      {device.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </label>
          <label className="field">
            Channel
            <Select
              value={String(extra.channel)}
              disabled={busy}
              onValueChange={(value) =>
                onChange(
                  extras.map((e, i) =>
                    i === index ? { ...e, channel: Number(value) } : e,
                  ),
                )
              }
            >
              <SelectTrigger aria-label={`Controller ${index + 2} channel`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="0">All</SelectItem>
                {Array.from({ length: 16 }, (_, i) => (
                  <SelectItem key={i + 1} value={String(i + 1)}>
                    {i + 1}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <span className="caption midi-extra-state">
            {sources[index]?.connected ? 'Connected' : 'Not connected'}
          </span>
          <Button
            variant="outline"
            className="midi-tool"
            disabled={busy}
            onClick={() => {
              if (learnSource === index + 1) onLearnSource(0);
              onChange(extras.filter((_, i) => i !== index));
            }}
          >
            Remove <span className="sr-only">controller {index + 2}</span>
          </Button>
        </div>
      ))}
      <div className="midi-extra-actions">
        <Button
          variant="outline"
          disabled={busy || !free || extras.length >= MAX_EXTRA}
          onClick={() =>
            free && onChange([...extras, { input: free.id, channel: 1 }])
          }
        >
          Add controller
        </Button>
        {extras.length > 0 && (
          <label className="field midi-extra-learn">
            Learn from
            <Select
              value={String(learnSource)}
              onValueChange={(value) => onLearnSource(Number(value))}
            >
              <SelectTrigger aria-label="Learn from controller">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="0">
                  Controller 1 · {nameOf(map.input)}
                </SelectItem>
                {extras.map((e, i) => (
                  <SelectItem key={e.input} value={String(i + 1)}>
                    Controller {i + 2} · {nameOf(e.input)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
        )}
      </div>
    </section>
  );
}
