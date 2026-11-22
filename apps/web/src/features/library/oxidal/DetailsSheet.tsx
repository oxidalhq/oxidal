import { useEffect, useState } from 'react';

import { Button } from '@oxidal/design-system/components/button';
import { Card, CardTitle } from '@oxidal/design-system/components/card';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetHeader,
} from '@oxidal/design-system/components/sheet';

import { libraryCatalog } from '../../../api';
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
export function SoundDetails({
  item,
  state,
  unit,
  handlers,
  inline,
  onClose,
}: {
  item: SoundItem;
  state: CardState;
  unit: OxidalSounds;
  handlers: CardHandlers;
  inline: boolean;
  onClose: () => void;
}) {
  const [returnFocus] = useState(
    () => document.activeElement as HTMLElement | null,
  );
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
  const content = (
    <div className="grid min-w-0 gap-3 [overflow-wrap:anywhere]">
      <p className="caption">
        {item.meta.genres.join(' · ')} · {engineLabel(item.meta.engine)} ·{' '}
        {complexityLabel(item.meta.complexity)}
      </p>
      <p>{item.description}</p>
      <div className="action-row flex-wrap">
        {!primary && <Button disabled>Try {item.name}</Button>}
        {primary && (
          <Button
            disabled={primary.disabled}
            onClick={() => {
              if (!inline) onClose();
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
      </div>
      {item.meta.inspiration && <p>{item.meta.inspiration}</p>}
      <section aria-label="How to play it">
        <h3>How to play it</h3>
        {item.meta.performance && <p>{item.meta.performance}</p>}
        <ol className="ml-5 list-decimal">
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
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 [&>dd]:break-words [&>dt]:font-semibold">
        {item.recipe && (
          <>
            <dt>Chain</dt>
            <dd>
              {chainNames(item.recipe).join(' → ')}
              <span className="block text-xs text-muted-foreground">
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
              <ul className="grid list-none gap-1.5 p-0 [&>li]:grid">
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
        <p role="status">Play is not offered: {cardLine(item, state, unit)}</p>
      )}
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
  );
  if (inline)
    return (
      <Card
        aria-label={`About ${item.name}`}
        className="sticky top-4 max-h-[calc(100dvh-6rem)] min-w-0 overflow-auto"
      >
        <CardTitle>{item.name}</CardTitle>
        {content}
      </Card>
    );
  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        onOpenChange={(open) => !open && onClose()}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          returnFocus?.focus({ preventScroll: true });
        }}
      >
        <SheetHeader title={item.name} />
        <SheetBody>{content}</SheetBody>
      </SheetContent>
    </Sheet>
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
