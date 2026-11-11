import { useState } from 'react';
import { Copy } from '@phosphor-icons/react';
import { Button } from '../../components/ui/button';
import { friendlyError } from '../../lib/friendlyError';
import { duplicatePreset } from '../library/setList';
import { OfflineEditor } from '../library/OfflineEditor';
import './RigHeaderDuplicate.css';

/**
 * Rig header Duplicate: "Name copy" of the saved preset in Mine, with its
 * scenes, MIDI and levels, not in the set list. The copy opens stopped, in the
 * editor that never changes audio; what is playing keeps playing.
 * @see docs/interface.md
 */
export function RigHeaderDuplicate({
  revision,
  connected,
  disabled,
  changed,
}: {
  revision: string | null | undefined;
  connected: boolean;
  disabled: boolean;
  /** The playing preset has edits that are not saved yet. */
  changed: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [opened, setOpened] = useState<string | null>(null);
  async function duplicate() {
    if (!revision) return;
    setBusy(true);
    setMessage('');
    try {
      const { copy } = await duplicatePreset({ kind: 'rig', id: revision });
      setMessage(
        `Opened "${copy.name}", stopped. It is in Mine, not in the set list.${changed ? ' Edits you have not saved are not in the copy.' : ''}`,
      );
      setOpened(copy.id);
    } catch (cause) {
      setMessage(friendlyError(cause, 'duplicate this preset'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Button
        variant="outline"
        aria-label="Duplicate preset"
        title={
          changed
            ? 'Duplicate copies the saved preset; save first to include your edits'
            : 'Make a copy in Mine'
        }
        disabled={disabled || busy || !revision || !connected}
        onClick={() => void duplicate()}
      >
        <Copy aria-hidden="true" />
        <span className="phone-hidden">Duplicate</span>
      </Button>
      {message && (
        <p className="caption rig-duplicate-status" role="status">
          {message}
        </p>
      )}
      {opened && (
        <OfflineEditor
          revision={opened}
          connected={connected}
          onCancel={() => setOpened(null)}
          onSaved={() => setOpened(null)}
        />
      )}
    </>
  );
}
