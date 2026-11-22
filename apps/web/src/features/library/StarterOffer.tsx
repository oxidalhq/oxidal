import { useEffect, useState } from 'react';

import { Button } from '@oxidal/design-system/components/button';

import './StarterOffer.css';
import { libraryCatalog } from '../../api';
import { friendlyError } from '../../lib/friendlyError';
import { effectsOnlyNeeds } from './oxidal/finish';
import {
  declineStarter,
  setUpStarter,
  starterMessage,
  starterRecipes,
} from './setList';

/**
 * The starter set list, offered once on a fresh unit: an empty set list that
 * was neither added to nor declined before. One step installs the effect packs
 * its sounds need, saves the sounds and adds them. The same action stays in
 * Set list ▸ Add starter set list.
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
  const [packs, setPacks] = useState<{ name: string; sizeMib: number }[]>([]);
  const [blocked, setBlocked] = useState('');
  useEffect(() => {
    let alive = true;
    void libraryCatalog()
      .then(async (catalog) => {
        const offer =
          !catalog.starter_offered && !catalog.items.some((i) => i.in_set_list);
        const needs = offer
          ? await effectsOnlyNeeds(starterRecipes()).catch((cause) => ({
              packs: [],
              blocked: friendlyError(cause, 'check the starter effects'),
            }))
          : null;
        if (!alive) return;
        setPacks(needs?.packs ?? []);
        setBlocked(needs?.blocked ?? '');
        setOffered(offer);
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
      if (add) setMessage(starterMessage(await setUpStarter(setMessage)));
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
      <div className="min-w-0 grow basis-72">
        <strong>Start with a set list?</strong>
        <p className="caption">
          Nine Oxidal sounds, one per core genre, in a playable order.{' '}
          {packs.length
            ? `They use ${packs.length === 1 ? 'one effect pack' : `${packs.length} effect packs`} this unit does not have yet (${packs.map((p) => p.name).join(', ')}; about ${packs.reduce((sum, p) => sum + p.sizeMib, 0)} MB). Oxidal downloads and installs ${packs.length === 1 ? 'it' : 'them'} for you.`
            : !blocked && 'Everything they need is on this unit.'}
        </p>
        {blocked && <p className="caption">{blocked}</p>}
      </div>
      <div className="action-row flex-wrap">
        <Button
          disabled={busy || !connected || !!blocked}
          onClick={() => void answer(true)}
        >
          {packs.length
            ? 'Install and add starter set list'
            : 'Add starter set list'}
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
