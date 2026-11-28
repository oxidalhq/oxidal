import { ArrowsClockwise } from '@phosphor-icons/react';
import { type ReactNode, useState } from 'react';

import { Button } from '@oxidal/design-system/components/button';
import { Caption } from '@oxidal/design-system/components/text';

import {
  type AudioProbe,
  type RigAudioAction,
  rigAudioCommand,
  type RigAudioState,
  rigAudioState,
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
import { RecoveryNotice } from './RecoveryNotice';

/** Device controls target the same mixed owner shown by the sounding rig. */
export function MixedPlaybackSettings({
  state,
  connected,
  input,
  output,
  onState,
  device,
  startup,
  after,
}: {
  state: RigAudioState;
  connected: boolean;
  input: AudioProbe | null;
  output: AudioProbe | null;
  onState: (state: RigAudioState) => void;
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
  async function command(action: RigAudioAction) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      onState(await rigAudioCommand(state, action));
    } catch (cause) {
      setError(friendlyError(cause, 'change playback'));
      recoverFail(cause, 'change playback', () => void command(action));
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
          owner: 'mixed',
          session: state.session,
          expected_revision: state.revision,
        }}
        initial={stream}
        checkedInput={input}
        checkedOutput={output}
        disabled={!connected || busy || transitioning}
        running={state.phase === 'running'}
        caption="Confirmed edits are kept for Resume after a restart. Save creates a separate preset copy."
        onApply={(stream) => void command({ kind: 'reconfigure', stream })}
      />
      {startup}
      <AudioPlaybackRow
        phase={state.phase}
        status={
          state.phase !== 'stopped' ? shortConfiguration(stream.input) : ''
        }
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
                aria-label={
                  state.phase === 'starting'
                    ? 'Cancel preparation'
                    : 'Stop audio'
                }
                disabled={!connected || busy || state.phase === 'stopping'}
                onClick={() => void command({ kind: 'stop' })}
              >
                {state.phase === 'starting' ? 'Cancel preparation' : 'Stop'}
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
        <RecoveryNotice message={state.recovery_error} />
      </AudioPlaybackRow>
      {after}
    </section>
  );
}
