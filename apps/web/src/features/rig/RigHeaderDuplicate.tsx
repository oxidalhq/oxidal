import { Copy } from '@phosphor-icons/react';
import { useState } from 'react';

import { Button } from '@oxidal/design-system/components/button';

import { friendlyError } from '../../lib/friendlyError';
import { OfflineEditor } from '../library/OfflineEditor';
import { duplicatePreset } from '../library/setList';

/**
 * Rig header Duplicate: "Name copy" of the saved preset in Mine, with its
 * scenes, MIDI and levels, not in the set list. A preset with scenes or
 * effects opens stopped, in the editor that never changes audio; a TONE3000
 * chain saved in Mine is copied the same way and waits in Mine. What is
 * playing keeps playing.
 * @see docs/interface.md
 */
export function RigHeaderDuplicate({
  entry,
  connected,
  disabled,
  changed,
}: {
  /** The saved preset to copy: a preset with scenes or effects, or a
   * TONE3000 chain saved in Mine. */
  entry: { kind: 'rig' | 'owned'; id: string } | null;
  connected: boolean;
  disabled: boolean;
  /** The playing preset has edits that are not saved yet. */
  changed: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [opened, setOpened] = useState<string | null>(null);
  async function duplicate() {
    if (!entry) return;
    setBusy(true);
    setMessage('');
    try {
      const { copy } = await duplicatePreset(entry);
      const unsaved = changed
        ? ' Edits you have not saved are not in the copy.'
        : '';
      if (copy.kind === 'rig') {
        setMessage(
          `Opened "${copy.name}", stopped. It is in Mine, not in the set list.${unsaved}`,
        );
        setOpened(copy.id);
      } else
        setMessage(`"${copy.name}" is in Mine, not in the set list.${unsaved}`);
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
        disabled={disabled || busy || !entry || !connected}
        onClick={() => void duplicate()}
      >
        <Copy aria-hidden="true" />
        <span className="phone-hidden">Duplicate</span>
      </Button>
      {message && (
        <p className="caption basis-full" role="status">
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
