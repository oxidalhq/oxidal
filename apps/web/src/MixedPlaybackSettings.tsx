import { RecoveryNotice } from './RecoveryNotice';
import { useState } from 'react';
import { Button } from './components/ui/button';
import { AudioReconfigure } from './AudioReconfigure';
import {
  rigAudioCommand,
  rigAudioState,
  type RigAudioState,
  type RigAudioAction,
  type AudioProbe,
} from './api';

/** Device controls target the same mixed owner shown by the sounding rig. */
export function MixedPlaybackSettings({
  state,
  connected,
  input,
  output,
  onState,
}: {
  state: RigAudioState;
  connected: boolean;
  input: AudioProbe | null;
  output: AudioProbe | null;
  onState: (state: RigAudioState) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const transitioning =
    state.phase === 'starting' || state.phase === 'stopping';
  async function command(action: RigAudioAction) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      onState(await rigAudioCommand(state, action));
    } catch (cause) {
      setError(String(cause));
      try {
        onState(await rigAudioState());
      } catch {
        /* retain confirmed status */
      }
    } finally {
      setBusy(false);
    }
  }
  if (!state.configured) return null;
  const stream = state.configured.stream;
  return (
    <section className="control-stack" aria-label="Playback controls">
      <div className="section-heading">
        <h3>Rig audio</h3>
        <span role="status">
          {state.phase === 'starting' ? 'Preparing…' : state.phase}
        </span>
      </div>
      <div className="action-row">
        {state.device_owned && (
          <Button
            variant="outline"
            disabled={!connected || busy || state.phase === 'stopping'}
            onClick={() => void command({ kind: 'stop' })}
          >
            {state.phase === 'starting' ? 'Cancel preparation' : 'Stop audio'}
          </Button>
        )}
        <Button
          variant="outline"
          disabled={!connected || busy || transitioning}
          onClick={() => void command({ kind: 'restart' })}
        >
          {state.device_owned ? 'Restart audio' : 'Resume session'}
        </Button>
      </div>
      {(error || state.error) && <p role="alert">{error || state.error}</p>}
      <RecoveryNotice message={state.recovery_error} />
      <p className="caption">
        {stream.input.sample_rate} Hz · {stream.input.period_frames} samples ×{' '}
        {stream.input.periods} periods
      </p>
      <details
        className="control-help"
        aria-label="Playback session configuration"
      >
        <summary>Current device &amp; buffers</summary>
        <p className="caption">
          Confirmed edits are kept for Resume after a restart. Save creates a
          separate preset copy.
        </p>
        <AudioReconfigure
          key={JSON.stringify(stream)}
          initial={stream}
          checkedInput={input}
          checkedOutput={output}
          disabled={!connected || busy || transitioning}
          running={state.phase === 'running'}
          onApply={(stream) => void command({ kind: 'reconfigure', stream })}
        />
      </details>
    </section>
  );
}
