import { useEffect, useState } from 'react';
import { AdjustmentDialog } from '../../../AdjustmentDialog';
import { libraryCatalog } from '../../../api';
import { friendlyError } from '../../../lib/friendlyError';
import { setListMember } from '../setList';
import { factoryTopologySummary } from '../../../factoryRecipes';
import { Button } from '../../../components/ui/button';
import { DialogFooter } from '../../../components/ui/dialog';
import {
  chainNames,
  complexityLabel,
  engineLabel,
  loadEstimate,
  sceneGuide,
  type CardState,
  type SoundItem,
} from './oxidalSounds.model';
import { cardLine, primaryFor, type CardHandlers } from './cardActions';
import type { OxidalSounds } from './useOxidalSounds';
import './oxidal.css';

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
  const listed = useSetListPlace(item.built?.revision);
  const [setList, setSetList] = useState('');
  const [adding, setAdding] = useState(false);
  async function addToSetList() {
    const revision = item.built?.revision;
    if (!revision) return;
    setAdding(true);
    setSetList('');
    try {
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
          <dd>{needs}</dd>
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
            disabled={
              state.kind !== 'ready' ||
              !item.built ||
              !!listed.place ||
              adding ||
              !unit.connected
            }
            title={
              state.kind !== 'ready' || !item.built
                ? 'Build it first'
                : undefined
            }
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
