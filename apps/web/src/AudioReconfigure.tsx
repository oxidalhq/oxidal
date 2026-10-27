import { useState } from 'react';
import type { AudioProbe, StartAudio } from './api';
import { Button } from './components/ui/button';

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
      <div className="form-grid">
        <label className="field">
          Session sample rate (Hz)
          <input
            type="number"
            min={8000}
            max={192000}
            step={1}
            value={draft.input.sample_rate}
            onChange={(e) => shared('sample_rate', Number(e.target.value))}
          />
        </label>
        <label className="field">
          Session buffer (samples)
          <input
            type="number"
            min={16}
            max={2048}
            step={1}
            value={draft.input.period_frames}
            onChange={(e) => shared('period_frames', Number(e.target.value))}
          />
        </label>
        <label className="field">
          Session buffer periods
          <input
            type="number"
            min={2}
            max={8}
            step={1}
            value={draft.input.periods}
            onChange={(e) => shared('periods', Number(e.target.value))}
          />
        </label>
        {(['input_map', 'output_map'] as const).flatMap((key) =>
          ([0, 1] as const).map((index) => (
            <label className="field" key={`${key}:${index}`}>
              Session {key === 'input_map' ? 'input' : 'output'}{' '}
              {index === 0 ? 'left' : 'right'} channel
              <input
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
      {checkedInput && checkedOutput && (
        <Button
          variant="outline"
          onClick={() =>
            setDraft({
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
          Use matching input/output devices and valid rate, buffer and channel
          numbers.
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
