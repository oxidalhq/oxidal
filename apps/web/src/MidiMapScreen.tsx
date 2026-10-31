import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Broadcast,
  CopySimple,
  DownloadSimple,
  MagicWand,
  MagnifyingGlass,
  Play,
  Trash,
  UploadSimple,
  WarningCircle,
} from '@phosphor-icons/react';
import { Button } from './components/ui/button';
import {
  libraryCatalog,
  applyMidiTemplate,
  midiDevices,
  midiMap,
  testMidi,
  updateMidiMap,
  type AudioState,
  type LibraryCatalog,
  type MidiDevices,
  type MidiMap,
  type RigAudioState,
} from './api';

type MapEntry = MidiMap['entries'][number];
type Message = NonNullable<
  NonNullable<
    NonNullable<NonNullable<RigAudioState['control']>['midi']>['last']
  >
>;
type EntryRef = MapEntry['entry'];
type RowRef =
  | { kind: 'preset' }
  | { kind: 'scene'; index: number }
  | { kind: 'branch'; index: number }
  | { kind: 'parameter'; index: number };
type Learning = {
  entry: EntryRef;
  row: RowRef;
  after: number;
};
type ImportFile = {
  format: 'oxidal-midi-map';
  version: 1;
  input: string | null;
  channel: number;
  template?: MidiMap['template'];
  entries: MidiMap['entries'];
};

const keyOf = (entry: EntryRef) => `${entry.kind}:${entry.id}`;
const sameEntry = (a: EntryRef | null, b: EntryRef) =>
  a?.kind === b.kind && a.id === b.id;
const words = (value: string) =>
  value
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^./, (letter) => letter.toUpperCase());
const messageText = (message: Message) =>
  message.kind === 'program'
    ? `Program ${message.program + 1}`
    : `CC ${message.controller} · value ${message.value}`;
const targetKey = (target: MapEntry['parameter_bindings'][number]['target']) =>
  JSON.stringify(target);
const targetFallback = (
  target: MapEntry['parameter_bindings'][number]['target'],
) => {
  switch (target.kind) {
    case 'native':
      return `${words(target.node)} · ${words(target.parameter)}`;
    case 'lv2':
      return `${words(target.node)} · ${words(target.symbol)}`;
    case 'bypass':
      return `${words(target.node)} bypass`;
    case 'merge':
      return `${words(target.node)} input ${target.port + 1}`;
  }
};
const testValue = (mode: MapEntry['parameter_bindings'][number]['mode']) =>
  mode === 'relative_offset64'
    ? 65
    : mode === 'relative_twos_complement'
      ? 1
      : 127;

function activeEntry(native: AudioState | null, mixed: RigAudioState | null) {
  if (
    native?.phase === 'running' &&
    native.configured &&
    !native.configured.draft &&
    native.configured.owned
  ) {
    return { kind: 'owned' as const, id: native.configured.preset_id };
  }
  if (mixed?.phase === 'running' && mixed.configured) {
    return { kind: 'rig' as const, id: mixed.configured.revision };
  }
  return null;
}

function importFile(value: unknown): ImportFile {
  if (
    !value ||
    typeof value !== 'object' ||
    !('format' in value) ||
    value.format !== 'oxidal-midi-map' ||
    !('version' in value) ||
    value.version !== 1 ||
    !('channel' in value) ||
    typeof value.channel !== 'number' ||
    !('input' in value) ||
    (value.input !== null && typeof value.input !== 'string') ||
    !('entries' in value) ||
    !Array.isArray(value.entries)
  ) {
    throw new Error('Choose an Oxidal MIDI map export');
  }
  return value as ImportFile;
}

export function MidiMapScreen({
  connected,
  native,
  mixed,
  onMapApplied,
}: {
  connected: boolean;
  native: AudioState | null;
  mixed: RigAudioState | null;
  onMapApplied: (map: MidiMap) => Promise<void>;
}) {
  const [map, setMap] = useState<MidiMap | null>(null);
  const [catalog, setCatalog] = useState<LibraryCatalog | null>(null);
  const [devices, setDevices] = useState<MidiDevices | null>(null);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [learning, setLearning] = useState<Learning | null>(null);
  const [pendingImport, setPendingImport] = useState<ImportFile | null>(null);
  const [templateButtons, setTemplateButtons] = useState(0);
  const [templateController, setTemplateController] = useState(40);
  const [copyFrom, setCopyFrom] = useState('');
  const [copyTo, setCopyTo] = useState('');
  const [pendingClear, setPendingClear] = useState('');
  const [pendingTemplate, setPendingTemplate] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const current = activeEntry(native, mixed);
  const status =
    native?.phase === 'running'
      ? native.midi
      : mixed?.phase === 'running'
        ? mixed.control?.midi
        : null;
  const activeControl = mixed?.phase === 'running' ? mixed.control : null;

  useEffect(() => {
    let active = true;
    void Promise.all([midiMap(), libraryCatalog(), midiDevices()])
      .then(([nextMap, nextCatalog, nextDevices]) => {
        if (!active) return;
        setMap(nextMap);
        setTemplateButtons(nextMap.template?.scene_buttons ?? 0);
        setTemplateController(nextMap.template?.first_controller ?? 40);
        setCatalog(nextCatalog);
        setDevices(nextDevices);
      })
      .catch((cause: unknown) => {
        if (active) setError(String(cause));
      });
    return () => {
      active = false;
    };
  }, []);

  async function replaceMap(
    content: Pick<MidiMap, 'input' | 'channel' | 'template' | 'entries'>,
  ) {
    if (!map || busy) return;
    setBusy(true);
    setError('');
    try {
      const updated = await updateMidiMap({
        expected_revision: map.revision,
        input: content.input,
        channel: content.channel,
        template: content.template,
        entries: content.entries,
      });
      setMap(updated);
      await onMapApplied(updated);
    } catch (cause) {
      setError(String(cause));
      throw cause;
    } finally {
      setBusy(false);
    }
  }

  async function applyTemplateToPreset(entry: EntryRef) {
    if (!map || busy) return;
    setBusy(true);
    setError('');
    try {
      const updated = await applyMidiTemplate({
        expected_revision: map.revision,
        entry,
      });
      setMap(updated);
      setPendingTemplate('');
      await onMapApplied(updated);
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  }

  const setList = useMemo(
    () =>
      catalog?.items.filter(
        (item) =>
          !item.archived &&
          item.origin === 'mine' &&
          (item.kind === 'owned' || item.kind === 'rig'),
      ) ?? [],
    [catalog],
  );
  const groups = useMemo(() => {
    if (!map) return [];
    const explicit = new Map(
      map.entries.map((entry) => [keyOf(entry.entry), entry]),
    );
    const rows = setList.map((item, slot) => ({
      entry: { kind: item.kind as 'owned' | 'rig', id: item.id },
      name: item.name,
      slot,
      map: explicit.get(`${item.kind}:${item.id}`),
      orphaned: false,
    }));
    const visible = new Set(rows.map((row) => keyOf(row.entry)));
    for (const entry of map.entries) {
      if (visible.has(keyOf(entry.entry))) continue;
      const item = catalog?.items.find(
        (candidate) =>
          candidate.kind === entry.entry.kind &&
          candidate.id === entry.entry.id,
      );
      rows.push({
        entry: entry.entry as EntryRef & { kind: 'owned' | 'rig' },
        name: item?.name ?? 'Unavailable preset',
        slot: -1,
        map: entry,
        orphaned: true,
      });
    }
    return rows;
  }, [catalog, map, setList]);

  const visibleGroups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return groups;
    return groups.filter((group) => {
      const rowText = [
        group.name,
        group.slot >= 0 ? `program ${group.slot + 1}` : '',
        ...(group.map?.bindings.map((binding) =>
          binding.program == null
            ? `scene ${binding.scene} cc ${binding.controller}`
            : `scene ${binding.scene} program ${binding.program + 1}`,
        ) ?? []),
        ...(group.map?.branch_bindings.map(
          (binding) => `switch ${binding.branch} cc ${binding.controller}`,
        ) ?? []),
        ...(group.map?.parameter_bindings.map(
          (binding) =>
            `control ${targetFallback(binding.target)} cc ${binding.controller}`,
        ) ?? []),
      ]
        .join(' ')
        .toLowerCase();
      return rowText.includes(needle);
    });
  }, [groups, query]);
  const numberUse = useMemo(() => {
    const uses = new Map<string, Set<string>>();
    const add = (number: string, preset: string) => {
      const presets = uses.get(number) ?? new Set<string>();
      presets.add(preset);
      uses.set(number, presets);
    };
    for (const group of groups) {
      const preset = keyOf(group.entry);
      if (group.slot >= 0 && group.slot < 128)
        add(`program:${group.slot}`, preset);
      for (const binding of group.map?.bindings ?? []) {
        add(
          binding.program == null
            ? `cc:${binding.controller}`
            : `program:${binding.program}`,
          preset,
        );
      }
      for (const binding of group.map?.branch_bindings ?? [])
        add(`cc:${binding.controller}`, preset);
      for (const binding of group.map?.parameter_bindings ?? [])
        add(`cc:${binding.controller}`, preset);
    }
    return uses;
  }, [groups]);

  async function saveTemplate() {
    if (!map) return;
    await replaceMap({
      ...map,
      template:
        templateButtons === 0
          ? null
          : {
              scene_buttons: templateButtons,
              first_controller: templateController,
            },
    }).catch(() => undefined);
  }

  async function copyMappings() {
    if (!map || !copyFrom || !copyTo || copyFrom === copyTo) return;
    const source = map.entries.find((entry) => keyOf(entry.entry) === copyFrom);
    const target = groups.find((group) => keyOf(group.entry) === copyTo);
    if (!source || !target) return;
    const copied: MapEntry = {
      entry: target.entry,
      bindings: source.bindings.map((binding) => ({ ...binding })),
      branch_bindings: source.branch_bindings.map((binding) => ({
        ...binding,
      })),
      parameter_bindings: source.parameter_bindings.map((binding) => ({
        ...binding,
        target: { ...binding.target },
      })),
    };
    const entries = map.entries.filter(
      (entry) => !sameEntry(entry.entry, target.entry),
    );
    entries.push(copied);
    await replaceMap({ ...map, entries })
      .then(() => {
        setCopyFrom('');
        setCopyTo('');
      })
      .catch(() => undefined);
  }

  async function clearMappings(entry: EntryRef) {
    if (!map) return;
    await replaceMap({
      ...map,
      entries: map.entries.filter(
        (candidate) => !sameEntry(candidate.entry, entry),
      ),
    })
      .then(() => setPendingClear(''))
      .catch(() => undefined);
  }

  async function movePreset(entry: EntryRef, program: number) {
    if (!catalog) return;
    const without = setList.filter(
      (item) => item.kind !== entry.kind || item.id !== entry.id,
    );
    if (program > without.length) {
      throw new Error(
        `Program ${program + 1} is outside this ${setList.length}-preset set-list`,
      );
    }
    const before = without[program];
    const updated = await libraryCatalog({
      expected_revision: catalog.revision,
      entry_kind: entry.kind,
      id: entry.id,
      action: {
        kind: 'place',
        before: before ? { kind: before.kind, id: before.id } : null,
      },
    });
    setCatalog(updated);
  }

  async function applyLearn(learn: Learning, message: Message) {
    if (!map) return;
    if (learn.row.kind === 'preset') {
      if (message.kind !== 'program') {
        throw new Error('Preset recall learns Program Change, not CC');
      }
      await movePreset(learn.entry, message.program);
      return;
    }
    const row = learn.row;
    const entries = map.entries.map((entry) => {
      if (!sameEntry(entry.entry, learn.entry)) return entry;
      if (row.kind === 'scene') {
        const selected = row.index;
        return {
          ...entry,
          bindings: entry.bindings.map((binding, index) =>
            index !== selected
              ? binding
              : message.kind === 'program'
                ? { ...binding, program: message.program, controller: null }
                : {
                    ...binding,
                    program: null,
                    controller: message.controller,
                  },
          ),
        };
      }
      if (message.kind !== 'control') {
        throw new Error('Block switches and controls learn CC messages');
      }
      if (row.kind === 'branch') {
        const selected = row.index;
        return {
          ...entry,
          branch_bindings: entry.branch_bindings.map((binding, index) =>
            index === selected
              ? { ...binding, controller: message.controller }
              : binding,
          ),
        };
      }
      const selected = row.index;
      return {
        ...entry,
        parameter_bindings: entry.parameter_bindings.map((binding, index) =>
          index === selected
            ? { ...binding, controller: message.controller }
            : binding,
        ),
      };
    });
    await replaceMap({ ...map, entries });
  }

  const learnHandler = useRef(applyLearn);
  useEffect(() => {
    learnHandler.current = applyLearn;
  });
  const lastMessage = status?.last;
  const eventCount = status?.events ?? 0;
  useEffect(() => {
    if (!learning || !lastMessage || eventCount <= learning.after) return;
    const learned = learning;
    const timer = window.setTimeout(() => {
      setLearning(null);
      void learnHandler
        .current(learned, lastMessage)
        .catch((cause: unknown) => setError(String(cause)));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [eventCount, lastMessage, learning]);

  async function runTest(entry: EntryRef, row: RowRef) {
    if (!map) return;
    const local = map.entries.find((candidate) =>
      sameEntry(candidate.entry, entry),
    );
    let message: Message | null = null;
    if (row.kind === 'scene') {
      const binding = local?.bindings[row.index];
      if (binding) {
        message =
          binding.program == null
            ? {
                kind: 'control',
                channel: map.channel || 1,
                controller: binding.controller ?? 0,
                value: 127,
              }
            : {
                kind: 'program',
                channel: map.channel || 1,
                program: binding.program,
              };
      }
    } else if (row.kind === 'branch') {
      const binding = local?.branch_bindings[row.index];
      if (binding)
        message = {
          kind: 'control',
          channel: map.channel || 1,
          controller: binding.controller,
          value: 127,
        };
    } else if (row.kind === 'parameter') {
      const binding = local?.parameter_bindings[row.index];
      if (binding)
        message = {
          kind: 'control',
          channel: map.channel || 1,
          controller: binding.controller,
          value: testValue(binding.mode),
        };
    }
    setBusy(true);
    setError('');
    try {
      await testMidi({ entry, message });
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  }

  function exportMap() {
    if (!map) return;
    const file: ImportFile = {
      format: 'oxidal-midi-map',
      version: 1,
      input: map.input ?? null,
      channel: map.channel,
      template: map.template ?? null,
      entries: map.entries,
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' }),
    );
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'oxidal-midi-map.json';
    anchor.click();
    URL.revokeObjectURL(url);
  }

  if (!map || !catalog) {
    return <p className="caption">{error || 'Reading controller map…'}</p>;
  }
  const canLearn = connected && !!map.input && !!status?.connected && !busy;
  const templateChanged =
    templateButtons !== (map.template?.scene_buttons ?? 0) ||
    (templateButtons > 0 &&
      templateController !== (map.template?.first_controller ?? 40));
  const templateInvalid =
    templateButtons > 0 &&
    (templateController < 1 ||
      templateController + templateButtons > 128 ||
      (templateController <= 32 && templateController + templateButtons > 32));
  const copySources = groups.filter((group) => group.map);
  return (
    <div className="space-y-4">
      {error && <p role="alert">{error}</p>}
      <div className="grid gap-3 rounded-lg bg-muted/45 p-3 md:grid-cols-[minmax(0,1fr)_10rem]">
        <label className="field min-w-0">
          MIDI input
          <select
            aria-label="Global MIDI input"
            value={map.input ?? ''}
            disabled={!connected || busy}
            onChange={(event) =>
              void replaceMap({
                ...map,
                input: event.target.value || null,
              }).catch(() => undefined)
            }
          >
            <option value="">Off</option>
            {map.input &&
              !devices?.inputs.some((device) => device.id === map.input) && (
                <option value={map.input}>{map.input} · unavailable</option>
              )}
            {devices?.inputs.map((device) => (
              <option key={device.id} value={device.id}>
                {device.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Channel
          <select
            aria-label="Global MIDI channel"
            value={map.channel}
            disabled={!map.input || !connected || busy}
            onChange={(event) =>
              void replaceMap({
                ...map,
                channel: Number(event.target.value),
              }).catch(() => undefined)
            }
          >
            <option value={0}>All</option>
            {Array.from({ length: 16 }, (_, index) => (
              <option key={index + 1} value={index + 1}>
                {index + 1}
              </option>
            ))}
          </select>
        </label>
        <div className="min-w-0 md:col-span-2">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Broadcast size={18} aria-hidden="true" />
            <strong>
              {!map.input
                ? 'MIDI is off'
                : status?.connected
                  ? 'Listening'
                  : 'Waiting for controller'}
            </strong>
            {status && (
              <span className="caption">{status.events} messages</span>
            )}
          </div>
          {status?.last ? (
            <output
              className="midi-message mt-2"
              aria-label="Last MIDI message"
            >
              Channel {status.last.channel} · {messageText(status.last)}
            </output>
          ) : (
            <p className="caption mt-1">
              The last incoming message appears here.
            </p>
          )}
          {status?.error && <p className="caption mt-1">{status.error}</p>}
        </div>
      </div>

      <details className="midi-helpers" aria-label="MIDI mapping helpers">
        <summary className="cursor-pointer px-3 py-3">
          <span className="ml-1 flex min-w-0 flex-1 flex-col pr-2">
            <span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <strong>Mapping helpers</strong>
              <span className="caption">
                {map.template
                  ? `${map.template.scene_buttons} buttons · CC ${map.template.first_controller}–${map.template.first_controller + map.template.scene_buttons - 1}`
                  : 'No unit template'}
              </span>
            </span>
            <span className="caption mt-1 flex max-w-2xl">
              A unit template maps consecutive CC buttons to scenes. New Mine
              scene presets inherit it automatically.
            </span>
          </span>
        </summary>
        <div className="space-y-3 px-3 pb-3">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_8rem_auto] sm:items-end">
            <label className="field min-w-0">
              Scene template
              <select
                aria-label="Scene button template"
                value={templateButtons}
                disabled={busy || !connected}
                onChange={(event) =>
                  setTemplateButtons(Number(event.target.value))
                }
              >
                <option value={0}>None</option>
                <option value={4}>4 buttons</option>
                <option value={8}>8 buttons</option>
              </select>
            </label>
            <label className="field">
              First CC
              <input
                aria-label="First template CC"
                type="number"
                min={1}
                max={127}
                value={templateController}
                disabled={!templateButtons || busy || !connected}
                onChange={(event) =>
                  setTemplateController(Number(event.target.value))
                }
              />
            </label>
            <Button
              variant="outline"
              disabled={
                !templateChanged || templateInvalid || busy || !connected
              }
              onClick={() => void saveTemplate()}
            >
              <MagicWand size={18} aria-hidden="true" /> Save template
            </Button>
          </div>
          {templateInvalid && (
            <p className="text-sm text-destructive" role="alert">
              Use CC 1–127 without crossing reserved Bank Select CC 32.
            </p>
          )}
          <div className="grid gap-2 border-t border-border/70 pt-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
            <label className="field min-w-0">
              Copy from
              <select
                aria-label="Copy MIDI mappings from"
                value={copyFrom}
                disabled={busy || !connected || copySources.length === 0}
                onChange={(event) => setCopyFrom(event.target.value)}
              >
                <option value="">Choose mapped preset</option>
                {copySources.map((group) => (
                  <option key={keyOf(group.entry)} value={keyOf(group.entry)}>
                    {group.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field min-w-0">
              Copy to
              <select
                aria-label="Copy MIDI mappings to"
                value={copyTo}
                disabled={busy || !connected || !copyFrom}
                onChange={(event) => setCopyTo(event.target.value)}
              >
                <option value="">Choose destination</option>
                {groups
                  .filter((group) => keyOf(group.entry) !== copyFrom)
                  .map((group) => (
                    <option key={keyOf(group.entry)} value={keyOf(group.entry)}>
                      {group.name}
                    </option>
                  ))}
              </select>
            </label>
            <Button
              variant="outline"
              disabled={!copyFrom || !copyTo || busy || !connected}
              onClick={() => void copyMappings()}
            >
              <CopySimple size={18} aria-hidden="true" /> Copy mappings
            </Button>
          </div>
          <p className="caption">
            Copy keeps exact scene, block and control targets; use it between
            copies of the same rig. Use the scene template for different rigs.
          </p>
        </div>
      </details>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-[minmax(12rem,1fr)_auto_auto] sm:items-center">
        <label className="relative col-span-2 min-w-0 sm:col-span-1 sm:min-w-[12rem]">
          <MagnifyingGlass
            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground"
            size={18}
            aria-hidden="true"
          />
          <span className="sr-only">Search MIDI map</span>
          <input
            className="w-full pl-10"
            type="search"
            placeholder="Find preset, Program or CC…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <Button
          variant="outline"
          className="w-full sm:w-auto"
          onClick={exportMap}
          disabled={busy}
        >
          <DownloadSimple size={18} aria-hidden="true" />
          Export
        </Button>
        <Button
          variant="outline"
          className="w-full sm:w-auto"
          onClick={() => fileInput.current?.click()}
          disabled={busy || !connected}
        >
          <UploadSimple size={18} aria-hidden="true" />
          Import
        </Button>
        <input
          ref={fileInput}
          className="sr-only"
          type="file"
          accept="application/json,.json"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (!file) return;
            if (file.size > 16 * 1024 * 1024) {
              setError('MIDI map exceeds 16 MiB');
              return;
            }
            void file
              .text()
              .then((text) => setPendingImport(importFile(JSON.parse(text))))
              .catch((cause: unknown) => setError(String(cause)));
          }}
        />
      </div>

      {pendingImport && (
        <section
          className="rounded-lg border border-border bg-card p-3"
          aria-label="Confirm MIDI map import"
        >
          <strong>Replace this unit’s MIDI map?</strong>
          <p className="caption mt-1">
            {pendingImport.entries.length} preset mappings · channel{' '}
            {pendingImport.channel || 'All'} ·{' '}
            {pendingImport.input ? 'controller included' : 'MIDI off'}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              onClick={() => {
                const selected = pendingImport;
                setPendingImport(null);
                void replaceMap(selected).catch(() => undefined);
              }}
              disabled={busy}
            >
              Replace map
            </Button>
            <Button variant="ghost" onClick={() => setPendingImport(null)}>
              Cancel
            </Button>
          </div>
        </section>
      )}

      <div className="midi-preset-list" aria-label="Complete MIDI map">
        {visibleGroups.map((group) => {
          const isCurrent = sameEntry(current, group.entry);
          const local = group.map;
          const sceneNames = isCurrent
            ? new Map(
                activeControl?.scenes?.scenes.map((scene) => [
                  scene.id,
                  scene.name,
                ]) ?? [],
              )
            : new Map<string, string>();
          const branchNames = isCurrent
            ? new Map(
                activeControl?.branches?.map((branch) => [
                  branch.id,
                  branch.name,
                ]) ?? [],
              )
            : new Map<string, string>();
          const controlNames = isCurrent
            ? new Map(
                activeControl?.controls.map((control) => [
                  targetKey(control.target),
                  control.label,
                ]) ?? [],
              )
            : new Map<string, string>();
          const recallConflict =
            group.slot >= 0 &&
            local?.bindings.some(
              (binding) => binding.program === group.slot % 128,
            );
          const recallShared =
            group.slot >= 0 &&
            group.slot < 128 &&
            (numberUse.get(`program:${group.slot}`)?.size ?? 0) > 1;
          const rowCount =
            (local?.bindings.length ?? 0) +
            (local?.branch_bindings.length ?? 0) +
            (local?.parameter_bindings.length ?? 0);
          const learnButton = (row: RowRef, label: string) => {
            const active =
              learning &&
              sameEntry(learning.entry, group.entry) &&
              JSON.stringify(learning.row) === JSON.stringify(row);
            return (
              <Button
                variant="ghost"
                className="min-h-9 px-2 py-1"
                disabled={!canLearn}
                onClick={() =>
                  setLearning(
                    active
                      ? null
                      : {
                          entry: group.entry,
                          row,
                          after: status?.events ?? 0,
                        },
                  )
                }
              >
                {active ? 'Cancel' : 'Learn'}
                <span className="sr-only"> {label}</span>
              </Button>
            );
          };
          const testButton = (row: RowRef, label: string) => (
            <Button
              variant="outline"
              className="min-h-9 px-2 py-1"
              disabled={busy || !connected}
              title={
                row.kind !== 'preset' && !isCurrent
                  ? 'Recalls this preset, then runs its mapped action'
                  : undefined
              }
              onClick={() => void runTest(group.entry, row)}
            >
              <Play size={15} weight="fill" aria-hidden="true" />
              Test<span className="sr-only"> {label}</span>
            </Button>
          );
          const mappingRow = (
            id: string,
            label: string,
            detail: string,
            row: RowRef,
            conflict = false,
            shared = false,
          ) => (
            <li
              key={id}
              className={`grid gap-2 border-t border-border/70 px-3 py-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center ${conflict ? 'bg-destructive/5' : ''}`}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{label}</span>
                  {conflict && (
                    <span className="inline-flex items-center gap-1 text-xs font-semibold text-destructive">
                      <WarningCircle size={15} aria-hidden="true" /> Conflict
                    </span>
                  )}
                  {shared && !conflict && (
                    <span className="text-xs font-semibold text-muted-foreground">
                      Shared number
                    </span>
                  )}
                </div>
                <p className="caption break-words">{detail}</p>
              </div>
              <div className="flex flex-wrap gap-1 sm:justify-end">
                {learnButton(row, label)}
                {testButton(row, label)}
              </div>
            </li>
          );
          return (
            <section key={keyOf(group.entry)} className="midi-preset-group">
              <div className="flex flex-wrap items-start justify-between gap-2 px-3 py-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="m-0 text-base">{group.name}</h3>
                    {isCurrent && (
                      <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
                        Playing
                      </span>
                    )}
                    {group.orphaned && (
                      <span className="text-xs font-semibold text-destructive">
                        Preset unavailable
                      </span>
                    )}
                  </div>
                  <p className="caption mt-0.5">
                    {group.slot >= 0
                      ? group.slot < 128
                        ? `Preset · Program ${group.slot + 1}`
                        : `Preset · Bank ${Math.floor(group.slot / 128)}, Program ${(group.slot % 128) + 1}`
                      : 'Saved local mappings'}{' '}
                    · {rowCount} local {rowCount === 1 ? 'mapping' : 'mappings'}
                  </p>
                  {recallConflict && (
                    <p className="mt-1 flex items-center gap-1 text-xs font-semibold text-destructive">
                      <WarningCircle size={15} aria-hidden="true" /> A scene
                      uses this Program while the preset is playing; the scene
                      wins.
                    </p>
                  )}
                  {recallShared && !recallConflict && (
                    <p className="caption mt-1">
                      Program {group.slot + 1} is also used inside another
                      preset; local mappings remain preset-scoped.
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap gap-1">
                  {group.entry.kind === 'rig' && map.template && (
                    <>
                      <Button
                        variant="ghost"
                        className="min-h-9 px-2 py-1"
                        disabled={busy || !connected}
                        onClick={() => {
                          if (
                            rowCount > 0 &&
                            pendingTemplate !== keyOf(group.entry)
                          ) {
                            setPendingTemplate(keyOf(group.entry));
                          } else {
                            void applyTemplateToPreset(group.entry);
                          }
                        }}
                      >
                        <MagicWand size={16} aria-hidden="true" />{' '}
                        {pendingTemplate === keyOf(group.entry)
                          ? 'Replace mappings'
                          : 'Apply template'}
                      </Button>
                      {pendingTemplate === keyOf(group.entry) && (
                        <Button
                          variant="ghost"
                          className="min-h-9 px-2 py-1"
                          onClick={() => setPendingTemplate('')}
                        >
                          Cancel
                        </Button>
                      )}
                    </>
                  )}
                  {local &&
                    rowCount > 0 &&
                    (pendingClear === keyOf(group.entry) ? (
                      <>
                        <Button
                          variant="destructive"
                          className="min-h-9 px-2 py-1"
                          disabled={busy || !connected}
                          onClick={() => void clearMappings(group.entry)}
                        >
                          Clear mappings
                        </Button>
                        <Button
                          variant="ghost"
                          className="min-h-9 px-2 py-1"
                          onClick={() => setPendingClear('')}
                        >
                          Cancel
                        </Button>
                      </>
                    ) : (
                      <Button
                        variant="ghost"
                        className="min-h-9 px-2 py-1 text-destructive"
                        disabled={busy || !connected}
                        onClick={() => setPendingClear(keyOf(group.entry))}
                      >
                        <Trash size={16} aria-hidden="true" /> Clear
                      </Button>
                    ))}
                  {group.slot >= 0 && (
                    <>
                      {learnButton(
                        { kind: 'preset' },
                        `${group.name} preset recall`,
                      )}
                      {testButton(
                        { kind: 'preset' },
                        `${group.name} preset recall`,
                      )}
                    </>
                  )}
                </div>
              </div>
              {local && rowCount > 0 && (
                <ul className="m-0 list-none p-0">
                  {local.bindings.map((binding, index) =>
                    mappingRow(
                      `scene:${binding.scene}`,
                      `Scene · ${sceneNames.get(binding.scene) ?? words(binding.scene)}`,
                      binding.program == null
                        ? `CC ${binding.controller} · press`
                        : `Program ${binding.program + 1}`,
                      { kind: 'scene', index },
                      group.slot >= 0 && binding.program === group.slot % 128,
                      (numberUse.get(
                        binding.program == null
                          ? `cc:${binding.controller}`
                          : `program:${binding.program}`,
                      )?.size ?? 0) > 1,
                    ),
                  )}
                  {local.branch_bindings.map((binding, index) =>
                    mappingRow(
                      `branch:${binding.branch}`,
                      `Switch · ${branchNames.get(binding.branch) ?? words(binding.branch)}`,
                      `CC ${binding.controller} · ${words(binding.mode ?? 'absolute')}`,
                      { kind: 'branch', index },
                      false,
                      (numberUse.get(`cc:${binding.controller}`)?.size ?? 0) >
                        1,
                    ),
                  )}
                  {local.parameter_bindings.map((binding, index) =>
                    mappingRow(
                      `parameter:${index}:${targetKey(binding.target)}`,
                      `Control · ${controlNames.get(targetKey(binding.target)) ?? targetFallback(binding.target)}`,
                      `CC ${binding.controller} · ${words(binding.mode ?? 'absolute')}`,
                      { kind: 'parameter', index },
                      false,
                      (numberUse.get(`cc:${binding.controller}`)?.size ?? 0) >
                        1,
                    ),
                  )}
                </ul>
              )}
            </section>
          );
        })}
        {!visibleGroups.length && (
          <p className="rounded-lg bg-muted/45 p-4 text-sm">
            No mappings match “{query}”.
          </p>
        )}
      </div>
    </div>
  );
}
