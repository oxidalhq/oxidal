import { useEffect, useState } from 'react';

import './oxidal.css';
import { AdjustmentDialog } from '../../../AdjustmentDialog';
import { libraryCatalog } from '../../../api';
import { Button } from '../../../components/ui/button';
import { DialogFooter } from '../../../components/ui/dialog';
import { factoryRoles, factoryTopologySummary } from '../../../factoryRecipes';
import { isFactoryVoice, primaryCapture } from '../../../factoryVoices';
import { friendlyError } from '../../../lib/friendlyError';
import { setListMember } from '../setList';
import { type CardHandlers, cardLine, primaryFor } from './cardActions';
import {
  type CardState,
  chainNames,
  complexityLabel,
  engineLabel,
  loadEstimate,
  roleLabel,
  sceneGuide,
  type SoundItem,
} from './oxidalSounds.model';
import { ToneLink } from './ToneLink';
import type { OxidalSounds } from './useOxidalSounds';

/**
 * The one Details sheet every card opens: description, inspiration, how to play
 * each scene, chain, requirements and load, with Play, Add to set list and
 * Make my copy.
 * @see docs/factory-collection.md
 */
export function DetailsSheet({
  item,
  state,
  unit,
  handlers,
  onClose,
}: {
  item: SoundItem;
  state: CardState;
  unit: OxidalSounds;
  handlers: CardHandlers;
  onClose: () => void;
}) {
  const primary = primaryFor(item, state, unit, handlers);
  const copyable = state.kind === 'ready' || state.kind === 'build';
  const needs =
    state.kind === 'ready' || state.kind === 'build'
      ? item.recipe &&
        item.meta.namInstances === 0 &&
        !item.meta.requiredPacks.length
        ? 'Nothing to install'
        : 'Everything is installed'
      : cardLine(item, state, unit).replace(/^Needs: /, '');
  const guide = item.recipe ? sceneGuide(item.recipe) : [];
  // Every suggested tone with its TONE3000 page, so it can be checked first.
  const tones = item.recipe
    ? [...new Set(factoryRoles(item.recipe))].flatMap((role) =>
        isFactoryVoice(role) ? [{ role, capture: primaryCapture(role) }] : [],
      )
    : [];
  // Whether this unit's tones are known yet; until then say nothing.
  const known = ['tone', 'signed-out', 'ready', 'build'].includes(state.kind);
  const missing = new Set(
    state.kind === 'tone' || state.kind === 'signed-out'
      ? state.missing.map((t) => t.role)
      : [],
  );
  const listed = useSetListPlace(item.built?.revision);
  const [setList, setSetList] = useState('');
  const [adding, setAdding] = useState(false);
  async function addToSetList() {
    setAdding(true);
    setSetList('');
    try {
      const revision = item.built?.revision ?? (await unit.build(item));
      if (!revision) return;
      const catalog = await setListMember({ kind: 'rig', id: revision }, true);
      const place =
        catalog.items
          .filter((i) => i.in_set_list)
          .findIndex((i) => i.kind === 'rig' && i.id === revision) + 1;
      listed.set(place);
      setSetList(`${item.name} is in the set list as #${place}.`);
    } catch (cause) {
      setSetList(friendlyError(cause, 'add this sound to the set list'));
    } finally {
      setAdding(false);
    }
  }
  return (
    <AdjustmentDialog title={item.name} onCancel={onClose}>
      <div className="control-stack oxidal-details">
        <p className="caption">
          {item.meta.genres.join(' · ')} · {engineLabel(item.meta.engine)} ·{' '}
          {complexityLabel(item.meta.complexity)}
        </p>
        <p>{item.description}</p>
        {item.meta.inspiration && <p>{item.meta.inspiration}</p>}
        <section aria-label="How to play it">
          <h3>How to play it</h3>
          {item.meta.performance && <p>{item.meta.performance}</p>}
          <ol className="oxidal-scenes">
            {(guide.length
              ? guide
              : item.sceneNames.map((name) => ({ name, detail: '' }))
            ).map((scene) => (
              <li key={scene.name}>
                <strong>{scene.name}</strong>
                {scene.detail && <span> · {scene.detail}</span>}
              </li>
            ))}
          </ol>
        </section>
        <dl className="oxidal-facts">
          {item.recipe && (
            <>
              <dt>Chain</dt>
              <dd>
                {chainNames(item.recipe).join(' → ')}
                <span className="caption block">
                  {factoryTopologySummary(item.recipe)}
                </span>
              </dd>
            </>
          )}
          <dt>Needs</dt>
          <dd>
            {tones.length > 0 &&
            (state.kind === 'tone' || state.kind === 'signed-out') ? (
              <>Tones from TONE3000 ({missing.size} not on this unit yet)</>
            ) : (
              needs
            )}
          </dd>
          {tones.length > 0 && (
            <>
              <dt>Tones</dt>
              <dd>
                <ul className="oxidal-tone-refs">
                  {tones.map(({ role, capture }) => (
                    <li key={role}>
                      <span>{roleLabel(role)}</span>
                      <span className="caption">
                        <ToneLink tone={capture.tone} />
                        {capture.model !== undefined &&
                          ` · model ${capture.model}`}
                        {known &&
                          (missing.has(role)
                            ? ' · not on this unit'
                            : ' · on this unit')}
                      </span>
                    </li>
                  ))}
                </ul>
              </dd>
            </>
          )}
          <dt>Load</dt>
          <dd>{loadEstimate(item, unit.facts.frames)}</dd>
        </dl>
        {state.kind === 'heavy' && (
          <p role="status">
            Play is not offered: {cardLine(item, state, unit)}
          </p>
        )}
        <DialogFooter>
          {primary && (
            <Button
              disabled={primary.disabled}
              onClick={() => {
                onClose();
                primary.run();
              }}
            >
              {primary.label}
            </Button>
          )}
          <Button
            variant="outline"
            disabled={!copyable || !!listed.place || adding || !unit.connected}
            onClick={() => void addToSetList()}
          >
            {listed.place
              ? `In the set list #${listed.place}`
              : 'Add to set list'}
          </Button>
          <Button
            variant="outline"
            disabled={!copyable || unit.busy || !unit.connected}
            onClick={() => {
              void unit.makeCopy(item).then((ok) => ok && onClose());
            }}
          >
            Make my copy
          </Button>
        </DialogFooter>
        {!copyable && state.kind !== 'loading' && (
          <p className="caption">
            Install what it needs first; then it can join the set list or be
            copied.
          </p>
        )}
        {setList && (
          <p className="caption" role="status">
            {setList}
          </p>
        )}
      </div>
    </AdjustmentDialog>
  );
}

/** Where a built Oxidal sound sits in the set list (0 when it is not in it). */
function useSetListPlace(revision: string | undefined) {
  const [place, set] = useState(0);
  useEffect(() => {
    if (!revision) return;
    let alive = true;
    void libraryCatalog()
      .then((catalog) => {
        if (alive)
          set(
            catalog.items
              .filter((i) => i.in_set_list)
              .findIndex((i) => i.kind === 'rig' && i.id === revision) + 1,
          );
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [revision]);
  return { place, set };
}
