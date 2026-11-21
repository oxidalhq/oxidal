import { ArrowsClockwise, CaretLeft, CaretRight } from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';

import { Button } from '@oxidal/design-system/components/button';
import { Loading } from '@oxidal/design-system/components/states';
import {
  PresetNameButton,
  PresetSteps,
} from '@oxidal/design-system/widgets/preset-steps';

import './PresetPicker.css';
import { AdjustmentDialog } from './AdjustmentDialog';
import { CueLinkedMix } from './components/media/SongLinkControls';
import type { FactoryRecipe } from './factoryRecipes';
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
 * Edits stay with each preset (verified B4), so recall needs no guard prompt.
 * @see docs/audio.md
 */
export function RigPresetSelector({
  current: playing,
  phase,
  disabled,
  onSelect,
  pads = false,
  all = false,
}: {
  phase?: AudioPhase;
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
  useEffect(() => {
    if (phase === 'running')
      setLastRunning({ key: playing.key, name: playing.name });
  }, [phase, playing.key, playing.name]);
  const preparing = phase === 'starting';
  const unconfirmed = preparing || phase === 'failed';
  const displayed = unconfirmed && lastRunning ? lastRunning : playing;
  const selected = displayed.key;
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
      <div className="preset-step">
        <button
          type="button"
          aria-label={
            previous ? `Previous preset: ${previous.name}` : 'Previous preset'
          }
          disabled={disabled || loading || !previous}
          onClick={() => choose(previous)}
        >
          <span>‹ Previous</span>
          <strong>{previous?.name ?? '—'}</strong>
        </button>
        <button
          type="button"
          aria-label={next ? `Next preset: ${next.name}` : 'Next preset'}
          disabled={disabled || loading || !next}
          onClick={() => choose(next)}
        >
          <span>Next ›</span>
          <strong>{next?.name ?? '—'}</strong>
        </button>
      </div>
    );
    return (
      <div className="preset-pads" aria-label="Preset pads">
        <h3>
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
        <div className="preset-pad-grid">
          {pickerItems
            .slice(currentBank * size, currentBank * size + size)
            .map((item, offset) => {
              const sounding = key(item) === selected;
              const upcoming = !!next && key(item) === key(next);
              return (
                <button
                  type="button"
                  key={key(item)}
                  className="preset-pad"
                  data-next={upcoming || undefined}
                  aria-pressed={sounding}
                  disabled={disabled || loading || sounding}
                  onClick={() => choose(item)}
                >
                  <span className="preset-pad-number">
                    {currentBank * size + offset + 1}
                  </span>
                  <span className="preset-pad-text">
                    <strong>{item.name}</strong>
                    <span className="preset-pad-origin">
                      {sounding
                        ? 'Playing'
                        : upcoming
                          ? 'Next'
                          : choiceSummary(item)}
                    </span>
                  </span>
                </button>
              );
            })}
        </div>
        {pickerItems.length > size && (
          <div className="preset-bank">
            <button
              type="button"
              aria-label="Previous bank"
              disabled={currentBank === 0 || disabled}
              onClick={() => setBank(currentBank - 1)}
            >
              <CaretLeft aria-hidden="true" />
            </button>
            <span>
              {currentBank + 1} / {Math.ceil(pickerItems.length / size)}
            </span>
            <button
              type="button"
              aria-label="Next bank"
              disabled={
                (currentBank + 1) * size >= pickerItems.length || disabled
              }
              onClick={() => setBank(currentBank + 1)}
            >
              <CaretRight aria-hidden="true" />
            </button>
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
        <p className="caption">
          Changing preset briefly interrupts audio; changing scene never does.
        </p>
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
  return (
    <div className="preset-picker" aria-label="Preset navigation">
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-1">
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
          className="preset-picker-name"
          disabled={disabled || preparing || (loading && !items.length)}
          onOpen={() => {
            setQuery('');
            setOpen(true);
          }}
        >
          {playingNumber > 0 && (
            <span className="preset-picker-number" aria-hidden="true">
              {playingNumber}
            </span>
          )}
          <span className="preset-picker-text">
            <span className="preset-picker-title">
              <span className="preset-picker-label">{name}</span>
              {playing.modified && (
                <span className="preset-picker-edited">
                  <span
                    className="preset-modified"
                    role="img"
                    aria-label="Modified preset"
                    title="This playing sound has unsaved edits"
                  />
                  edited
                </span>
              )}
            </span>
            <span className="preset-picker-meta">
              {unconfirmed
                ? preparing
                  ? 'Preparing sound…'
                  : 'Audio failed'
                : current
                  ? choiceSummary(current)
                  : 'Not saved yet'}
              {playingNumber > 0
                ? ` · Set list ${playingNumber} of ${setList.length}`
                : current
                  ? ` · ${choiceSource(current)}`
                  : ''}
            </span>
          </span>
        </PresetNameButton>
        <PresetSteps
          previous={previous?.name}
          next={next?.name}
          disabled={disabled || loading || preparing}
          onStep={(direction) => choose(direction < 0 ? previous : next)}
        />
      </div>
      {backingPreset && (
        <CueLinkedMix preset={backingPreset} scope="rig" disabled={disabled} />
      )}
      {error && (
        <div className="rig-preset-error" role="status">
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
          className="preset-picker-dialog"
          onCancel={() => setOpen(false)}
        >
          <input
            type="search"
            className="preset-picker-search"
            aria-label="Find a preset"
            placeholder="Find a preset or sound…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {!found && (
            <div
              className="preset-picker-sources"
              role="tablist"
              aria-label="Preset source"
            >
              {SOURCES.map(([origin, label]) => (
                <button
                  key={origin}
                  type="button"
                  role="tab"
                  aria-selected={shownSource === origin}
                  onClick={() => setSource(origin)}
                >
                  {label}{' '}
                  <span className="preset-picker-count">
                    {items.filter((item) => inSource(item, origin)).length +
                      (origin === 'oxidal_example' ? unsaved.length : 0)}
                  </span>
                </button>
              ))}
            </div>
          )}
          <ul
            className="preset-picker-group"
            aria-label={
              found
                ? 'Matching presets'
                : (SOURCES.find(([o]) => o === shownSource)?.[1] ?? '')
            }
          >
            {shown.map((p) => {
              const playingRow = key(p) === selected;
              const n = number(p);
              return (
                <li key={key(p)} className="preset-picker-entry">
                  <span className="preset-picker-number" aria-hidden="true">
                    {n || ''}
                  </span>
                  <button
                    type="button"
                    className="preset-picker-row"
                    data-preset={key(p)}
                    aria-pressed={playingRow}
                    disabled={disabled || loading}
                    ref={(element) => {
                      if (playingRow && element && !revealed.current) {
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
                          ? 'preset-picker-playing'
                          : 'preset-picker-scenes'
                      }
                    >
                      {playingRow ? 'Playing · ' : ''}
                      {choiceSummary(p)}
                      {found && ` · ${choiceSource(p)}`}
                    </span>
                  </button>
                  <Button
                    variant="ghost"
                    className="shrink-0 px-2"
                    aria-label={`Details: ${p.name}`}
                    onClick={() => setPreview(p)}
                  >
                    Details
                  </Button>
                </li>
              );
            })}
            {unsavedShown.map((recipe) => (
              <li key={`unsaved:${recipe.id}`} className="preset-picker-entry">
                <span className="preset-picker-number" aria-hidden="true" />
                <button
                  type="button"
                  className="preset-picker-row"
                  data-preset={`unsaved:${recipe.id}`}
                  disabled={disabled || loading || !!saving}
                  onClick={() => void saveAndChoose(recipe)}
                >
                  <span>{builtName(recipe)}</span>
                  <span className="preset-picker-scenes">
                    {saving === recipe.id
                      ? 'Saving…'
                      : `${recipe.scenes.length} scenes · saved when chosen`}
                    {found && ' · Oxidal sounds'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {saveError && <p role="alert">{saveError}</p>}
          {!loading && !shown.length && !unsavedShown.length && (
            <p role="status">
              {found ? 'No presets match.' : 'Nothing here yet.'}
            </p>
          )}
          <p className="caption">
            Oxidal and TONE3000 presets open as they are; editing one saves a
            copy to your set list.
          </p>
        </AdjustmentDialog>
      )}
    </div>
  );
}
