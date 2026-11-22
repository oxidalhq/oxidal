import { useState } from 'react';

import { Button } from '@oxidal/design-system/components/button';
import { Card } from '@oxidal/design-system/components/card';
import { ActionRow } from '@oxidal/design-system/components/form-layout';
import { Caption } from '@oxidal/design-system/components/text';

import {
  type AudioProbe,
  type GraphAudioAction,
  graphAudioCommand,
  type GraphAudioState,
  graphAudioState,
} from './api';
import { AudioReconfigure } from './AudioReconfigure';
import {
  canResumeAudio,
  checkSavedStream,
  resumeUnavailable,
} from './audioResume';
import { RecoveryAction } from './FailureNotice';
import { friendlyError } from './lib/friendlyError';
import { useFailure } from './lib/useFailure';

/** Settings operate on the same effects owner as the playing chain. */
export function EffectsPlaybackSettings({
  state,
  connected,
  input,
  output,
  onState,
}: {
  state: GraphAudioState;
  connected: boolean;
  input: AudioProbe | null;
  output: AudioProbe | null;
  onState: (state: GraphAudioState) => void;
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
  /** Restart, or resume after checking the saved input and output. */
  async function resume() {
    if (!resumeReady) {
      setBusy(true);
      setError('');
      try {
        await checkSavedStream(stream);
      } catch (cause) {
        setError(friendlyError(cause, 'check the saved input and output'));
        setBusy(false);
        return;
      }
      setBusy(false);
    }
    await command({ kind: 'restart' });
  }
  return (
    <section
      className="grid min-w-0 items-start gap-3 [&>button]:max-w-full [&>button]:justify-self-start"
      aria-label="Playback controls"
    >
      <div className="mb-4 flex min-w-0 flex-wrap items-center justify-between gap-3">
        <h3>Effects audio</h3>
        <span role="status">
          {state.phase === 'starting' ? 'Preparing…' : state.phase}
        </span>
      </div>
      <ActionRow>
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
          disabled={!connected || busy || transitioning}
          onClick={() => void resume()}
        >
          {state.device_owned ? 'Restart audio' : 'Resume audio'}
        </Button>
      </ActionRow>
      {!state.device_owned && !resumeReady && (
        <Caption>{resumeUnavailable}</Caption>
      )}
      {(error || state.error) && <p role="alert">{error || state.error}</p>}
      {error && <RecoveryAction failure={recoverFailure} />}
      <Caption>
        {stream.input.sample_rate} Hz · {stream.input.period_frames} samples ×{' '}
        {stream.input.periods} periods
      </Caption>
      <Card
        className="min-w-0 gap-3"
        aria-label="Playback session configuration"
      >
        <h4>Applied settings</h4>
        <AudioReconfigure
          key={JSON.stringify(stream)}
          cursor={{
            owner: 'effects',
            session: state.session,
            expected_revision: state.revision,
          }}
          initial={stream}
          checkedInput={input}
          checkedOutput={output}
          disabled={!connected || busy || transitioning}
          running={state.phase === 'running'}
          onApply={(stream) => void command({ kind: 'reconfigure', stream })}
        />
      </Card>
    </section>
  );
}
