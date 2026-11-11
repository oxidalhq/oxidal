import { AdjustmentDialog } from '../../../AdjustmentDialog';
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

/** Why Add to set list is off: the set list API arrives with a later change. */
const SET_LIST_NOTE =
  'Adding an Oxidal sound to the set list is not available yet. Make my copy puts it in Mine.';

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
          <Button variant="outline" disabled title={SET_LIST_NOTE}>
            Add to set list
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
        <p className="caption">{SET_LIST_NOTE}</p>
      </div>
    </AdjustmentDialog>
  );
}
