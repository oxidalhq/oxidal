import { useState } from 'react';
import { graphAudioState, playbackState, rigAudioState } from '../../api';
import { playScenes } from '../../presetChoices';
import { AdjustmentDialog } from '../../AdjustmentDialog';
import { Button } from '../../components/ui/button';
import { friendlyError } from '../../lib/friendlyError';

async function playbackReview() {
  const states = await Promise.all([
    playbackState(),
    rigAudioState(),
    graphAudioState(),
  ]);
  return JSON.stringify(
    states.map(({ session, revision, phase }) => ({
      session,
      revision,
      phase,
    })),
  );
}

/** Creation is silent; editing currently needs an explicit, reviewed playback change.
 * @see docs/interface.md
 */
export function CreatedPreset({
  name,
  revision,
  connected,
  onOpenRig,
  onDismiss,
  onEdit,
}: {
  name: string;
  revision: string;
  connected: boolean;
  onOpenRig: () => void;
  onDismiss: () => void;
  /** Edit without playing (7.3): opens the offline editor. */
  onEdit?: () => void;
}) {
  const [review, setReview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function prepare() {
    setBusy(true);
    setError('');
    try {
      setReview(await playbackReview());
    } catch (cause) {
      setError(friendlyError(cause, 'review playback'));
    } finally {
      setBusy(false);
    }
  }
  async function play() {
    if (busy || !review) return;
    setBusy(true);
    setError('');
    try {
      if ((await playbackReview()) !== review) {
        setReview(null);
        throw new Error(
          'The playing sound changed. Review Play to edit again.',
        );
      }
      await playScenes(revision);
      onOpenRig();
    } catch (cause) {
      setError(friendlyError(cause, 'play the new preset'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="control-stack" role="status">
      <p>Created {name} in Mine. Your playing sound is unchanged.</p>
      <p className="caption">
        Edit without playing changes it in a draft; Play to edit opens it in
        Rig.
      </p>
      <div className="action-row">
        <Button disabled={!connected || busy} onClick={() => void prepare()}>
          Play to edit…
        </Button>
        {onEdit && (
          <Button variant="outline" disabled={busy} onClick={onEdit}>
            Edit without playing
          </Button>
        )}
        <Button variant="ghost" disabled={busy} onClick={onDismiss}>
          Keep in Library
        </Button>
      </div>
      {error && <p role="alert">{error}</p>}
      {review && (
        <AdjustmentDialog
          title="Play the new preset?"
          onCancel={() => {
            if (!busy) setReview(null);
          }}
        >
          <p>
            This replaces the current playing sound and may interrupt audio.
            Unsaved edits to that sound can be lost.
          </p>
          <p>Cancel and save your current work first if you want to keep it.</p>
          <div className="action-row">
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setReview(null)}
            >
              Cancel
            </Button>
            <Button disabled={!connected || busy} onClick={() => void play()}>
              Replace sound and play
            </Button>
          </div>
          {error && <p role="alert">{error}</p>}
        </AdjustmentDialog>
      )}
    </div>
  );
}
