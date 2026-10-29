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
  if (!tools) return null;
  const measuring =
    tools.balance.state === 'listening' ||
    tools.alignment.state === 'listening';
  const solo = tools.solo ?? 'none';
  const soloing = solo !== 'none';
  return (
    <details>
      <summary>
        Chain matching
        {soloing && <span> · {solo === 'left' ? 'Left' : 'Right'} solo</span>}
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
