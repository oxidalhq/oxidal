import { useEffect, useRef } from 'react';
import type { AudioAction, AudioState } from './api';
import { Button } from './components/ui/button';
type Status = NonNullable<AudioState['authoring']>;
export function NativeTools({
  status,
  disabled,
  author,
}: {
  status: Status;
  disabled: boolean;
  author: (
    action: Extract<AudioAction, { kind: 'authoring' }>['action'],
  ) => Promise<void>;
}) {
  const tools = status.tools;
  const latest = useRef({ author, enabled: !!tools?.tuner_enabled });
  useEffect(() => {
    latest.current = { author, enabled: !!tools?.tuner_enabled };
  }, [author, tools?.tuner_enabled]);
  useEffect(
    () => () => {
      if (latest.current.enabled)
        void latest.current.author({
          kind: 'utility',
          command: { kind: 'tuner', enabled: false },
        });
    },
    [],
  );
  if (!tools) return null;
  const measuring =
    tools.balance.state === 'listening' ||
    tools.alignment.state === 'listening';
  const solo = tools.solo ?? 'none';
  const soloing = solo !== 'none';
  const reading = tools.tuner;
  const midi =
    reading && reading.frequency > 0 && reading.confidence >= 0.7
      ? 69 + 12 * Math.log2(reading.frequency / 440)
      : null;
  const nearest = midi === null ? null : Math.round(midi);
  const cents = midi === null ? 0 : Math.round((midi - Math.round(midi)) * 100);
  const note =
    nearest === null
      ? '—'
      : `${['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'][((nearest % 12) + 12) % 12]}${Math.floor(nearest / 12) - 1}`;
  return (
    <details
      onToggle={(event) => {
        if (!event.currentTarget.open && tools.tuner_enabled)
          void author({
            kind: 'utility',
            command: { kind: 'tuner', enabled: false },
          });
      }}
    >
      <summary>
        Tuner & matching
        {soloing && (
          <span className="text-primary">
            {' '}
            · {solo === 'left' ? 'Left' : 'Right'} solo
          </span>
        )}
      </summary>
      <div className="space-y-3 py-2">
        <div className="action-row" role="group" aria-label="Chain monitoring">
          {(['none', 'left', 'right'] as const).map((side) => (
            <Button
              key={side}
              variant={solo === side ? 'secondary' : 'outline'}
              aria-pressed={solo === side}
              disabled={
                disabled ||
                measuring ||
                (side !== 'none' && !status.layout.stereo)
              }
              onClick={() =>
                void author({
                  kind: 'utility',
                  command: { kind: 'solo', side },
                })
              }
            >
              {side === 'none' ? 'Both chains' : `Solo ${side}`}
            </Button>
          ))}
        </div>
        <div className="action-row">
          <Button
            variant="outline"
            disabled={disabled}
            aria-pressed={tools.tuner_enabled}
            onClick={() =>
              void author({
                kind: 'utility',
                command: { kind: 'tuner', enabled: !tools.tuner_enabled },
              })
            }
          >
            {tools.tuner_enabled ? 'Close tuner' : 'Tuner'}
          </Button>
          <Button
            variant="outline"
            disabled={disabled || measuring || soloing || !status.layout.stereo}
            onClick={() =>
              void author({ kind: 'utility', command: { kind: 'balance' } })
            }
          >
            Match levels
          </Button>
          <Button
            variant="outline"
            disabled={disabled || measuring || soloing || !status.layout.stereo}
            onClick={() =>
              void author({ kind: 'utility', command: { kind: 'align' } })
            }
          >
            Align chains · brief mute
          </Button>
          {measuring && (
            <Button
              disabled={disabled}
              onClick={() =>
                void author({ kind: 'utility', command: { kind: 'cancel' } })
              }
            >
              Cancel measurement
            </Button>
          )}
        </div>
        {tools.tuner_enabled && (
          <div
            aria-label="Tuner reading"
            className="flex flex-wrap items-center gap-4 rounded-md border p-3"
          >
            <strong className="min-w-20 font-mono text-4xl">{note}</strong>
            <div className="min-w-40 flex-1">
              <div className="flex justify-between font-mono text-sm">
                <span>♭</span>
                <span>
                  {midi === null
                    ? 'Play a note'
                    : `${cents > 0 ? '+' : ''}${cents} cents`}
                </span>
                <span>♯</span>
              </div>
              <div
                role="meter"
                aria-label="Tuning cents"
                aria-valuemin={-50}
                aria-valuemax={50}
                aria-valuenow={midi === null ? undefined : cents}
                aria-valuetext={
                  midi === null ? 'No reliable pitch' : `${cents} cents`
                }
                className="relative mt-2 h-3 rounded bg-muted"
              >
                <span className="absolute left-1/2 h-full border-l-2 border-foreground" />
                {midi !== null && (
                  <span
                    className="absolute h-full w-2 rounded bg-primary"
                    style={{ left: `calc(${cents + 50}% - 4px)` }}
                  />
                )}
              </div>
            </div>
            {midi !== null && (
              <span className="font-mono text-sm">
                {reading!.frequency.toFixed(1)} Hz
              </span>
            )}
          </div>
        )}
        {(['balance', 'alignment'] as const).map((kind) => {
          const m = tools[kind];
          if (m.state === 'idle') return null;
          return (
            <div
              key={kind}
              className="flex flex-wrap items-center gap-2 text-sm"
              role="status"
            >
              <strong>
                {kind === 'balance' ? 'Level match' : 'Alignment'}
              </strong>
              <span>
                {m.state === 'listening'
                  ? kind === 'balance'
                    ? 'Play through both chains…'
                    : 'Measuring…'
                  : m.state === 'timeout'
                    ? 'No reliable measurement'
                    : kind === 'balance'
                      ? `${m.matchedDb?.toFixed(1) ?? '0.0'} dB matched`
                      : `${m.matchedMs?.toFixed(2) ?? '0.00'} ms${m.polarityFlipped ? ' · polarity corrected' : ''}`}
              </span>
              {m.state === 'listening' && (
                <progress
                  max={1}
                  value={m.progress}
                  aria-label={`${kind} progress`}
                  className="h-2 w-32 accent-primary"
                />
              )}
            </div>
          );
        })}
        {tools.error && <p role="alert">{tools.error}</p>}
      </div>
    </details>
  );
}
