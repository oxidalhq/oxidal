import { RecoveryAction } from './components/ui/failure';
import { useFailure } from './lib/useFailure';
import { friendlyError } from './lib/friendlyError';
import { useState, type ReactNode } from 'react';
import { Button } from './components/ui/button';
import { AudioReconfigure } from './AudioReconfigure';
import { BufferFinder } from './BufferFinder';
import {
  graphAudioCommand,
  graphAudioState,
  type GraphAudioState,
  type GraphAudioAction,
  type AudioProbe,
} from './api';
import { canResumeAudio, resumeUnavailable } from './audioResume';

/** Settings operate on the same effects owner as the playing chain. */
export function EffectsPlaybackSettings({
  state,
  connected,
  input,
  output,
  onState,
  boot,
}: {
  state: GraphAudioState;
  connected: boolean;
  input: AudioProbe | null;
  output: AudioProbe | null;
  onState: (state: GraphAudioState) => void;
  boot: ReactNode;
}) {
  const { failure: recoverFailure, fail: recoverFail } = useFailure();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const transitioning =
    state.phase === 'starting' || state.phase === 'stopping';
  async function command(action: GraphAudioAction) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      onState(await graphAudioCommand(state, action));
    } catch (cause) {
      setError(friendlyError(cause, 'change effects playback'));
      recoverFail(cause, 'change effects playback', () => void command(action));
      try {
        onState(await graphAudioState());
      } catch {
        /* retain confirmed state */
      }
    } finally {
      setBusy(false);
    }
  }
  if (!state.configured) return null;
  const stream = state.configured.stream;
  const resumeReady =
    state.device_owned || canResumeAudio(stream, input, output);
  return (
    <section className="control-stack" aria-label="Playback controls">
      <div className="section-heading">
        <h3>Effects audio</h3>
        <span role="status">
          {state.phase === 'starting' ? 'Preparing…' : state.phase}
        </span>
      </div>
      <div className="action-row">
        {state.device_owned && (
          <Button
            variant="outline"
            disabled={!connected || busy || transitioning}
            onClick={() => void command({ kind: 'stop' })}
          >
            Stop audio
          </Button>
        )}
        <Button
          variant="outline"
          disabled={!connected || busy || transitioning || !resumeReady}
          onClick={() => void command({ kind: 'restart' })}
        >
          {state.device_owned ? 'Restart audio' : 'Resume audio'}
        </Button>
      </div>
      {!state.device_owned && !resumeReady && (
        <p className="caption">{resumeUnavailable}</p>
      )}
      {boot}
      {(error || state.error) && <p role="alert">{error || state.error}</p>}
      {error && <RecoveryAction failure={recoverFailure} />}
      <p className="caption">
        {stream.input.sample_rate} Hz · {stream.input.period_frames} samples ×{' '}
        {stream.input.periods} periods
      </p>
      <details
        className="control-help"
        aria-label="Playback session configuration"
      >
        <summary>Current device &amp; buffers</summary>
        <AudioReconfigure
          key={JSON.stringify(stream)}
          initial={stream}
          checkedInput={input}
          checkedOutput={output}
          disabled={!connected || busy || transitioning}
          running={state.phase === 'running'}
          onApply={(stream) => void command({ kind: 'reconfigure', stream })}
        />
        <BufferFinder
          stream={stream}
          running={state.phase === 'running'}
          disabled={!connected || busy || transitioning}
          apply={(stream) => command({ kind: 'reconfigure', stream })}
        />
      </details>
    </section>
  );
}
