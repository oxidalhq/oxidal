import {
  ArrowRight,
  ArrowsClockwise,
  ArrowsSplit,
  CaretLeft,
  CaretRight,
  Info,
  Stack,
} from '@phosphor-icons/react';
import { useContext, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { Button } from '@oxidal/design-system/components/button';
import { Loading } from '@oxidal/design-system/components/states';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@oxidal/design-system/components/tabs';
import { Caption, Title } from '@oxidal/design-system/components/text';
import { useVerticalRig } from '@oxidal/design-system/lib/use-media';
import { BarSlotContext } from '@oxidal/design-system/patterns/dock-context';
import { ArtworkMosaic } from '@oxidal/design-system/widgets/artwork-mosaic';
import {
  PresetNameButton,
  PresetSteps,
} from '@oxidal/design-system/widgets/preset-steps';

import { AdjustmentDialog } from './AdjustmentDialog';
import { artworkPath, presetArtwork } from './api';
import { CueLinkedMix } from './components/media/SongLinkControls';
import type { FactoryRecipe } from './factoryRecipes';
import { LibrarySearch } from './features/library/LibrarySearch';
import { builtName } from './features/library/oxidal/oxidalSounds.model';
import {
  saveReadySound,
  unsavedReadySounds,
} from './features/library/oxidal/readySounds';
import type { AudioPhase } from './generated/contract';
import { friendlyError } from './lib/friendlyError';
import { useSessionState } from './lib/sessionState';
import {
  choiceKey as key,
  choiceSource,
  choiceSummary,
  loadPresetChoices,
  type PresetChoice as Choice,
} from './presetChoices';
import { PresetDetailsDialog } from './PresetDetails';
import { PresetManagement } from './PresetManagement';
import { detailsMatch } from './presetMetadata';

type Source = Choice['origin'] | 'setlist';
const SOURCES: [Source, string][] = [
  ['setlist', 'Set list'],
  ['mine', 'Mine'],
  ['oxidal_example', 'Oxidal sounds'],
  ['tone3000', 'TONE3000'],
];

/** One preset picker for every engine: the playing name opens a searchable list
 * of all presets, those with scenes first; a row plays it. Scenes are switched
 * by the pads under it, never from this list.
 * The active editor handles unsaved edits before accepting a recall.
 * @see docs/audio.md
 */
export function RigPresetSelector({
  current: playing,
  phase,
  disabled,
  onSelect,
  heading = false,
  pads = false,
  all = false,
}: {
  phase?: AudioPhase;
  heading?: boolean;
  pads?: boolean;
  /** With pads: every preset on one scrolling page, with the steps first. */
  all?: boolean;
  /** The playing preset: its list key ('' for a draft), name and edit state. */
  current: {
    key: string;
    name: string | null | undefined;
    modified: boolean;
    /** Changes when the list may have changed, such as after a save. */
    refresh?: unknown;
  };
  disabled: boolean;
  onSelect: (choice: Choice) => void;
}) {
  // In the floating capsule the heading is compact: name and ‹ › at the
  // capsule's height; the rest of the picker goes in the opened capsule.
  const slots = useContext(BarSlotContext);
  const phone = useVerticalRig();
  const inCapsule = heading && !!slots?.capsule;
  const [bank, setBank] = useState<number | null>(null);
  const [items, setItems] = useState<Choice[]>([]);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [preview, setPreview] = useState<Choice | null>(null);
  /** Oxidal sounds ready on this unit but not saved yet: saved when chosen. */
  const [unsaved, setUnsaved] = useState<FactoryRecipe[]>([]);
  const [saving, setSaving] = useState<string | null>(null);
  const [saveError, setSaveError] = useState('');
  useEffect(() => {
    if (pads || !open) return;
    let active = true;
    void unsavedReadySounds().then(
      (found) => {
        if (active) setUnsaved(found);
      },
      () => {},
    );
    return () => {
      active = false;
    };
  }, [pads, open, refresh]);
  // The playing row is scrolled into view once each time the list opens;
  // the rig view redraws constantly, and scrolling on every redraw would
  // pull the list back while the player scrolls it.
  const revealed = useRef(false);
  useEffect(() => {
    if (!open) revealed.current = false;
  }, [open]);
  // The chooser's source tab, kept for this browser tab (7.27).
  const [source, setSource] = useSessionState<Source | null>(
    'preset-chooser-source',
    null,
  );
  useEffect(() => {
    let active = true;
    void loadPresetChoices()
      .then((loaded) => {
        if (!active) return;
        setItems(loaded.items);
        setError(loaded.error);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [refresh, playing.refresh]);
  const [lastRunning, setLastRunning] = useState<{
    key: string;
    name?: string | null;
  } | null>(null);
  if (
    phase === 'running' &&
    (lastRunning?.key !== playing.key || lastRunning.name !== playing.name)
  ) {
    setLastRunning({ key: playing.key, name: playing.name });
  }
  const preparing = phase === 'starting';
  const unconfirmed = preparing || phase === 'failed';
  const displayed = unconfirmed && lastRunning ? lastRunning : playing;
  const selected = displayed.key;
  const sounding = phase === undefined || phase === 'running';
  /** The Library set list, in its order. */
  const setList = items.filter((item) => item.inSetList);
  const inSource = (item: Choice, source: Source) =>
    source === 'setlist' ? !!item.inSetList : item.origin === source;
  // Pads step through the set list; with none yet, through Mine.
  const pickerItems = pads
    ? setList.length
      ? setList
      : items.filter((item) => item.origin === 'mine')
    : items;
  const index = pickerItems.findIndex((p) => key(p) === selected);
  const active = items.find((item) => key(item) === selected);
  const backingPreset =
    active?.kind === 'scenes'
      ? { kind: 'rig' as const, id: active.revision }
      : active?.owned
        ? { kind: 'owned' as const, id: active.id }
        : null;
  const size = all ? Math.max(pickerItems.length, 8) : 8;
  const currentBank = Math.min(
    Math.max(0, Math.ceil(pickerItems.length / size) - 1),
    bank ?? Math.max(0, Math.floor(index / size)),
  );
  function choose(item: Choice | undefined) {
    if (item && !disabled && !loading) onSelect(item);
  }
  /** Save a ready Oxidal sound, then play it like any saved preset. */
  async function saveAndChoose(recipe: FactoryRecipe) {
    if (disabled || saving) return;
    setSaving(recipe.id);
    setSaveError('');
    try {
      const revision = await saveReadySound(recipe);
      setOpen(false);
      onSelect({
        kind: 'scenes',
        revision,
        name: builtName(recipe),
        scenes: recipe.scenes.map((scene) => scene.name),
        topology: recipe.topology === 'serial' ? 'serial' : 'scenes',
        nativeInstances: 0,
        lv2Instances: 0,
        origin: 'oxidal_example',
      });
      setRefresh((v) => v + 1);
    } catch (cause) {
      setSaveError(friendlyError(cause, `save ${recipe.name}`));
    } finally {
      setSaving(null);
    }
  }
  if (pads) {
    const previous = index > 0 ? pickerItems[index - 1] : undefined;
    const next = index >= 0 ? pickerItems[index + 1] : undefined;
    const steps = (
      <div className="grid min-w-0 grid-cols-2 gap-2">
        <Button
          variant="outline"
          className="grid h-auto min-h-14 min-w-0 justify-start gap-0.5 text-left whitespace-normal [&>span]:text-xs [&>strong]:line-clamp-2"
          type="button"
          aria-label={
            previous ? `Previous preset: ${previous.name}` : 'Previous preset'
          }
          disabled={disabled || loading || !previous}
          onClick={() => choose(previous)}
        >
          <span>‹ Previous</span>
          <strong>{previous?.name ?? '—'}</strong>
        </Button>
        <Button
          variant="outline"
          className="grid h-auto min-h-14 min-w-0 justify-start gap-0.5 text-left whitespace-normal [&>span]:text-xs [&>strong]:line-clamp-2"
          type="button"
          aria-label={next ? `Next preset: ${next.name}` : 'Next preset'}
          disabled={disabled || loading || !next}
          onClick={() => choose(next)}
        >
          <span>Next ›</span>
          <strong>{next?.name ?? '—'}</strong>
        </Button>
      </div>
    );
    return (
      <div className="grid min-w-0 gap-3" aria-label="Preset pads">
        <h3 className="m-0 flex flex-wrap items-baseline justify-between gap-2 font-semibold [&>span]:font-mono [&>span]:text-xs [&>span]:font-medium">
          Presets
          <span>
            {pickerItems.length
              ? `${currentBank * size + 1}–${Math.min(pickerItems.length, currentBank * size + size)} of ${pickerItems.length}`
              : ''}
          </span>
        </h3>
        {all && steps}
        {backingPreset && active?.inSetList && (
          <CueLinkedMix
            preset={backingPreset}
            scope="set_list"
            disabled={disabled}
          />
        )}
        <div className="grid min-w-0 grid-cols-2 gap-2 md:grid-cols-4">
          {pickerItems
            .slice(currentBank * size, currentBank * size + size)
            .map((item, offset) => {
              const playingPad = sounding && key(item) === selected;
              const upcoming = !!next && key(item) === key(next);
              return (
                <Button
                  type="button"
                  key={key(item)}
                  variant={playingPad ? 'default' : 'outline'}
                  className="h-auto min-h-20 min-w-0 items-start justify-start gap-2 text-left whitespace-normal aria-pressed:disabled:opacity-100 data-[next]:border-dashed"
                  data-next={upcoming || undefined}
                  aria-pressed={playingPad}
                  disabled={disabled || loading || playingPad}
                  onClick={() => choose(item)}
                >
                  <span className="shrink-0 font-mono text-xs tabular-nums opacity-75">
                    {currentBank * size + offset + 1}
                  </span>
                  <span className="grid min-w-0 gap-1 break-words">
                    <strong data-slot="preset-pad-name">{item.name}</strong>
                    <span className="text-xs font-normal opacity-80">
                      {playingPad
                        ? 'Playing'
                        : upcoming
                          ? 'Next'
                          : choiceSummary(item)}
                    </span>
                  </span>
                </Button>
              );
            })}
        </div>
        {pickerItems.length > size && (
          <div className="flex items-center justify-center gap-3 font-mono text-sm tabular-nums">
            <Button
              variant="outline"
              size="icon"
              type="button"
              aria-label="Previous bank"
              disabled={currentBank === 0 || disabled}
              onClick={() => setBank(currentBank - 1)}
            >
              <CaretLeft aria-hidden="true" />
            </Button>
            <span>
              {currentBank + 1} / {Math.ceil(pickerItems.length / size)}
            </span>
            <Button
              variant="outline"
              size="icon"
              type="button"
              aria-label="Next bank"
              disabled={
                (currentBank + 1) * size >= pickerItems.length || disabled
              }
              onClick={() => setBank(currentBank + 1)}
            >
              <CaretRight aria-hidden="true" />
            </Button>
          </div>
        )}
        {!all && steps}
        {loading && <Loading label="Loading presets…" />}
        {error && (
          <div role="status">
            {error}
            <Button
              variant="ghost"
              onClick={() => {
                setLoading(true);
                setRefresh((v) => v + 1);
              }}
            >
              Retry presets
            </Button>
          </div>
        )}
        {!loading && !error && !pickerItems.length && (
          <p>No presets in the set list or Mine yet. Add one from Library.</p>
        )}
        <Caption>
          Changing presets can briefly interrupt audio. Scenes switch within the
          loaded rig.
        </Caption>
      </div>
    );
  }
  const current = pickerItems[index];
  const name =
    current?.name ??
    displayed.name ??
    (loading ? 'Loading presets…' : 'Unsaved preset');
  /** Set-list number (1-based) of a preset, or 0 when it is not in the set list. */
  const number = (item: Choice | undefined) =>
    item ? setList.findIndex((p) => key(p) === key(item)) + 1 : 0;
  const playingNumber = number(current);
  const found = query.trim().toLowerCase();
  const foundItems = items.filter((item) =>
    detailsMatch(item.name, item.details, found),
  );
  const shownSource: Source =
    source ??
    (current?.inSetList
      ? 'setlist'
      : (current?.origin ?? (setList.length ? 'setlist' : 'mine')));
  const unsavedShown = found
    ? unsaved.filter((r) =>
        `${r.name} ${r.description}`.toLowerCase().includes(found),
      )
    : shownSource === 'oxidal_example'
      ? unsaved
      : [];
  const shown = found
    ? foundItems
    : shownSource === 'setlist'
      ? setList
      : items.filter((item) => inSource(item, shownSource));
  // Step in set-list order for members, or within the playing preset's source.
  const neighbours = current?.inSetList
    ? setList
    : items.filter((item) => item.origin === (current?.origin ?? 'mine'));
  const cursor = neighbours.findIndex((item) => key(item) === selected);
  const previous = cursor > 0 ? neighbours[cursor - 1] : undefined;
  const next = neighbours[cursor + 1];
  const entryOf = (item: Choice) => ({
    kind:
      item.kind === 'scenes'
        ? ('rig' as const)
        : item.owned
          ? ('owned' as const)
          : ('original' as const),
    id: item.kind === 'scenes' ? item.revision : item.id,
    name: item.name,
  });
  const nameButton = (
    <PresetNameButton
      name={name}
      label={
        unconfirmed
          ? lastRunning
            ? 'Last playing preset'
            : preparing
              ? 'Preparing preset'
              : 'Unavailable preset'
          : phase === 'stopped'
            ? 'Choose preset to play'
            : undefined
      }
      className={
        inCapsule
          ? 'inline-flex min-h-control-xs max-w-[20rem] min-w-0 items-center gap-1.5 rounded-lg px-1.5 font-serif text-lg font-semibold hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50 max-md:text-base [@media(pointer:coarse)]:min-h-touch'
          : heading
            ? 'inline-flex min-h-control max-w-full items-center gap-2 [@media(pointer:coarse)]:min-h-touch'
            : 'inline-flex min-h-control min-w-0 items-center gap-2 border-b border-foreground text-left focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50 min-[760px]:border-0 [&_svg]:size-5 [@media(pointer:coarse)]:min-h-touch'
      }
      disabled={disabled || preparing || (loading && !items.length)}
      onOpen={() => {
        setQuery('');
        setOpen(true);
      }}
    >
      {heading ? (
        <span className="truncate">
          {/* A phone's capsule keeps the room for the sound's own name. */}
          {inCapsule && name.startsWith('Oxidal · ') ? (
            <>
              <span className="max-sm:hidden">Oxidal · </span>
              {name.slice('Oxidal · '.length)}
            </>
          ) : (
            name
          )}
        </span>
      ) : (
        <>
          {playingNumber > 0 && (
            <span className="min-w-[2ch] shrink-0 text-center font-mono text-sm tabular-nums">
              {playingNumber}
            </span>
          )}{' '}
          <span className="grid min-w-0 flex-1">
            <span className="flex min-w-0 items-baseline gap-2 font-display text-xl font-semibold">
              <span className="truncate">{name}</span>{' '}
              {playing.modified && (
                <span className="inline-flex items-center gap-1 text-sm font-medium text-brand">
                  <span
                    className="size-2 rounded-full bg-brand"
                    aria-hidden="true"
                    title="This playing sound has unsaved edits"
                  />
                  edited
                </span>
              )}
            </span>{' '}
            <span className="truncate text-sm text-muted-foreground">
              {unconfirmed
                ? preparing
                  ? 'Preparing sound…'
                  : 'Audio failed'
                : current
                  ? choiceSummary(current)
                  : selected
                    ? phase === 'stopped'
                      ? 'Remembered preset'
                      : 'Device preset'
                    : 'Not saved yet'}
              {playingNumber > 0
                ? ` · Set list ${playingNumber} of ${setList.length}`
                : current
                  ? ` · ${choiceSource(current)}`
                  : ''}
            </span>
          </span>
        </>
      )}
    </PresetNameButton>
  );
  // The picker and the details open the same way from the capsule and the page.
  const dialogs = (
    <>
      {preview && (
        <PresetDetailsDialog
          entry={entryOf(preview)}
          onCancel={() => setPreview(null)}
        >
          {current && key(preview) === key(current) && (
            <PresetManagement
              entry={entryOf(current)}
              disabled={disabled}
              label="Manage preset"
              onChanged={() => setRefresh((v) => v + 1)}
            />
          )}
        </PresetDetailsDialog>
      )}
      {open && !preview && (
        <AdjustmentDialog
          title="Choose a preset"
          // Room for each preset's picture, name and contents on a laptop.
          className="sm:max-w-2xl"
          onCancel={() => setOpen(false)}
        >
          <LibrarySearch
            label="Find a preset"
            clearLabel="Clear preset search"
            placeholder="Find a preset or sound…"
            value={query}
            onChange={setQuery}
          />

          <Tabs
            value={shownSource}
            onValueChange={(id) => setSource(id as Source)}
          >
            {!found && (
              <TabsList aria-label="Preset source">
                {SOURCES.map(([origin, label]) => (
                  <TabsTrigger key={origin} value={origin}>
                    {label}{' '}
                    <span className="font-mono text-xs tabular-nums">
                      {items.filter((item) => inSource(item, origin)).length +
                        (origin === 'oxidal_example' ? unsaved.length : 0)}
                    </span>
                  </TabsTrigger>
                ))}
              </TabsList>
            )}
            <TabsContent
              value={shownSource}
              {...(found
                ? {
                    role: 'region',
                    'aria-label': 'Matching presets',
                    'aria-labelledby': undefined,
                  }
                : {})}
            >
              {/* One height for every tab, so switching tabs never resizes the
                  chooser; the list scrolls inside it. */}
              <div className="h-[min(28rem,55dvh)] overflow-y-auto overscroll-contain">
                <ul
                  className="grid min-w-0 list-none border-t border-border p-0"
                  aria-label={
                    found
                      ? 'Matching presets'
                      : (SOURCES.find(([o]) => o === shownSource)?.[1] ?? '')
                  }
                >
                  {shown.map((p) => {
                    const currentRow = key(p) === selected;
                    const playingRow = sounding && currentRow;
                    const n = number(p);
                    return (
                      <li
                        key={key(p)}
                        className="flex min-w-0 items-center gap-2 border-b border-border"
                      >
                        <span
                          className="min-w-[2ch] shrink-0 text-center font-mono text-sm tabular-nums"
                          aria-hidden="true"
                        >
                          {n || ''}
                        </span>
                        <PresetThumb choice={p} />
                        <Button
                          variant={playingRow ? 'default' : 'ghost'}
                          className="grid h-auto min-w-0 flex-1 grid-cols-[minmax(0,1fr)] justify-stretch justify-items-start gap-1 p-2 text-left whitespace-normal [&>span:first-child]:w-full [&>span:first-child]:break-words"
                          data-preset={key(p)}
                          aria-pressed={playingRow}
                          disabled={disabled || loading}
                          ref={(element) => {
                            if (currentRow && element && !revealed.current) {
                              revealed.current = true;
                              element.scrollIntoView({ block: 'center' });
                            }
                          }}
                          onClick={() => {
                            setOpen(false);
                            if (!playingRow) choose(p);
                          }}
                        >
                          <span>{p.name}</span>
                          <span
                            className={
                              playingRow
                                ? 'text-xs font-medium'
                                : 'text-xs text-muted-foreground'
                            }
                          >
                            {playingRow ? 'Playing · ' : ''}
                            {choiceSummary(p)}
                            {found && ` · ${choiceSource(p)}`}
                          </span>
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="shrink-0"
                          aria-label={`Details: ${p.name}`}
                          title="Details"
                          onClick={() => setPreview(p)}
                        >
                          <Info aria-hidden="true" />
                        </Button>
                      </li>
                    );
                  })}
                  {unsavedShown.map((recipe) => (
                    <li
                      key={`unsaved:${recipe.id}`}
                      className="flex min-w-0 items-center gap-2 border-b border-border"
                    >
                      <span
                        className="min-w-[2ch] shrink-0 text-center font-mono text-sm tabular-nums"
                        aria-hidden="true"
                      />
                      <Button
                        variant="ghost"
                        className="grid h-auto min-w-0 flex-1 grid-cols-[minmax(0,1fr)] justify-stretch justify-items-start gap-1 p-2 text-left whitespace-normal [&>span:first-child]:w-full [&>span:first-child]:break-words"
                        data-preset={`unsaved:${recipe.id}`}
                        disabled={disabled || loading || !!saving}
                        onClick={() => void saveAndChoose(recipe)}
                      >
                        <span>{builtName(recipe)}</span>
                        <span className="text-xs text-wrap text-muted-foreground">
                          {saving === recipe.id
                            ? 'Saving…'
                            : `${recipe.scenes.length} scenes · saved when chosen`}
                          {found && ' · Oxidal sounds'}
                        </span>
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            </TabsContent>
          </Tabs>
          {saveError && <p role="alert">{saveError}</p>}
          {!loading && !shown.length && !unsavedShown.length && (
            <p role="status">
              {found ? 'No presets match.' : 'Nothing here yet.'}
            </p>
          )}
          <Caption>
            Oxidal and TONE3000 presets open as they are; editing one saves a
            copy to your set list.
          </Caption>
        </AdjustmentDialog>
      )}
    </>
  );
  if (inCapsule)
    return (
      <div className="flex min-w-0 items-center" aria-label="Preset navigation">
        {/* The page's heading is the playing preset, as before the capsule. */}
        <h2 className="sr-only">{name}</h2>
        {/* As C2 draws it: ‹ name ⌄ ›. Unsaved edits show on the chain bar
            (its change count and Edited/Saved); a screen reader still hears it. */}
        <PresetSteps
          size="xs"
          only="previous"
          previous={previous?.name}
          next={next?.name}
          disabled={disabled || loading || preparing}
          onStep={(direction) => choose(direction < 0 ? previous : next)}
        />
        {nameButton}
        {playing.modified && <span className="sr-only">Edited</span>}
        <PresetSteps
          size="xs"
          only="next"
          previous={previous?.name}
          next={next?.name}
          disabled={disabled || loading || preparing}
          onStep={(direction) => choose(direction < 0 ? previous : next)}
        />
        {error &&
          (() => {
            const retry = (
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label="Retry presets"
                title={error}
                onClick={() => {
                  setLoading(true);
                  setRefresh((v) => v + 1);
                }}
              >
                <ArrowsClockwise aria-hidden="true" />
              </Button>
            );
            // A phone's capsule keeps the room for the name: Retry waits in
            // the opened capsule's tray.
            return phone && slots?.extras
              ? createPortal(retry, slots.extras)
              : retry;
          })()}
        {backingPreset &&
          slots?.extras &&
          createPortal(
            <CueLinkedMix
              preset={backingPreset}
              scope="rig"
              disabled={disabled}
            />,
            slots.extras,
          )}
        {dialogs}
      </div>
    );
  return (
    <div
      className={
        heading
          ? 'flex min-w-0 flex-wrap items-center gap-2'
          : 'grid min-w-0 gap-1'
      }
      aria-label="Preset navigation"
    >
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-1">
        {heading ? (
          <Title size="md" className="truncate" aria-label={name}>
            {nameButton}
          </Title>
        ) : (
          nameButton
        )}
        <PresetSteps
          previous={previous?.name}
          next={next?.name}
          disabled={disabled || loading || preparing}
          onStep={(direction) => choose(direction < 0 ? previous : next)}
        />
      </div>
      {heading && playing.modified && (
        <span className="text-xs text-brand">Edited</span>
      )}
      {backingPreset && (
        <CueLinkedMix preset={backingPreset} scope="rig" disabled={disabled} />
      )}
      {error && (
        <div
          className="col-span-full flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground"
          role="status"
        >
          <span>{error}</span>
          <Button
            variant="ghost"
            onClick={() => {
              setLoading(true);
              setRefresh((v) => v + 1);
            }}
          >
            <ArrowsClockwise aria-hidden="true" /> Retry presets
          </Button>
        </div>
      )}
      {dialogs}
    </div>
  );
}

/**
 * A chooser row's picture: a TONE3000 preset's model pictures as a small
 * mosaic, or for a preset with scenes or paths a glyph of how it is built.
 */
function PresetThumb({ choice }: { choice: Choice }) {
  const [art, setArt] = useState<{ src: string; title: string }[]>([]);
  const toneId = choice.kind === 'tone3000' ? choice.id : null;
  const owned = choice.kind === 'tone3000' && choice.owned;
  useEffect(() => {
    if (!toneId) return;
    const abort = new AbortController();
    presetArtwork(toneId, owned, abort.signal).then(
      (items) =>
        setArt(
          items
            .filter((item) => item.cached && item.key)
            .map((item) => ({
              src: artworkPath(toneId, owned, item.key!),
              title: `${item.title} · ${item.gear}`,
            })),
        ),
      () => {},
    );
    return () => abort.abort();
  }, [toneId, owned]);
  const Glyph =
    choice.kind === 'scenes'
      ? choice.topology === 'scenes'
        ? Stack
        : choice.topology === 'parallel'
          ? ArrowsSplit
          : ArrowRight
      : null;
  return (
    <span
      aria-hidden={!art.length || undefined}
      className="relative grid size-11 shrink-0 place-items-center overflow-hidden rounded-md border border-border bg-card text-muted-foreground [&_svg]:size-5"
    >
      {art.length ? (
        <ArtworkMosaic sources={art} />
      ) : Glyph ? (
        <Glyph />
      ) : (
        <span className="font-display text-lg font-semibold">
          {choice.name.slice(0, 1)}
        </span>
      )}
    </span>
  );
}
