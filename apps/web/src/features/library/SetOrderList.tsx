import { useEffect, useRef, useState } from 'react';

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
import { Label } from '@oxidal/design-system/components/text';
import {
  type Choice,
  SetListEditor,
} from '@oxidal/design-system/widgets/set-list-editor';

import {
  chordSheets,
  type LibraryCatalog,
  libraryCatalog,
  mediaLibrary,
  type OccurrenceEdit,
  presetVersions,
  recallOccurrence,
  rigDocument,
  type SetOrder,
  setOrder,
  songView,
} from '../../api';
import { CueEntryBacking } from '../../components/media/SongLinkControls';
import { friendlyError } from '../../lib/friendlyError';
import { readScenes } from '../../sceneFormat';
import { RehearsalReport } from './RehearsalReport';

type Row = SetOrder['entries'][number];
type Settings = Row['entry']['settings'];
const none = 'none:';
const presetKey = (preset: Pick<Row['entry']['preset'], 'kind' | 'id'>) =>
  `${preset.kind}:${preset.id}`;

function ChoiceField({
  label,
  value,
  choices,
  empty,
  segmented = false,
  onChange,
}: {
  label: string;
  value?: string | null;
  choices: Choice[];
  empty: string;
  segmented?: boolean;
  onChange: (value: string | null) => void;
}) {
  const options = [{ id: none, label: empty }, ...choices];
  if (value && !choices.some((c) => c.id === value))
    options.push({ id: value, label: `Unavailable · ${value}` });
  const choose = (next: string) => onChange(next === none ? null : next);
  return (
    <div className="grid gap-1">
      <Label as="span">{label}</Label>
      {segmented && options.length <= 5 ? (
        <SegmentedControl
          aria-label={label}
          className="flex-wrap"
          value={value ?? none}
          onValueChange={choose}
        >
          {options.map((option) => (
            <Segment
              key={option.id}
              value={option.id}
              className="whitespace-normal"
            >
              {option.label}
            </Segment>
          ))}
        </SegmentedControl>
      ) : (
        <Select value={value ?? none} onValueChange={choose}>
          <SelectTrigger aria-label={label}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {options.map((option) => (
              <SelectItem key={option.id} value={option.id}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}

async function readSheets() {
  const all: Choice[] = [];
  let after: string | undefined;
  do {
    const page = await chordSheets(after);
    all.push(
      ...page.sheets.map((sheet) => ({ id: sheet.id, label: sheet.title })),
    );
    after = page.next ?? undefined;
  } while (after);
  return all;
}

async function readTracks() {
  const { assets } = await mediaLibrary();
  return assets
    .filter((asset) => asset.kind === 'backing')
    .map((asset) => ({ id: asset.id, label: asset.title }));
}

async function startingScenes(content: string) {
  const { manifest } = await rigDocument(content);
  return (
    readScenes<{ scenes: { id: string; name: string }[] }>(
      manifest,
    )?.scenes.map((scene) => ({ id: scene.id, label: scene.name })) ?? []
  );
}

function EntryEditor({
  row,
  form,
  disabled,
  tracks,
  sheets,
  onSave,
}: {
  row: Row;
  form: string;
  disabled: boolean;
  tracks: Choice[];
  sheets: Choice[];
  onSave: (settings: Settings, original: Settings) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState(row.entry.settings);
  const [original] = useState(row.entry.settings);
  const [family, setFamily] =
    useState<Awaited<ReturnType<typeof presetVersions>>>();
  const [scenes, setScenes] = useState<Choice[]>([]);
  const [mixes, setMixes] = useState<Choice[]>([]);
  const [error, setError] = useState('');
  const { kind, id } = row.entry.preset;
  useEffect(() => {
    let active = true;
    void presetVersions(kind, id).then(
      (versions) => {
        if (active) setFamily(versions);
      },
      (cause: unknown) => {
        if (active) setError(friendlyError(cause, 'read set entry versions'));
      },
    );
    return () => {
      active = false;
    };
  }, [kind, id]);
  const content = family?.preset.versions.find(
    (v) => v.id === (draft.version ?? family.preset.default_version),
  )?.content;
  useEffect(() => {
    let active = true;
    if (content && kind === 'rig')
      void startingScenes(content)
        .then((choices) => {
          if (active) setScenes(choices);
        })
        .catch((e) => {
          if (active) setError(friendlyError(e, 'read starting scenes'));
        });
    return () => {
      active = false;
    };
  }, [content, kind]);
  useEffect(() => {
    let active = true;
    if (draft.track)
      void songView(draft.track)
        .then((s) => {
          if (active)
            setMixes(s.mixes.map((m) => ({ id: m.id, label: m.title })));
        })
        .catch(() => {
          if (active) setMixes([]);
        });
    return () => {
      active = false;
    };
  }, [draft.track]);
  return (
    <form
      id={form}
      onSubmit={(event) => {
        event.preventDefault();
        if (!disabled && family) void onSave(draft, original);
      }}
    >
      <fieldset disabled={disabled || !family} className="grid gap-2">
        <ChoiceField
          label="Version"
          value={draft.version}
          choices={
            family?.preset.versions.map(({ id, name }) => ({
              id,
              label: name,
            })) ?? []
          }
          empty="Follow default"
          segmented
          onChange={(version) => {
            const next = family?.preset.versions.find(
              (v) => v.id === (version ?? family.preset.default_version),
            )?.content;
            if (next !== content) setScenes([]);
            setDraft({
              ...draft,
              version,
              scene: next === content ? draft.scene : null,
            });
          }}
        />
        {kind === 'rig' && (
          <ChoiceField
            label="Starts on scene"
            value={draft.scene}
            choices={scenes}
            empty="Preset starting scene"
            segmented
            onChange={(scene) => setDraft({ ...draft, scene })}
          />
        )}
        <ChoiceField
          label="Backing track"
          value={draft.track}
          choices={tracks}
          empty="None"
          onChange={(track) => {
            setMixes([]);
            setDraft({ ...draft, track, mix: null, own_media: true });
          }}
        />
        {draft.track && (
          <ChoiceField
            label="Saved mix"
            value={draft.mix}
            choices={mixes}
            empty="Original track"
            onChange={(mix) => setDraft({ ...draft, mix, own_media: true })}
          />
        )}
        <ChoiceField
          label="Chord sheet"
          value={draft.sheet}
          choices={sheets}
          empty="None"
          onChange={(sheet) => setDraft({ ...draft, sheet, own_media: true })}
        />
      </fieldset>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}

export function SetOrderList({
  catalog,
  connected,
  onChanged,
  onReady,
  onPlay,
}: {
  catalog: LibraryCatalog;
  connected: boolean;
  onChanged: () => void;
  onReady: (ready: boolean) => void;
  onPlay: () => void;
}) {
  const [order, setState] = useState<SetOrder>();
  const [tracks, setTracks] = useState<Choice[]>([]);
  const [sheets, setSheets] = useState<Choice[]>([]);
  const [versionNames, setVersionNames] = useState<Record<string, string>>({});
  const [sceneNames, setSceneNames] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const [reloading, setReloading] = useState(false);
  const lock = useRef(false);
  const generation = useRef(0);
  useEffect(() => {
    if (!connected) return;
    let active = true;
    void readTracks().then(
      (choices) => {
        if (active) setTracks(choices);
      },
      () => {
        if (active) setError('Backing tracks could not be read.');
      },
    );
    void readSheets().then(
      (choices) => {
        if (active) setSheets(choices);
      },
      () => {
        if (active) setError('Chord sheets could not be read.');
      },
    );
    return () => {
      active = false;
    };
  }, [reload, connected]);
  const revision = catalog.revision;
  useEffect(() => {
    if (!connected) return;
    const request = ++generation.current;
    let active = true;
    const current = () => active && request === generation.current;
    void Promise.resolve()
      .then(() => setOrder())
      .then((result) => {
        if (current()) {
          setState(result);
          onReady(true);
        }
      })
      .catch((e) => {
        if (current()) {
          onReady(false);
          setError(friendlyError(e, 'read the performance order'));
        }
      })
      .finally(() => {
        if (current()) setReloading(false);
      });
    return () => {
      active = false;
    };
  }, [revision, onReady, connected, reload]);
  useEffect(() => {
    let active = true;
    // Only resolve labels the rows use. The editor always reads the selected version's choices.
    const versions = new Map<string, Row>();
    const documents = new Set<string>();
    for (const row of order?.entries ?? []) {
      if (row.entry.settings.version)
        versions.set(presetKey(row.entry.preset), row);
      if (row.entry.settings.scene && row.entry.preset.kind === 'rig')
        documents.add(row.content);
    }
    for (const [key, { entry }] of versions) {
      void presetVersions(entry.preset.kind, entry.preset.id).then(
        ({ preset }) => {
          if (active)
            setVersionNames((names) => ({
              ...names,
              ...Object.fromEntries(
                preset.versions.map(({ id, name }) => [`${key}:${id}`, name]),
              ),
            }));
        },
        () => {},
      );
    }
    for (const content of documents) {
      void startingScenes(content).then(
        (choices) => {
          if (active)
            setSceneNames((names) => ({
              ...names,
              ...Object.fromEntries(
                choices.map(({ id, label }) => [`${content}:${id}`, label]),
              ),
            }));
        },
        () => {},
      );
    }
    return () => {
      active = false;
    };
  }, [order]);

  const available = catalog.items.filter(
    (item) =>
      !item.archived &&
      !item.superseded &&
      !item.in_set_list &&
      ((item.kind === 'rig' && item.origin === 'oxidal_example') ||
        ((item.kind === 'rig' || item.kind === 'owned') &&
          (item.origin ?? 'mine') === 'mine')),
  );
  async function run(what: string, work: () => Promise<void>) {
    if (!order || reloading || lock.current || !connected) return false;
    lock.current = true;
    generation.current++;
    setBusy(true);
    setError('');
    try {
      await work();
      return true;
    } catch (cause) {
      setError(friendlyError(cause, what));
      return false;
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  function act(id: string, action: OccurrenceEdit['action']) {
    return run('update the set list', async () => {
      const updated = await setOrder({
        expected_revision: order!.revision,
        entry: id,
        action,
      });
      setState(updated);
      onChanged();
    });
  }
  function play(id: string) {
    void run('play this set entry', async () => {
      await recallOccurrence(id, order!.revision);
      onPlay();
    });
  }
  const failure = error && (
    <div role="alert" className="grid gap-2">
      {error}
      <Button
        variant="outline"
        disabled={busy || reloading || !connected}
        onClick={() => {
          setError('');
          setReloading(true);
          onChanged();
          setReload((count) => count + 1);
        }}
      >
        Reload set list
      </Button>
    </div>
  );
  if (!order) return failure || null;
  return (
    <div className="space-y-3">
      <SetListEditor
        name="Set list"
        entries={order.entries.map(({ entry, name, content }) => {
          const { version, scene, track, sheet } = entry.settings;
          const preset = presetKey(entry.preset);
          return {
            key: entry.id,
            preset,
            name,
            version: version
              ? (versionNames[`${preset}:${version}`] ?? 'Named')
              : 'Default',
            scene: scene ? (sceneNames[`${content}:${scene}`] ?? scene) : '',
            track: track ?? undefined,
            sheet: sheet ?? undefined,
          };
        })}
        presets={available.map((item) => ({
          id: presetKey(item),
          name: item.name,
          versions: [],
          scenes: [],
        }))}
        tracks={tracks}
        sheets={sheets}
        disabled={!connected || busy || reloading}
        error={failure}
        onPlay={() => play(order.entries[0]!.entry.id)}
        onPlayFrom={play}
        actions={{
          add: (ids) =>
            run('add presets to the set list', async () => {
              const entries = ids.map((id) => {
                const item = available.find(
                  (choice) => presetKey(choice) === id,
                );
                if (!item) throw new Error('A selected preset is unavailable.');
                return { kind: item.kind, id: item.id };
              });
              await libraryCatalog({
                expected_revision: order.revision,
                action: { kind: 'append_set', entries },
              });
              onChanged();
              setState(await setOrder());
            }),
          move: (id, before) => void act(id, { kind: 'place', before }),
          repeat: (id) =>
            void act(id, { kind: 'repeat', new_id: crypto.randomUUID() }),
          remove: (id) => act(id, { kind: 'remove' }),
          details: (id, form, close) => {
            const row = order.entries.find(
              (candidate) => candidate.entry.id === id,
            )!;
            return (
              <>
                <EntryEditor
                  key={id}
                  row={row}
                  form={form}
                  tracks={tracks}
                  sheets={sheets}
                  disabled={busy || reloading || !connected}
                  onSave={async (settings, original) => {
                    if (
                      JSON.stringify(row.entry.settings) !==
                      JSON.stringify(original)
                    ) {
                      setError(
                        'This set entry changed. Close it and open it again before editing.',
                      );
                      return false;
                    }
                    if (JSON.stringify(settings) === JSON.stringify(original)) {
                      close();
                      return true;
                    }
                    if (!(await act(id, { kind: 'change', settings })))
                      return false;
                    close();
                    return true;
                  }}
                />
                <CueEntryBacking
                  row={row}
                  disabled={!connected || busy || reloading}
                />
              </>
            );
          },
        }}
      />
      <RehearsalReport revision={order.revision} />
    </div>
  );
}
