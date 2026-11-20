import { useEffect, useRef, useState } from 'react';

import { Button } from '@oxidal/design-system/components/button';
import { LibraryList } from '@oxidal/design-system/patterns/library-list';

import {
  chordSheets,
  mediaLibrary,
  type OccurrenceEdit,
  presetVersions,
  recallOccurrence,
  rigDocument,
  type SetOrder,
  setOrder,
  songView,
} from '../../api';
import { friendlyError } from '../../lib/friendlyError';
import { readScenes } from '../../sceneFormat';

type Row = SetOrder['entries'][number];
type Settings = Row['entry']['settings'];
type Choice = { id: string; name: string };

function ChoiceField({
  label,
  value,
  choices,
  empty,
  onChange,
}: {
  label: string;
  value?: string | null;
  choices: Choice[];
  empty: string;
  onChange: (value: string | null) => void;
}) {
  return (
    <label className="field">
      {label}
      <select
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value || null)}
      >
        <option value="">{empty}</option>
        {value && !choices.some((c) => c.id === value) && (
          <option value={value}>Unavailable · {value}</option>
        )}
        {choices.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function EntryEditor({
  row,
  disabled,
  onSave,
}: {
  row: Row;
  disabled: boolean;
  onSave: (settings: Settings) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState(row.entry.settings);
  const [family, setFamily] =
    useState<Awaited<ReturnType<typeof presetVersions>>>();
  const [tracks, setTracks] = useState<Choice[]>([]);
  const [sheets, setSheets] = useState<Choice[]>([]);
  const [scenes, setScenes] = useState<Choice[]>([]);
  const [mixes, setMixes] = useState<Choice[]>([]);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const { kind, id } = row.entry.preset;
  useEffect(() => {
    let active = true;
    async function read() {
      const [versions, media] = await Promise.all([
        presetVersions(kind, id),
        mediaLibrary(),
      ]);
      const all: Choice[] = [];
      let after: string | undefined;
      do {
        const page = await chordSheets(after);
        all.push(...page.sheets.map((s) => ({ id: s.id, name: s.title })));
        after = page.next ?? undefined;
      } while (active && after);
      if (active) {
        setFamily(versions);
        setTracks(
          media.assets
            .filter((a) => a.kind === 'backing')
            .map((a) => ({ id: a.id, name: a.title })),
        );
        setSheets(all);
        setLoaded(true);
      }
    }
    void read().catch((e) => {
      if (active) setError(friendlyError(e, 'read set entry choices'));
    });
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
      void rigDocument(content)
        .then((d) => {
          if (active)
            setScenes(
              readScenes<{ scenes: Choice[] }>(d.manifest)?.scenes ?? [],
            );
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
            setMixes(s.mixes.map((m) => ({ id: m.id, name: m.title })));
        })
        .catch(() => {
          if (active) setMixes([]);
        });
    return () => {
      active = false;
    };
  }, [draft.track]);
  return (
    <fieldset disabled={disabled || !loaded} className="grid gap-2">
      <ChoiceField
        label="Version"
        value={draft.version}
        choices={family?.preset.versions ?? []}
        empty="Follow default"
        onChange={(version) => {
          setScenes([]);
          setDraft({ ...draft, version, scene: null });
        }}
      />
      {kind === 'rig' && (
        <ChoiceField
          label="Starting scene"
          value={draft.scene}
          choices={scenes}
          empty="Preset starting scene"
          onChange={(scene) => setDraft({ ...draft, scene })}
        />
      )}
      <ChoiceField
        label="Backing track"
        value={draft.track}
        choices={tracks}
        empty="No track"
        onChange={(track) => {
          setMixes([]);
          setDraft({ ...draft, track, mix: null });
        }}
      />
      {draft.track && (
        <ChoiceField
          label="Saved mix"
          value={draft.mix}
          choices={mixes}
          empty="Original track"
          onChange={(mix) => setDraft({ ...draft, mix })}
        />
      )}
      <ChoiceField
        label="Chord sheet"
        value={draft.sheet}
        choices={sheets}
        empty="Use preset or track sheet"
        onChange={(sheet) => setDraft({ ...draft, sheet })}
      />
      <Button onClick={() => void onSave({...draft,own_media:true})}>Save entry settings</Button>
      {error && <p role="alert">{error}</p>}
    </fieldset>
  );
}

export function SetOrderList({
  revision,
  connected,
  onChanged,
  onReady,
}: {
  revision: string;
  connected: boolean;
  onChanged: () => void;
  onReady: (ready: boolean) => void;
}) {
  const [order, setState] = useState<SetOrder>();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  useEffect(() => {
    let active = true;
    void Promise.resolve()
      .then(() => setOrder())
      .then((result) => {
        if (active) {
          setState(result);
          onReady(true);
        }
      })
      .catch((e) => {
        if (active) {
          onReady(false);
          setError(friendlyError(e, 'read the performance order'));
        }
      });
    return () => {
      active = false;
    };
  }, [revision, onReady]);
  async function act(id: string, action: OccurrenceEdit['action'] | 'recall') {
    if (!order || lock.current || !connected) return false;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      if (action === 'recall') await recallOccurrence(id, order.revision);
      else {
        const updated = await setOrder({
          expected_revision: order.revision,
          entry: id,
          action,
        });
        setState(updated);
        setEditing(null);
        setConfirm(null);
        if (action.kind === 'repeat') setSelected(action.new_id);
        onChanged();
      }
      return true;
    } catch (e) {
      setError(friendlyError(e, 'use the set entry'));
      return false;
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  if (!order) return error ? <p role="status">{error}</p> : null;
  return (
    <div className="space-y-3">
      <LibraryList
        items={order.entries.map((r, i) => ({
          id: r.entry.id,
          title: r.name,
          caption: `Position ${i + 1} · PC ${(i % 128) + 1}${r.entry.settings.scene ? ' · ' + r.entry.settings.scene : ''}`,
        }))}
        selected={selected}
        onOpen={(id) => {
          setSelected(id);
          setConfirm(null);
          setEditing(null);
        }}
        query={query}
        onQuery={setQuery}
        sortable={false}
        noun={['entry', 'entries']}
        empty={{ title: 'No matching set entries' }}
        detail={(item) => {
          const i = order.entries.findIndex((r) => r.entry.id === item.id);
          const row = order.entries[i];
          const earlier = order.entries[i - 1];
          if (!row) return null;
          return (
            <div className="space-y-3">
              <fieldset
                disabled={busy || !connected}
                className="flex flex-wrap gap-2"
              >
                <Button onClick={() => void act(item.id, 'recall')}>
                  Recall entry
                </Button>
                <Button
                  variant="outline"
                  onClick={() =>
                    setEditing(editing === item.id ? null : item.id)
                  }
                >
                  Edit entry settings
                </Button>
                <Button
                  variant="outline"
                  onClick={() =>
                    void act(item.id, {
                      kind: 'repeat',
                      new_id: crypto.randomUUID(),
                    })
                  }
                >
                  Repeat entry
                </Button>
                <Button
                  variant="outline"
                  disabled={!earlier}
                  onClick={() =>
                    earlier &&
                    void act(item.id, {
                      kind: 'place',
                      before: earlier.entry.id,
                    })
                  }
                >
                  Move earlier
                </Button>
                <Button
                  variant="outline"
                  disabled={i === order.entries.length - 1}
                  onClick={() =>
                    void act(item.id, {
                      kind: 'place',
                      before: order.entries[i + 2]?.entry.id ?? null,
                    })
                  }
                >
                  Move later
                </Button>
                <Button variant="outline" onClick={() => setConfirm(item.id)}>
                  Remove entry
                </Button>
              </fieldset>
              {confirm === item.id && (
                <div>
                  <p>Remove this occurrence of {row.name} from the set?</p>
                  <Button
                    disabled={busy}
                    onClick={() => void act(item.id, { kind: 'remove' })}
                  >
                    Confirm removal
                  </Button>
                  <Button variant="outline" onClick={() => setConfirm(null)}>
                    Cancel
                  </Button>
                </div>
              )}
              {editing === item.id && (
                <EntryEditor
                  key={item.id}
                  row={row}
                  disabled={busy || !connected}
                  onSave={(settings) =>
                    act(item.id, { kind: 'change', settings })
                  }
                />
              )}
            </div>
          );
        }}
      />
      {error && (
        <div role="alert">
          {error}
          <Button
            variant="outline"
            disabled={busy}
            onClick={() =>
              void setOrder()
                .then(setState)
                .catch((e) => setError(friendlyError(e, 'reload the set list')))
            }
          >
            Reload set list
          </Button>
        </div>
      )}
    </div>
  );
}
