import { ArrowsClockwise } from '@phosphor-icons/react';
import { type ReactNode, useState } from 'react';

import { Button } from '@oxidal/design-system/components/button';
import { Caption } from '@oxidal/design-system/components/text';

import {
  type AudioProbe,
  type GraphAudioAction,
  graphAudioCommand,
  type GraphAudioState,
  graphAudioState,
} from './api';
import { AudioPlaybackRow } from './AudioPlaybackRow';
import { AudioReconfigure } from './AudioReconfigure';
import {
  canResumeAudio,
  checkSavedStream,
  resumeUnavailable,
} from './audioResume';
import { shortConfiguration } from './audioSettingsShared';
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
  device,
  startup,
  after,
}: {
  state: GraphAudioState;
  connected: boolean;
  input: AudioProbe | null;
  output: AudioProbe | null;
  onState: (state: GraphAudioState) => void;
  /** Settings › Audio › Device, above the session card. */
  device?: ReactNode;
  /** When Oxidal starts, between the session card and Playback. */
  startup?: ReactNode;
  /** After Playback: the output test and level. */
  after?: ReactNode;
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
      className="grid min-w-0 items-start gap-6"
      aria-label="Playback controls"
    >
      {device}
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
      {startup}
      <AudioPlaybackRow
        phase={state.phase}
        status={[
          'Effects audio',
          state.phase !== 'stopped' ? shortConfiguration(stream.input) : '',
        ]
          .filter(Boolean)
          .join(' · ')}
        buttons={
          <>
            <Button
              size="sm"
              variant="outline"
              aria-label={state.device_owned ? 'Restart audio' : 'Resume audio'}
              disabled={!connected || busy || transitioning}
              onClick={() => void resume()}
            >
              <ArrowsClockwise aria-hidden="true" />
              {state.device_owned ? 'Restart' : 'Resume'}
            </Button>
            {state.device_owned && (
              <Button
                size="sm"
                variant="destructive"
                aria-label="Stop audio"
                disabled={!connected || busy || transitioning}
                onClick={() => void command({ kind: 'stop' })}
              >
                Stop
              </Button>
            )}
          </>
        }
      >
        {!state.device_owned && !resumeReady && (
          <Caption>{resumeUnavailable}</Caption>
        )}
        {(error || state.error) && <p role="alert">{error || state.error}</p>}
        {error && <RecoveryAction failure={recoverFailure} />}
      </AudioPlaybackRow>
      {after}
    </section>
  );
}
