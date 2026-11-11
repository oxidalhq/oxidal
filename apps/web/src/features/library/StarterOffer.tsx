import { useEffect, useState } from 'react';
import { libraryCatalog } from '../../api';
import { Button } from '../../components/ui/button';
import { friendlyError } from '../../lib/friendlyError';
import {
  addStarter,
  declineStarter,
  starterEntries,
  starterMessage,
} from './setList';
import './StarterOffer.css';

/**
 * The starter set list, offered once on a fresh unit: an empty set list, the
 * starter Oxidal sounds installed, and neither added nor declined before. The
 * same action stays in Set list ▸ Add starter set list.
 * @see docs/presets/format.md
 */
export function StarterOffer({
  connected,
  refresh = 0,
  onChanged,
}: {
  connected: boolean;
  refresh?: number;
  onChanged: () => void;
}) {
  const [offered, setOffered] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => {
    let alive = true;
    void libraryCatalog()
      .then((catalog) => {
        if (!alive) return;
        setOffered(
          !catalog.starter_offered &&
            !catalog.items.some((i) => i.in_set_list) &&
            starterEntries(catalog).length > 0,
        );
      })
      .catch(() => {
        if (alive) setOffered(false);
      });
    return () => {
      alive = false;
    };
  }, [refresh]);
  async function answer(add: boolean) {
    setBusy(true);
    setMessage('');
    try {
      if (add) setMessage(starterMessage(await addStarter()));
      else {
        await declineStarter();
        setMessage('You can add it later from Set list.');
      }
      setOffered(false);
      onChanged();
    } catch (cause) {
      setMessage(friendlyError(cause, 'add the starter set list'));
    } finally {
      setBusy(false);
    }
  }
  if (!offered)
    return message ? (
      <p className="caption" role="status">
        {message}
      </p>
    ) : null;
  return (
    <div className="starter-offer" role="region" aria-label="Starter set list">
      <div className="min-w-0 flex-1">
        <strong>Start with a set list?</strong>
        <p className="caption">
          Nine Oxidal sounds, one per core genre, in a playable order. They need
          nothing installed.
        </p>
      </div>
      <div className="action-row">
        <Button disabled={busy || !connected} onClick={() => void answer(true)}>
          Add starter set list
        </Button>
        <Button
          variant="ghost"
          disabled={busy || !connected}
          onClick={() => void answer(false)}
        >
          Not now
        </Button>
      </div>
      {message && (
        <p className="caption" role="status">
          {message}
        </p>
      )}
    </div>
  );
}
