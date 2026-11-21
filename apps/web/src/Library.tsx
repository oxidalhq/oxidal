import { MagnifyingGlass, Plus, X } from '@phosphor-icons/react';
import { type ReactNode, useEffect, useRef, useState } from 'react';

import { Button } from '@oxidal/design-system/components/button';
import {
  Segment,
  SegmentedControl,
} from '@oxidal/design-system/components/segmented';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@oxidal/design-system/components/select';
import { StateNotice } from '@oxidal/design-system/components/states';
import { LIBRARY_SECTIONS } from '@oxidal/design-system/patterns/library-sections';
import { Workspace } from '@oxidal/design-system/patterns/workspace';

import './Library.css';
import {
  type AudioState,
  importPreset,
  nativeState,
  playbackState,
  type Preset,
  type PresetDetails,
  presetDetails,
  presetLibrary,
  type VersionSelection,
} from './api';
import { ArtworkDeck } from './AssetArtwork';
import { BackingTracks } from './components/media/BackingTracks';
import { DiReamps } from './components/media/DiReamps';
import { StemSongs } from './components/media/StemSongs';
import { CreatedPreset } from './features/library/CreatedPreset';
import { MineDialogs, type MineTarget } from './features/library/MineDialogs';
import { NewPresetDialog } from './features/library/NewPresetDialog';
import { OfflineEditor } from './features/library/OfflineEditor';
import { OxidalSounds } from './features/library/oxidal';
import { PresetRow } from './features/library/PresetRow';
import { duplicatePreset } from './features/library/setList';
import { Songbook } from './features/library/Songbook';
import { StarterOffer } from './features/library/StarterOffer';
import { GraphAuthor } from './GraphAuthor';
import { friendlyError } from './lib/friendlyError';
import { useSessionState } from './lib/sessionState';
import { LibraryManagement } from './LibraryManagement';
import { requestMidiAssignments } from './midiNavigation';
import { ModelLibrary } from './ModelLibrary';
import { NativeEditor } from './NativeEditor';
import { playTone3000 } from './presetChoices';
import { PresetDetailsDialog } from './PresetDetails';
import { detailsKey, detailsMatch } from './presetMetadata';
import { SavedRigs, type SetListControls } from './SavedRigs';
import {
  replaceWorkspaceLocation,
  useSectionLocation,
  useWorkspaceState,
  WORKSPACE_LOCATION_EVENT,
} from './workspaceMemory';

const sections = LIBRARY_SECTIONS.map(({ id }) => id);
type Section = (typeof sections)[number];
/** Links from before Sprint 12 keep working: they land on the new section. */
const legacySections: Record<string, Section> = {
  presets: 'mine',
  sounds: 'tones',
  discover: 'oxidal',
};
function legacySection(): Section | null {
  const [view = '', id = ''] = window.location.hash.slice(1).split('/');
  return view === 'library' ? (legacySections[id] ?? null) : null;
}
function migrateLegacyHash() {
  const next = legacySection();
  if (!next) return;
  const url = new URL(window.location.href);
  url.hash = `library/${next}`;
  replaceWorkspaceLocation(url);
}

/**
 * Library: two groups. Sounds holds Mine (rigs and your TONE3000 chains in one
 * list), Oxidal sounds, TONE3000, the Set list and Tones and IRs; Media holds
 * Backing tracks, Stems and DI and reamps. Each section has its own link
 * (`#library/tones`); earlier links (`presets`, `sounds`, `discover`) land on
 * the section that replaced them.
 * @see docs/presets/format.md
 */
export function Library({
  connected,
  onOpenRig,
}: {
  connected: boolean;
  onOpenRig: () => void;
}) {
  useState(migrateLegacyHash);
  const [section, setSection] = useSectionLocation<Section>(
    'library',
    sections,
    'mine',
  );
  useEffect(() => {
    const redirect = () => {
      const next = legacySection();
      if (next) setSection(next);
    };
    window.addEventListener(WORKSPACE_LOCATION_EVENT, redirect);
    return () => {
      window.removeEventListener(WORKSPACE_LOCATION_EVENT, redirect);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [refresh, setRefresh] = useState(0);
  // Search survives a reload (this tab), so Mine opens as you left it.
  const [query, setQuery] = useSessionState('library-mine-query', '');
  const [toneQuery, setToneQuery] = useSessionState(
    'library-tone3000-query',
    '',
  );
  const [mineDialog, setMineDialog] = useState<MineTarget | null>(null);
  const [soundFormat, setSoundFormat] = useWorkspaceState<'nam' | 'ir'>(
    'library-sound-format',
    'nam',
  );
  const [composer, setComposer] = useWorkspaceState<
    null | 'effects' | 'tone3000'
  >('library-composer', null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<{
    revision: string;
    selection?: VersionSelection;
  } | null>(null);
  const [created, setCreated] = useState<{
    name: string;
    revision: string;
  } | null>(null);
  const [showArtwork, setShowArtwork] = useState(() => {
    try {
      return localStorage.getItem('oxidal-library-artwork') === 'true';
    } catch {
      return false;
    }
  });
  const [details, setDetails] = useState<Record<string, PresetDetails>>({});
  const [detailsError, setDetailsError] = useState('');
  const [category, setCategory] = useState('');
  const [preview, setPreview] = useState<{
    kind: 'original' | 'owned' | 'rig';
    id: string;
    name: string;
  } | null>(null);
  const matches = (name: string, kind: 'original' | 'owned', id: string) =>
    detailsMatch(
      name,
      details[`${kind}:${id}`],
      kind === 'owned' ? query : toneQuery,
      category,
    );
  const categories = [
    ...new Set(Object.values(details).flatMap((d) => d.categories)),
  ].sort((a, b) => a.localeCompare(b));
  const [presets, setPresets] = useState<Preset[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(true);
  const [importMessage, setImportMessage] = useState('');
  const [importError, setImportError] = useState('');
  const [error, setError] = useState('');
  const [copyMessage, setCopyMessage] = useState('');
  const [copiesError, setCopiesError] = useState('');
  const generation = useRef(0);
  const importing = useRef<AbortController | null>(null);
  const loading = useRef(false);
  const [playing, setPlaying] = useState<AudioState | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [owned, setOwned] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    let active = true;
    void presetDetails()
      .then((c) => {
        if (active) {
          setDetails(
            Object.fromEntries(
              c.entries.map((e) => [detailsKey(e.entry), e.details]),
            ),
          );
          setDetailsError('');
        }
      })
      .catch(() => {
        if (active) setDetailsError('Preset details could not be read.');
      });
    void playbackState()
      .then((s) => {
        if (active) setPlaying(s);
      })
      .catch(() => {});
    void nativeState()
      .then((s) => {
        if (active) {
          setOwned(s.owned.map((p) => ({ id: p.id, name: p.preset.name })));
          setCopiesError('');
        }
      })
      .catch(() => {
        if (active) setCopiesError('Saved copies could not be read.');
      });
    return () => {
      active = false;
    };
  }, [refresh]);
  async function play(id: string, isOwned = false, openMidi = false) {
    if (loading.current) return;
    loading.current = true;
    setLoadingId(id);
    setError('');
    try {
      const next = await playTone3000(id, isOwned);
      setPlaying(next);
      if (openMidi) requestMidiAssignments();
      onOpenRig();
    } catch (cause) {
      setError(friendlyError(cause, 'play this preset'));
      void playbackState()
        .then(setPlaying)
        .catch(() => {});
    } finally {
      loading.current = false;
      setLoadingId(null);
    }
  }
  /** Duplicate a saved TONE3000 chain: "Name copy" in Mine, not in the set list. */
  async function duplicateOwned(id: string) {
    setError('');
    setCopyMessage('');
    try {
      const { copy } = await duplicatePreset({ kind: 'owned', id });
      setCopyMessage(`"${copy.name}" is in Mine. It is not in the set list.`);
      setPresets(await presetLibrary());
    } catch (cause) {
      setError(friendlyError(cause, 'duplicate this preset'));
    }
  }
  function toneRow(
    id: string,
    name: string,
    isOwned: boolean,
    meta: string,
    download: string,
    setList?: SetListControls,
  ) {
    const inSetList = setList?.isMember(id) ?? null;
    const active =
      playing?.phase === 'running' &&
      playing.configured?.preset_id === id &&
      playing.configured.owned === isOwned;
    return (
      <PresetRow
        key={`${isOwned ? 'owned' : 'original'}-${id}`}
        testId={isOwned ? undefined : `preset-${id}`}
        name={name}
        meta={[meta, setList?.label(id)].filter(Boolean).join(' · ')}
        playing={active}
        loading={loadingId === id}
        disabled={!connected || loadingId !== null}
        onPlay={() => void play(id, isOwned)}
        onDetails={() =>
          setPreview({ kind: isOwned ? 'owned' : 'original', id, name })
        }
        actions={[
          {
            label: 'MIDI',
            onSelect: () => void play(id, isOwned, true),
            disabled: !connected || loadingId !== null,
          },
          { label: 'Download', href: download, download: true },
          ...(isOwned
            ? [
                {
                  label: 'Duplicate',
                  onSelect: () => void duplicateOwned(id),
                  disabled: !connected || loadingId !== null,
                },
              ]
            : []),
          ...(setList && inSetList !== null
            ? [
                inSetList
                  ? {
                      label: 'Remove from set list',
                      onSelect: () => setList.toggle(id, name, false),
                      disabled: !connected || setList.disabled,
                    }
                  : {
                      label: 'Add to set list',
                      onSelect: () => setList.toggle(id, name, true),
                      disabled: !connected || setList.disabled,
                    },
              ]
            : []),
          ...(!isOwned
            ? [
                {
                  label: 'Delete…',
                  onSelect: () =>
                    setMineDialog({
                      action: 'delete',
                      kind: 'original',
                      id,
                      name,
                    }),
                  disabled: !connected || loadingId !== null,
                },
              ]
            : []),
          ...(isOwned
            ? [
                {
                  label: 'Rename',
                  onSelect: () =>
                    setMineDialog({
                      action: 'rename',
                      kind: 'owned',
                      id,
                      name,
                    }),
                  disabled: !connected || loadingId !== null,
                },
                {
                  label: 'Delete…',
                  onSelect: () =>
                    setMineDialog({
                      action: 'delete',
                      kind: 'owned',
                      id,
                      name,
                    }),
                  disabled: !connected || loadingId !== null,
                },
              ]
            : []),
        ]}
        extra={showArtwork && <ArtworkDeck id={id} owned={isOwned} />}
      />
    );
  }
  useEffect(() => {
    const lifecycle = generation;
    const request = ++lifecycle.current;
    void presetLibrary()
      .then((items) => {
        if (request !== lifecycle.current) return;
        setPresets(items);
      })
      .catch((cause: unknown) => {
        if (request === lifecycle.current)
          setError(friendlyError(cause, 'read the TONE3000 presets'));
      })
      .finally(() => {
        if (request === lifecycle.current) setBusy(false);
      });
    return () => {
      lifecycle.current++;
    };
  }, [refresh]);
  async function upload() {
    if (!file) return;
    const request = ++generation.current;
    const controller = new AbortController();
    importing.current = controller;
    setBusy(true);
    setImportError('');
    setImportMessage('Importing…');
    try {
      const imported = await importPreset(file, controller.signal);
      const items = await presetLibrary();
      if (request !== generation.current) return;
      setPresets(items);
      setImportMessage(
        `Added ${imported.name} to TONE3000. The original file is kept unchanged.`,
      );
    } catch (cause) {
      if (request === generation.current) {
        // A device that already had the whole file may still finish (7.21).
        setImportError(
          controller.signal.aborted
            ? 'Import stopped. If the device had already received the whole file, the preset may still appear in TONE3000.'
            : friendlyError(cause, 'import the preset'),
        );
        if (controller.signal.aborted)
          void presetLibrary()
            .then((items) => {
              if (request === generation.current) setPresets(items);
            })
            .catch(() => {});
        setImportMessage('');
      }
    } finally {
      if (importing.current === controller) importing.current = null;
      if (request === generation.current) setBusy(false);
    }
  }
  const ownedShown = owned.filter((p) => matches(p.name, 'owned', p.id));
  const originalsShown = presets.filter((p) =>
    matches(p.name, 'original', p.sha256),
  );
  if (composer)
    return (
      <section className="instrument-surface" aria-label="Library">
        <Button variant="ghost" onClick={() => setComposer(null)}>
          ← Back to Library
        </Button>
        {composer === 'effects' ? (
          <GraphAuthor connected={connected} onOpenRig={onOpenRig} />
        ) : (
          <NativeEditor presets={presets} connected={connected} />
        )}
      </section>
    );
  const categorySelect = categories.length > 0 && (
    <Select
      value={category || '__all__'}
      onValueChange={(value) => setCategory(value === '__all__' ? '' : value)}
    >
      <SelectTrigger aria-label="Category" className="w-auto">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__all__">All categories</SelectItem>
        {categories.map((c) => (
          <SelectItem key={c} value={c}>
            {c}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
  const viewToggle = (
    <SegmentedControl
      value={showArtwork ? 'artwork' : 'list'}
      aria-label="Library view"
      onValueChange={(value) => {
        if (!value) return;
        setShowArtwork(value === 'artwork');
        try {
          localStorage.setItem(
            'oxidal-library-artwork',
            String(value === 'artwork'),
          );
        } catch {
          /* storage unavailable */
        }
      }}
    >
      <Segment value="list">List</Segment>
      <Segment value="artwork">Artwork</Segment>
    </SegmentedControl>
  );
  function search(
    value: string,
    set: (value: string) => void,
    placeholder: string,
    extra?: ReactNode,
  ) {
    return (
      <div className="library-search-row">
        <div className="library-search-field">
          <label className="relative block min-w-0">
            <span className="sr-only">Search presets</span>
            <MagnifyingGlass
              aria-hidden="true"
              size={18}
              className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground"
            />
            <input
              type="search"
              className="h-11 w-full min-w-0 rounded-md border border-input bg-card pr-11 pl-10"
              placeholder={placeholder}
              value={value}
              onChange={(event) => set(event.target.value)}
            />
          </label>
          {value && (
            <Button
              variant="ghost"
              className="library-search-clear w-11 px-0"
              aria-label="Clear preset search"
              onClick={() => set('')}
            >
              <X aria-hidden="true" />
            </Button>
          )}
        </div>
        {extra}
      </div>
    );
  }
  return (
    <section className="instrument-surface" aria-label="Library">
      <Workspace
        label="Library"
        className="px-0"
        sections={LIBRARY_SECTIONS.map(({ id, label, icon }) => ({
          id,
          label,
          icon,
        }))}
        current={section}
        showTitle={false}
        onSelect={(id) => {
          if (sections.includes(id as Section)) setSection(id as Section);
        }}
      >
        {detailsError && (
          <StateNotice kind="error" title="Preset details unavailable">
            {detailsError}
          </StateNotice>
        )}
        {error && (
          <StateNotice kind="error" title="Something went wrong">
            {error}
          </StateNotice>
        )}
        {copyMessage && <p role="status">{copyMessage}</p>}
        {preview && (
          <PresetDetailsDialog
            entry={preview}
            onEditVersion={(selection) => {
              setPreview(null);
              setEditing({ revision: selection.expected_content, selection });
            }}
            editable
            onChanged={() => setRefresh((v) => v + 1)}
            onCancel={() => setPreview(null)}
          />
        )}
        <MineDialogs
          target={mineDialog}
          onClose={() => setMineDialog(null)}
          onChanged={() => setRefresh((v) => v + 1)}
        />
        {section === 'mine' && (
          <div>
            <StarterOffer
              connected={connected}
              refresh={refresh}
              onChanged={() => setRefresh((v) => v + 1)}
            />
            {search(
              query,
              setQuery,
              'Find a preset…',
              <Button disabled={!connected} onClick={() => setCreating(true)}>
                <Plus aria-hidden="true" /> New preset
              </Button>,
            )}
            <div className="library-bar">
              <div className="flex flex-wrap items-center gap-2">
                {categorySelect}
                {viewToggle}
              </div>
            </div>
            {created && (
              <CreatedPreset
                key={created.revision}
                {...created}
                connected={connected}
                onOpenRig={onOpenRig}
                onDismiss={() => setCreated(null)}
                onEdit={() => {
                  setEditing({ revision: created.revision });
                  setCreated(null);
                }}
              />
            )}
            {editing && (
              <OfflineEditor
                revision={editing.revision}
                selection={editing.selection}
                connected={connected}
                onCancel={() => setEditing(null)}
                onRefresh={() => {
                  setEditing(null);
                  setRefresh((v) => v + 1);
                }}
                onSaved={() => {
                  setEditing(null);
                  setRefresh((v) => v + 1);
                }}
              />
            )}
            {creating && (
              <NewPresetDialog
                connected={connected}
                onCancel={() => setCreating(false)}
                onAdvanced={(kind) => {
                  setCreating(false);
                  setComposer(kind);
                }}
                onCreated={(created) => {
                  setCreating(false);
                  setRefresh((v) => v + 1);
                  setCreated({
                    name: created.manifest.name,
                    revision: created.revision,
                  });
                }}
              />
            )}
            <SavedRigs
              connected={connected}
              onOpenRig={onOpenRig}
              refresh={refresh}
              query={query}
              category={category}
              details={details}
              origin="mine"
              title="Mine"
              onDetails={(id, name) => setPreview({ kind: 'rig', id, name })}
              onEdit={(revision) => setEditing({ revision })}
              onManage={(action, entry) => setMineDialog({ action, ...entry })}
              tailCount={ownedShown.length}
              tail={(setList) =>
                ownedShown.map((p) =>
                  toneRow(
                    p.id,
                    p.name,
                    true,
                    'TONE3000 chain',
                    `/api/v1/presets/owned/${p.id}/download`,
                    setList,
                  ),
                )
              }
              empty={
                <StateNotice kind="empty" title="No presets yet">
                  Create one with New preset, or start from Oxidal sounds.
                </StateNotice>
              }
            />
            {copiesError && (
              <StateNotice
                kind="error"
                title="Saved copies unavailable"
                action={
                  <Button
                    variant="outline"
                    onClick={() => setRefresh((value) => value + 1)}
                  >
                    Try again
                  </Button>
                }
              >
                {copiesError}
              </StateNotice>
            )}
          </div>
        )}
        {section === 'oxidal' && (
          <div>
            <StarterOffer
              connected={connected}
              refresh={refresh}
              onChanged={() => setRefresh((v) => v + 1)}
            />
            <OxidalSounds
              connected={connected}
              onOpenRig={onOpenRig}
              onChanged={() => setRefresh((v) => v + 1)}
            />
          </div>
        )}
        {section === 'tone3000' && (
          <div>
            {search(
              toneQuery,
              setToneQuery,
              'Find a TONE3000 preset…',
              <>
                {categorySelect}
                {viewToggle}
              </>,
            )}
            <div className="section-heading">
              <h2>TONE3000</h2>
            </div>
            {busy && !presets.length ? (
              <StateNotice kind="loading" title="Reading TONE3000 presets…" />
            ) : !originalsShown.length ? (
              <p role="status" className="caption">
                {toneQuery.trim()
                  ? 'No TONE3000 presets match these filters.'
                  : 'No TONE3000 presets yet. Import a preset file below.'}
              </p>
            ) : (
              <ul className="preset-library">
                {originalsShown.map((preset) =>
                  toneRow(
                    preset.sha256,
                    preset.name,
                    false,
                    `Original · ${preset.block_count} blocks${preset.framing === 'legacy' ? ' · legacy format' : ''}`,
                    `/api/v1/presets/${preset.sha256}/original`,
                  ),
                )}
              </ul>
            )}
            <section className="library-import" aria-label="Import a preset">
              <h2 className="text-base">Import a TONE3000 preset file</h2>
              <p className="caption">
                Importing does not change what is playing. The original file is
                kept unchanged; importing the same file twice keeps one copy. Up
                to 32 MiB.
              </p>
              <div className="form-grid">
                <label className="field">
                  TONE3000 preset file
                  <input
                    type="file"
                    accept=".t3kpreset"
                    disabled={!connected}
                    onChange={(event) =>
                      setFile(event.target.files?.[0] ?? null)
                    }
                  />
                </label>
                <Button
                  disabled={
                    !file || !connected || importMessage === 'Importing…'
                  }
                  onClick={() => void upload()}
                >
                  Import
                </Button>
              </div>
              {importMessage && <p role="status">{importMessage}</p>}
              {importMessage === 'Importing…' && (
                <Button
                  variant="outline"
                  onClick={() => importing.current?.abort()}
                >
                  Cancel import
                </Button>
              )}
              {importError && <p role="alert">{importError}</p>}
            </section>
          </div>
        )}
        {section === 'setlist' && (
          <div>
            <p className="caption">
              The order of presets here is the order MIDI program changes and
              Previous/Next follow. Presets you remove from the list stay in
              Mine and can be restored.
            </p>
            <LibraryManagement
              connected={connected}
              onOpenRig={onOpenRig}
              onChanged={() => setRefresh((v) => v + 1)}
            />
            <details className="control-help">
              <summary>How live switching works</summary>
              <p>
                Presets with scenes or effects load in adjacent groups of four,
                or the presets you choose with Keep ready. Switching inside that
                group, and scene changes, have no gap. Other presets restart
                audio briefly.
              </p>
            </details>
          </div>
        )}
        {section === 'tones' && (
          <div>
            <SegmentedControl
              value={soundFormat}
              aria-label="Sound type"
              className="my-3"
              onValueChange={(value) => {
                if (value === 'nam' || value === 'ir') setSoundFormat(value);
              }}
            >
              <Segment value="nam">NAM captures</Segment>
              <Segment value="ir">Cabinet IRs</Segment>
            </SegmentedControl>
            <ModelLibrary
              key={soundFormat}
              format={soundFormat}
              connected={connected}
              onOpenRig={onOpenRig}
            />
          </div>
        )}
        {section === 'di' && (
          <div>
            <DiReamps connected={connected} />
          </div>
        )}
        {section === 'backing' && (
          <div>
            <BackingTracks connected={connected} />
          </div>
        )}
        {section === 'stems' && (
          <div>
            <StemSongs connected={connected} />
          </div>
        )}
        {section === 'songbook' && (
          <div>
            <Songbook connected={connected} />
          </div>
        )}
      </Workspace>
    </section>
  );
}
