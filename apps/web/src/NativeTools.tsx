import type { AudioAction, AudioState } from './api';
import { Button } from './components/ui/button';
import { ToolRow, ToolSection } from './ToolRow';
type Status = NonNullable<AudioState['authoring']>;

/** Stereo chain matching: temporary solo monitoring plus measured balance/alignment. */
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
  if (!tools || !status.layout.stereo) return null;
  const measuring =
    tools.balance.state === 'listening' ||
    tools.alignment.state === 'listening';
  const solo = tools.solo ?? 'none';
  const soloing = solo !== 'none';
  const result = (kind: 'balance' | 'alignment') => {
    const m = tools[kind];
    if (m.state === 'idle') return 'Not measured';
    if (m.state === 'listening')
      return kind === 'balance' ? 'Listening…' : 'Measuring…';
    if (m.state === 'timeout') return 'No reliable measurement';
    return kind === 'balance'
      ? `${m.matchedDb?.toFixed(1) ?? '0.0'} dB`
      : `${m.matchedMs?.toFixed(2) ?? '0.00'} ms${m.polarityFlipped ? ' · flipped' : ''}`;
  };
  return (
    <ToolSection
      title="Matching"
      scope="Results are saved with this rig"
      label="Chain matching"
    >
      <ToolRow
        title="Listen to"
        value={soloing ? `${solo === 'left' ? 'Left' : 'Right'} only` : 'Both'}
        detail="Temporary: hear one chain on its own while you compare. Not saved."
      >
        <div role="group" aria-label="Chain monitoring" className="contents">
          {(['none', 'left', 'right'] as const).map((side) => (
            <Button
              key={side}
              variant="outline"
              aria-pressed={solo === side}
              disabled={disabled || measuring}
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
      </ToolRow>
      <ToolRow
        title="Level balance"
        value={result('balance')}
        detail="Play through both chains; Match levels sets the output balance so left and right sound equally loud. Undo reverts it."
      >
        <Button
          variant="outline"
          disabled={disabled || measuring || soloing}
          onClick={() =>
            void author({ kind: 'utility', command: { kind: 'balance' } })
          }
        >
          Match levels
        </Button>
      </ToolRow>
      <ToolRow
        title="Timing and polarity"
        value={result('alignment')}
        detail="Measures the delay and polarity between the chains and corrects them. Audio mutes briefly while it measures."
      >
        <Button
          variant="outline"
          disabled={disabled || measuring || soloing}
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
      </ToolRow>
      {(['balance', 'alignment'] as const).map(
        (kind) =>
          tools[kind].state === 'listening' && (
            <progress
              key={kind}
              max={1}
              value={tools[kind].progress}
              aria-label={`${kind} progress`}
              className="h-2 w-full accent-primary"
            />
          ),
      )}
      {soloing && (
        <p className="tool-status" role="status">
          Solo is on: matching is paused until you listen to both chains.
        </p>
      )}
      {tools.error && <p role="alert">{tools.error}</p>}
    </ToolSection>
  );
}
