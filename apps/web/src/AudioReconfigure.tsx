import { useState } from 'react';
import type { AudioProbe, StartAudio } from './api';
import { BUFFER_SIZES, bufferMs } from './bufferTiming';
import { Button } from './components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './components/ui/select';

type Stream = StartAudio['stream'];

/** Change the existing session's hardware settings without recalling its saved tone. */
export function AudioReconfigure({
  initial,
  checkedInput,
  checkedOutput,
  disabled,
  running,
  onApply,
}: {
  initial: Stream;
  checkedInput: AudioProbe | null;
  checkedOutput: AudioProbe | null;
  disabled: boolean;
  running: boolean;
  onApply: (stream: Stream) => void;
}) {
  const [draft, setDraft] = useState<Stream>(initial);
  function shared(
    key: 'sample_rate' | 'period_frames' | 'periods',
    value: number,
  ) {
    setDraft((current) => ({
      ...current,
      input: { ...current.input, [key]: value },
      output: { ...current.output, [key]: value },
    }));
  }
  const valid =
    [draft.input, draft.output].every(
      (side) =>
        Number.isInteger(side.sample_rate) &&
        side.sample_rate >= 8000 &&
        side.sample_rate <= 192000 &&
        Number.isInteger(side.period_frames) &&
        side.period_frames >= 16 &&
        side.period_frames <= 2048 &&
        Number.isInteger(side.periods) &&
        side.periods >= 2 &&
        side.periods <= 8,
    ) &&
    draft.input.endpoint === draft.output.endpoint &&
    draft.input.sample_rate === draft.output.sample_rate &&
    draft.input.period_frames === draft.output.period_frames &&
    draft.input_map.every(
      (n) => Number.isInteger(n) && n >= 0 && n < draft.input.channels,
    ) &&
    draft.output_map.every(
      (n) => Number.isInteger(n) && n >= 0 && n < draft.output.channels,
    );
  const changed = JSON.stringify(initial) !== JSON.stringify(draft);
  return (
    <fieldset className="control-stack" disabled={disabled}>
      <legend>Adjust current session</legend>
      <p className="caption">
        Applying restarts audio. Your tone and live adjustments are kept.
      </p>
      <div className="audio-routing-fields grid min-w-0 grid-cols-2 gap-3">
        <label className="field col-span-2">
          Sample rate (Hz)
          <Select
            value={String(draft.input.sample_rate)}
            onValueChange={(value) => shared('sample_rate', Number(value))}
          >
            <SelectTrigger aria-label="Session sample rate (Hz)">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[
                ...new Set([
                  44100,
                  48000,
                  88200,
                  96000,
                  initial.input.sample_rate,
                ]),
              ]
                .sort((a, b) => a - b)
                .map((rate) => (
                  <SelectItem key={rate} value={String(rate)}>
                    {rate}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </label>
        <label className="field">
          Buffer (samples)
          <Select
            value={String(draft.input.period_frames)}
            onValueChange={(value) => shared('period_frames', Number(value))}
          >
            <SelectTrigger aria-label="Session buffer (samples)">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[...new Set([...BUFFER_SIZES, initial.input.period_frames])]
                .sort((a, b) => a - b)
                .map((frames) => (
                  <SelectItem key={frames} value={String(frames)}>
                    {frames}
                    {draft.input.sample_rate > 0
                      ? ` · ${((1000 * frames) / draft.input.sample_rate).toFixed(2)} ms`
                      : ''}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </label>
        <label className="field">
          Buffer periods
          <Select
            value={String(draft.input.periods)}
            onValueChange={(value) => shared('periods', Number(value))}
          >
            <SelectTrigger aria-label="Session buffer periods">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[2, 3, 4, 5, 6, 7, 8].map((periods) => (
                <SelectItem key={periods} value={String(periods)}>
                  {periods}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        {(['input_map', 'output_map'] as const).flatMap((key) =>
          ([0, 1] as const).map((index) => (
            <label className="field" key={`${key}:${index}`}>
              {key === 'input_map' ? 'Input' : 'Output'}{' '}
              {index === 0 ? 'left' : 'right'}
              <input
                aria-label={`Session ${key === 'input_map' ? 'input' : 'output'} ${index === 0 ? 'left' : 'right'} channel`}
                type="number"
                min={1}
                max={
                  key === 'input_map'
                    ? draft.input.channels
                    : draft.output.channels
                }
                value={draft[key][index] + 1}
                onChange={(e) => {
                  const next: [number, number] = [...draft[key]];
                  next[index] = Number(e.target.value) - 1;
                  setDraft({ ...draft, [key]: next });
                }}
              />
            </label>
          )),
        )}
      </div>
      {valid && (
        <p className="caption">
          {`Buffer: ${draft.input.period_frames} × ${draft.input.periods} = ${bufferMs(draft.input).toFixed(1)} ms · one period ${((1000 * draft.input.period_frames) / draft.input.sample_rate).toFixed(2)} ms.`}{' '}
          Total input-to-output delay also includes the converters and USB, so
          it is a little higher.
        </p>
      )}
      {checkedInput && checkedOutput && (
        <Button
          variant="outline"
          onClick={() =>
            setDraft({
              ...draft,
              input: checkedInput,
              output: checkedOutput,
              input_map: draft.input_map.map((n) =>
                Math.min(n, checkedInput.channels - 1),
              ) as [number, number],
              output_map: draft.output_map.map((n) =>
                Math.min(n, checkedOutput.channels - 1),
              ) as [number, number],
            })
          }
        >
          Use checked interface
        </Button>
      )}
      <p className="caption">
        Proposed interface: {draft.input.endpoint} · {draft.input.channels} in /{' '}
        {draft.output.channels} out · {draft.input.format} /{' '}
        {draft.output.format}
      </p>
      {changed && !valid && (
        <p role="alert">
          Use matching devices, a buffer of 16–2048 samples, and valid rate and
          channel numbers.
        </p>
      )}
      <div className="action-row">
        <Button disabled={!changed || !valid} onClick={() => onApply(draft)}>
          {running ? 'Apply & restart audio' : 'Apply & resume audio'}
        </Button>
        <Button
          variant="secondary"
          disabled={!changed}
          onClick={() => setDraft(initial)}
        >
          Reset changes
        </Button>
      </div>
    </fieldset>
  );
}
