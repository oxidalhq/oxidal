import { useState } from 'react';

import { Button } from '@oxidal/design-system/components/button';
import { AudioChange } from '@oxidal/design-system/patterns/audio-change';

import type { AudioChangeRequest, AudioProbe, StartAudio } from './api';
import { changeAudio, type useAudioChange } from './audioChangeFeed';
import { BUFFER_SIZES, bufferMs } from './bufferTiming';

export type AudioChangeCursor = Pick<
  Extract<AudioChangeRequest, { kind: 'apply' }>,
  'owner' | 'session' | 'expected_revision'
>;

/** The shared live-hardware editor submits to the device-owned confirmation owner. */
export function TimedAudioReconfigure({
  initial,
  checkedInput,
  checkedOutput,
  cursor,
  disabled,
  feed,
}: {
  initial: StartAudio['stream'];
  checkedInput: AudioProbe | null;
  checkedOutput: AudioProbe | null;
  cursor: AudioChangeCursor;
  disabled: boolean;
  feed: ReturnType<typeof useAudioChange>;
}) {
  const [routing, setRouting] = useState(initial);
  const own = feed.state?.owner === cursor.owner;
  const phase = own && feed.active ? feed.state!.phase : 'idle';
  const ready = !!feed.state && !feed.readFailed;
  const state = feed.state;
  const current = {
    rate: initial.input.sample_rate,
    frames: initial.input.period_frames,
    periods: initial.input.periods,
  };
  const hardwareChanged =
    JSON.stringify({
      ...routing,
      input: {
        ...routing.input,
        sample_rate: initial.input.sample_rate,
        period_frames: initial.input.period_frames,
        periods: initial.input.periods,
      },
      output: {
        ...routing.output,
        sample_rate: initial.output.sample_rate,
        period_frames: initial.output.period_frames,
        periods: initial.output.periods,
      },
    }) !== JSON.stringify(initial);
  const validMaps =
    (['input_map', 'output_map'] as const).every((key) =>
      routing[key].every(
        (value) =>
          Number.isInteger(value) &&
          value >= 0 &&
          value < routing[key === 'input_map' ? 'input' : 'output'].channels,
      ),
    ) && routing.input.endpoint === routing.output.endpoint;
  const send = (request: AudioChangeRequest) => {
    void changeAudio(request).catch(() => {});
  };
  const observation = state?.observed;
  return (
    <div className="grid gap-2">
      {feed.error && (
        <p role="alert">
          {feed.error}
          {feed.active && ' Unconfirmed settings still go back on the device.'}
        </p>
      )}
      {!feed.state && !feed.error && (
        <p role="status">Reading audio confirmation support…</p>
      )}
      {feed.pending && !feed.active && (
        <p role="status">Waiting for the audio settings reply…</p>
      )}
      {own && state?.message && <p role="status">{state.message}</p>}
      <AudioChange
        current={current}
        value={{
          rate: routing.input.sample_rate,
          frames: routing.input.period_frames,
          periods: routing.input.periods,
        }}
        onChange={(setting) => {
          const next = {
            sample_rate: setting.rate,
            period_frames: setting.frames,
            periods: setting.periods,
          };
          setRouting({
            ...routing,
            input: { ...routing.input, ...next },
            output: {
              ...routing.output,
              ...next,
              periods:
                setting.periods === routing.input.periods
                  ? routing.output.periods
                  : setting.periods,
            },
          });
        }}
        phase={
          phase === 'restarting' || phase === 'proving' || phase === 'reverting'
            ? phase
            : 'idle'
        }
        secondsLeft={feed.secondsLeft}
        disabled={disabled || !ready || feed.pending || (feed.active && !own)}
        canApply={validMaps}
        confirmationDisabled={feed.pending || !ready}
        waiting={
          feed.pending ? 'Waiting for the audio settings reply…' : undefined
        }
        recovery={
          own &&
          feed.active &&
          state?.id && (
            <Button
              variant="destructive"
              disabled={feed.pending && feed.pendingAction === 'stop'}
              onClick={() => state.id && send({ kind: 'stop', id: state.id })}
            >
              Stop audio
            </Button>
          )
        }
        canKeep={
          own &&
          state?.phase === 'proving' &&
          feed.secondsLeft > 0 &&
          !feed.error
        }
        currentBufferMs={bufferMs(initial.input) + bufferMs(initial.output)}
        additionalChanges={hardwareChanged}
        choices={{
          rates: [
            ...new Set([
              44100,
              48000,
              88200,
              96000,
              initial.input.sample_rate,
              routing.input.sample_rate,
            ]),
          ].sort((a, b) => a - b),
          frames: [
            ...new Set([
              ...BUFFER_SIZES,
              initial.input.period_frames,
              routing.input.period_frames,
            ]),
          ].sort((a, b) => a - b),
          periods: [
            ...new Set([
              2,
              3,
              4,
              5,
              6,
              7,
              8,
              initial.input.periods,
              routing.input.periods,
            ]),
          ].sort((a, b) => a - b),
        }}
        onApply={(setting) => {
          const fields = {
            sample_rate: setting.rate,
            period_frames: setting.frames,
            periods: setting.periods,
          };
          send({
            kind: 'apply',
            ...cursor,
            input: { ...routing.input, ...fields },
            output: {
              ...routing.output,
              ...fields,
              periods:
                setting.periods === routing.input.periods
                  ? routing.output.periods
                  : setting.periods,
            },
            input_map: routing.input_map,
            output_map: routing.output_map,
          });
        }}
        onSettle={(keep) => {
          if (state?.id && own)
            send({ kind: keep ? 'keep' : 'revert', id: state.id });
        }}
        onReset={() => setRouting(initial)}
        confirmation={
          <div className="mt-3 grid gap-1">
            <p>
              These are readings from the candidate worker, not a listening
              test.
            </p>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1">
              <dt>Processed frames</dt>
              <dd>{observation?.frames ?? 'Unknown'}</dd>
              <dt>Audio underruns</dt>
              <dd>{observation?.xruns ?? 'Unknown'}</dd>
              <dt>Missed deadlines</dt>
              <dd>{observation?.deadline_misses ?? 'Unknown'}</dd>
              <dt>Invalid samples</dt>
              <dd>{observation?.invalid_samples ?? 'Unknown'}</dd>
            </dl>
            {feed.error && <p role="alert">{feed.error}</p>}
          </div>
        }
        details={
          <details className="min-w-0">
            <summary className="min-h-touch cursor-pointer py-2 text-sm font-medium">
              Interface routing
            </summary>
            <div className="grid min-w-0 gap-3 pt-2">
              <p className="text-sm break-words">
                {routing.input.endpoint} · {routing.input.channels} in /{' '}
                {routing.output.channels} out · {routing.input.format} /{' '}
                {routing.output.format}
              </p>
              <p className="text-xs text-muted-foreground">
                Calculated input buffer {bufferMs(initial.input).toFixed(1)} ms;
                output buffer {bufferMs(initial.output).toFixed(1)} ms.
                Converters and USB add delay.
              </p>
              {checkedInput && checkedOutput && (
                <Button
                  variant="outline"
                  onClick={() =>
                    setRouting({
                      ...routing,
                      input: checkedInput,
                      output: checkedOutput,
                      input_map: routing.input_map.map((channel) =>
                        Math.min(channel, checkedInput.channels - 1),
                      ) as [number, number],
                      output_map: routing.output_map.map((channel) =>
                        Math.min(channel, checkedOutput.channels - 1),
                      ) as [number, number],
                    })
                  }
                >
                  Use checked interface
                </Button>
              )}
              <div className="grid min-w-0 grid-cols-2 gap-3">
                {(['input_map', 'output_map'] as const).flatMap((key) =>
                  ([0, 1] as const).map((index) => (
                    <label
                      key={`${key}:${index}`}
                      className="grid min-w-0 gap-1 text-sm"
                    >
                      {key === 'input_map' ? 'Input' : 'Output'}{' '}
                      {index ? 'right' : 'left'}
                      <input
                        aria-label={`Session ${key === 'input_map' ? 'input' : 'output'} ${index ? 'right' : 'left'} channel`}
                        className="min-h-touch min-w-0 rounded-lg border border-input bg-background px-3"
                        type="number"
                        min={1}
                        max={
                          routing[key === 'input_map' ? 'input' : 'output']
                            .channels
                        }
                        value={routing[key][index] + 1}
                        onChange={(event) => {
                          const map: [number, number] = [...routing[key]];
                          map[index] = Number(event.target.value) - 1;
                          setRouting({ ...routing, [key]: map });
                        }}
                      />
                    </label>
                  )),
                )}
              </div>
              {!validMaps && (
                <p role="alert">
                  Use matching input/output devices and channels available on
                  that interface.
                </p>
              )}
            </div>
          </details>
        }
      />
    </div>
  );
}
