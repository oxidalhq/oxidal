import { type ReactNode, useContext, useState } from 'react';
import { createPortal } from 'react-dom';

import { Button } from '@oxidal/design-system/components/button';
import { AudioChange } from '@oxidal/design-system/patterns/audio-change';
import { SettingDisclosure } from '@oxidal/design-system/patterns/settings-page';

import type { AudioChangeRequest, AudioProbe, StartAudio } from './api';
import { changeAudio, type useAudioChange } from './audioChangeFeed';
import { InterfaceRoutingSlot } from './audioSettingsShared';
import { BUFFER_SIZES, bufferMs } from './bufferTiming';
import { useWorkspaceState } from './workspaceMemory';

export type AudioChangeCursor = Pick<
  Extract<AudioChangeRequest, { kind: 'apply' }>,
  'owner' | 'session' | 'expected_revision'
>;

/** The common choices C2 draws side by side; the current setting is always added. */
const COMMON = {
  rates: [44100, 48000, 88200, 96000],
  frames: [48, 64, 96, 128, 256],
  periods: [2, 3, 4],
};

/** The shared live-hardware editor submits to the device-owned confirmation owner. */
export function TimedAudioReconfigure({
  initial,
  checkedInput,
  checkedOutput,
  cursor,
  disabled,
  feed,
  caption,
}: {
  caption?: ReactNode;
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
  const finder = own ? state?.finder : undefined;
  const finderActive =
    finder?.state === 'running' || finder?.state === 'cancelling';
  const [finderOpen, setFinderOpen] = useWorkspaceState(
    `audio-finder-open:${cursor.owner}`,
    false,
  );
  const testedContext =
    !!finder &&
    finder.session === cursor.session &&
    finder.expected_revision === cursor.expected_revision;
  const canUseMeasured =
    testedContext &&
    !!state?.previous &&
    !feed.active &&
    !feed.pending &&
    ready &&
    !disabled &&
    !!finder?.recommended &&
    (finder.recommended.frames !== initial.input.period_frames ||
      finder.recommended.periods !== initial.input.periods);

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
  const slot = useContext(InterfaceRoutingSlot);
  const changePhase =
    !finderActive &&
    (phase === 'restarting' || phase === 'proving' || phase === 'reverting')
      ? phase
      : 'idle';
  const changeDisabled =
    disabled || !ready || feed.pending || (feed.active && !own) || finderActive;
  const routingSection = (
    <SettingDisclosure label="Interface routing">
      <div className="grid min-w-0 gap-3">
        <p className="text-sm break-words">
          {routing.input.endpoint} · {routing.input.channels} in /{' '}
          {routing.output.channels} out · {routing.input.format} /{' '}
          {routing.output.format}
        </p>
        <p className="text-xs text-muted-foreground">
          Calculated input buffer {bufferMs(initial.input).toFixed(1)} ms;
          output buffer {bufferMs(initial.output).toFixed(1)} ms. Converters and
          USB add delay.
        </p>
        {checkedInput && checkedOutput && (
          <Button
            variant="outline"
            className="justify-self-start"
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
                    routing[key === 'input_map' ? 'input' : 'output'].channels
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
            Use matching input/output devices and channels available on that
            interface. Apply them with Apply and restart audio.
          </p>
        )}
        {slot && hardwareChanged && validMaps && (
          <p className="text-xs text-muted-foreground">
            Apply and restart audio uses this routing.
          </p>
        )}
      </div>
    </SettingDisclosure>
  );
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
      {finderActive && (
        <section
          aria-label="Device buffer test"
          className="grid gap-2 rounded-lg border border-border p-3"
        >
          <p role="status">
            Testing {finder!.candidate.frames} × {finder!.candidate.periods} on
            the device.
            {state?.phase === 'proving'
              ? ' Measuring one minute of processed audio.'
              : state?.phase === 'reverting'
                ? ' Restoring the original buffer.'
                : ' Preparing audio.'}
          </p>
          {finder?.message && <p className="text-sm">{finder.message}</p>}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={feed.pending || finder?.state === 'cancelling'}
              onClick={() =>
                state?.id && send({ kind: 'revert', id: state.id })
              }
            >
              Stop test and restore
            </Button>
            <Button
              variant="destructive"
              disabled={feed.pending && feed.pendingAction === 'stop'}
              onClick={() => state?.id && send({ kind: 'stop', id: state.id })}
            >
              Stop audio
            </Button>
          </div>
        </section>
      )}
      <AudioChange
        current={current}
        finderOpen={finderOpen}
        onFinderOpenChange={setFinderOpen}
        finder={{
          trials: finder?.trials ?? [],
          total: finder?.total ?? 0,
          state: finder ? (finderActive ? 'running' : 'done') : 'idle',
          message:
            finder && !finderActive && !testedContext
              ? `${finder.message ?? ''} The rig changed after screening; run again before using a recommendation.`
              : finder?.message,
          recommended: finder?.recommended ?? null,
          startDisabled: disabled || !ready || feed.pending || feed.active,
          cancelDisabled: feed.pending || finder?.state === 'cancelling',
          canUse: canUseMeasured,
          onStart: () => send({ kind: 'find_buffer', ...cursor }),
          onCancel: () => state?.id && send({ kind: 'revert', id: state.id }),
          onUse: (setting) => {
            const previous = state?.previous;
            if (!canUseMeasured || !previous) return;
            send({
              kind: 'apply',
              ...cursor,
              ...previous,
              input: {
                ...previous.input,
                period_frames: setting.frames,
                periods: setting.periods,
              },
              output: {
                ...previous.output,
                period_frames: setting.frames,
                periods: setting.periods,
              },
            });
          },
        }}
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
        phase={changePhase}
        secondsLeft={feed.secondsLeft}
        disabled={changeDisabled}
        caption={caption}
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
        // One device buffer, as the chain bar and the new setting show it;
        // the details give input and output separately.
        currentBufferMs={Math.max(
          bufferMs(initial.input),
          bufferMs(initial.output),
        )}
        additionalChanges={hardwareChanged}
        choices={{
          rates: [
            ...new Set([
              ...COMMON.rates,
              initial.input.sample_rate,
              routing.input.sample_rate,
            ]),
          ].sort((a, b) => a - b),
          frames: [
            ...new Set([
              ...COMMON.frames,
              initial.input.period_frames,
              routing.input.period_frames,
            ]),
          ].sort((a, b) => a - b),
          periods: [
            ...new Set([
              ...COMMON.periods,
              initial.input.periods,
              routing.input.periods,
            ]),
          ].sort((a, b) => a - b),
          // Every size and period count offered before stays one step away.
          more: { frames: BUFFER_SIZES, periods: [5, 6, 7, 8] },
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
        details={slot ? undefined : routingSection}
      />
      {slot &&
        createPortal(
          <fieldset
            disabled={changeDisabled || changePhase !== 'idle'}
            className="grid min-w-0"
          >
            {routingSection}
          </fieldset>,
          slot,
        )}
    </div>
  );
}
