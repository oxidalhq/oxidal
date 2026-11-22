/**
 * Stems and mixes for one backing song: split on the device, play the stems
 * live while shaping a mix, save it as a backing track and link it to a rig
 * or Set list entry.
 *
 * @see docs/media.md#stem-mix-recipes
 */
import {
  ArrowClockwise,
  ArrowCounterClockwise,
  DownloadSimple,
  Pause,
  Play,
  Scissors,
  Trash,
  Warning,
} from '@phosphor-icons/react';
import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';

import { Button } from '@oxidal/design-system/components/button';
import { useConfirm } from '@oxidal/design-system/components/confirm';
import {
  Segment,
  SegmentedControl,
} from '@oxidal/design-system/components/segmented';
import { Progress } from '@oxidal/design-system/components/states';
import { Caption } from '@oxidal/design-system/components/text';

import { AdjustmentDialog } from '../../AdjustmentDialog';
import {
  cancelSongSplit,
  deleteSongMix,
  deleteSongSplit,
  type MediaAsset,
  type SavedSongMix,
  saveSongMix,
  type SongSplitJob,
  songSplitJob,
  type SongView,
  songView,
  splitOptions,
  startSongSplit,
  stemArchivePath,
  stemWavPath,
  wavPath,
} from '../../api';
import { deviceSentence } from '../../lib/friendlyError';
import { formatTime } from '../../lib/playerClock';
import {
  canSplitBackingTrack,
  usePlayerPosition,
  useSessionMedia,
  useStemMixSender,
} from './sessionMedia';
import { MixLinks } from './SongLinkControls';
import {
  applyQuickMix,
  blankRecipe,
  commit,
  describeRecipe,
  type Draft,
  freshHistory,
  type History,
  matchingQuickMix,
  MODE_INFO,
  quickMixes,
  type Recipe,
  redo,
  roleLabel,
  sameRecipe,
  type Split,
  splitLabel,
  splitRoles,
  undo,
} from './stemMix';
import { StemMixer } from './StemMixer';

type Mode = Recipe['mode'];

export function StemMixEditor({
  source,
  locked,
  onClose,
  initialMix,
}: {
  source: MediaAsset;
  locked: boolean;
  onClose: () => void;
  /** Open this saved mix (by mix or render ID) instead of the latest one. */
  initialMix?: string;
}) {
  const { player, send, refreshLibrary, refreshSplit, slow, refusal } =
    useSessionMedia();
  const sendMix = useStemMixSender();
  const { ask, dialog } = useConfirm();
  const { at, length } = usePlayerPosition();
  const [song, setSong] = useState<SongView | null>(null);
  const [splitId, setSplitId] = useState('');
  const [saved, setSaved] = useState<SavedSongMix | null>(null);
  const [history, setHistory] = useState<History | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [modes, setModes] = useState<Mode[] | null>(null);
  const [job, setJob] = useState<SongSplitJob | null>(null);
  const [splitting, setSplitting] = useState(false);
  const gesture = useRef<Draft | null>(null);
  const titleStart = useRef<Draft | null>(null);
  const canSplit = canSplitBackingTrack(source);
  const split = song?.splits.find((row) => row.id === splitId);
  const roles = useMemo(() => (split ? splitRoles(split) : []), [split]);
  const draft = history?.current;
  const recipe = draft?.recipe;
  const defaultTitle = `${source.title} mix`.slice(0, 120);
  const currentDefaultTitle = useEffectEvent(() => defaultTitle);
  const dirty =
    !!draft &&
    (saved
      ? draft.title !== saved.title || !sameRecipe(draft.recipe, saved.recipe)
      : !!history?.past.length);
  const running = job?.phase === 'running';
  const live =
    !!split &&
    player?.stems?.source === source.id &&
    player.stems.split === split.id;
  const playing = live && player?.state === 'playing';

  function open(next: Split, mix: SavedSongMix | null) {
    setSaved(mix);
    setSplitId(next.id);
    setNotice('');
    gesture.current = null;
    setHistory(
      freshHistory({
        title: mix?.title ?? defaultTitle,
        recipe: mix?.recipe ?? blankRecipe(next.mode),
      }),
    );
  }

  useEffect(() => {
    let active = true;
    void songView(source.id)
      .then((result) => {
        if (!active) return;
        setSong(result);
        const chosen =
          result.mixes.find(
            (mix) => mix.id === initialMix || mix.asset === initialMix,
          ) ?? result.mixes.at(-1);
        const ready = chosen
          ? result.splits.find((row) => row.id === chosen.split)
          : result.splits.at(-1);
        if (ready) {
          setSplitId(ready.id);
          setSaved(chosen ?? null);
          setHistory(
            freshHistory({
              title: chosen?.title ?? currentDefaultTitle(),
              recipe: chosen?.recipe ?? blankRecipe(ready.mode),
            }),
          );
        }
      })
      .catch((cause: unknown) => {
        if (active) setError(deviceSentence(cause, 'load the stems'));
      });
    return () => {
      active = false;
    };
  }, [source.id, initialMix]);

  useEffect(() => {
    if (!canSplit) return;
    let current = true;
    void Promise.all([splitOptions(), songSplitJob(source.id)])
      .then(([options, status]) => {
        if (!current) return;
        setModes(options.modes);
        setJob((started) => started ?? status);
      })
      .catch((cause: unknown) => {
        if (current) setError(deviceSentence(cause, 'read the splitter'));
      });
    return () => {
      current = false;
    };
  }, [source.id, canSplit]);

  // Follow a running split, then open what it produced.
  useEffect(() => {
    if (!running) return;
    let current = true;
    let timer = 0;
    async function poll() {
      try {
        const status = await songSplitJob(source.id);
        if (!current) return;
        if (status?.phase === 'ready') {
          const updated = await songView(source.id);
          if (!current) return;
          setSong(updated);
          const ready = updated.splits.find((item) => item.id === status.id);
          if (ready) {
            setSaved(null);
            setSplitId(ready.id);
            setHistory(
              freshHistory({
                title: currentDefaultTitle(),
                recipe: blankRecipe(ready.mode),
              }),
            );
            setNotice(
              `${MODE_INFO[ready.mode].label} ready. Press Play and shape the mix as you listen.`,
            );
          }
        }
        if (status) setJob(status);
        if (status?.phase !== 'running') return;
      } catch (cause) {
        if (current) setError(deviceSentence(cause, 'check the split'));
      }
      if (current)
        timer = window.setTimeout(() => void poll(), slow ? 3000 : 1000);
    }
    timer = window.setTimeout(() => void poll(), 600);
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [running, source.id, slow]);

  async function hear(next: Draft) {
    if (live && split && recipe && !sameRecipe(recipe, next.recipe))
      return sendMix({
        split: split.id,
        expected: recipe,
        recipe: next.recipe,
      });
    return true;
  }

  async function stepHistory(direction: 'undo' | 'redo') {
    if (!history || busy) return;
    const next = direction === 'undo' ? undo(history) : redo(history);
    if (!live || sameRecipe(history.current.recipe, next.current.recipe)) {
      setHistory(next);
      return;
    }
    setBusy(direction);
    setError('');
    try {
      if (await hear(next.current))
        setHistory((current) => (current === history ? next : current));
      else
        setError(
          'The backing player did not apply the mix. Your undo history is still available.',
        );
    } finally {
      setBusy('');
    }
  }

  async function startSplit(mode: Mode) {
    setBusy('split');
    setError('');
    try {
      setJob(
        await startSongSplit(source.id, {
          mode,
          requestId: crypto.randomUUID(),
        }),
      );
      setSplitting(false);
      refreshSplit?.();
    } catch (cause) {
      setError(deviceSentence(cause, 'start splitting'));
    } finally {
      setBusy('');
    }
  }

  async function cancelSplit() {
    try {
      await cancelSongSplit(source.id);
    } catch (cause) {
      setError(deviceSentence(cause, 'cancel the split'));
    }
  }

  async function playStems() {
    if (!split || !draft) return;
    if (live) {
      await send({ kind: playing ? 'pause' : 'play' }, player?.track?.id);
      return;
    }
    const other =
      player?.state === 'playing' &&
      player.track?.id !== source.id &&
      player.stems?.source !== source.id;
    if (
      other &&
      !(await ask({
        title: 'Play these stems?',
        body: `“${player.track?.title ?? 'Another track'}” is playing. It stops and these stems start.`,
        confirm: 'Stop and play',
      }))
    )
      return;
    // The device keeps the cued render when switching splits of the same song.
    const expectedCue =
      player?.stems?.source === source.id
        ? (player.track?.id ?? source.id)
        : source.id;
    const cued = await send({
      kind: 'cue_stems',
      source: source.id,
      split: split.id,
      recipe: draft.recipe,
    });
    if (cued) await send({ kind: 'play' }, expectedCue);
  }

  function edit(next: Draft) {
    void hear(next);
    setHistory((state) => state && commit(state, next));
  }

  /** Slider drags update live and become one undo step when released. */
  function drag(next: Draft) {
    void hear(next);
    setHistory((state) => {
      if (!state) return state;
      gesture.current ??= state.current;
      return { ...state, current: next };
    });
  }
  function endDrag() {
    const from = gesture.current;
    gesture.current = null;
    if (from)
      setHistory((state) => state && commit(state, state.current, from));
  }

  async function mayDiscard() {
    return (
      !dirty ||
      ask({
        title: 'Discard changes?',
        body: 'This mix has changes that are not saved.',
        confirm: 'Discard',
        cancel: 'Keep editing',
      })
    );
  }

  async function save(copy: boolean) {
    if (!draft || !song || !split) return;
    let title = draft.title.trim() || defaultTitle;
    if (copy && saved && title === saved.title) {
      const taken = new Set(song.mixes.map((mix) => mix.title));
      let n = 2;
      while (taken.has(`${title} ${n}`)) n += 1;
      title = `${title} ${n}`.slice(0, 120);
    }
    setBusy('save');
    setError('');
    try {
      const row = await saveSongMix(source.id, {
        title,
        split: split.id,
        recipe: draft.recipe,
        replace:
          !copy && saved ? { id: saved.id, revision: saved.revision } : null,
      });
      setSong({
        ...song,
        mixes: [...song.mixes.filter((mix) => mix.id !== row.id), row],
      });
      open(split, row);
      setNotice(
        copy || !saved
          ? `Saved “${row.title}”. It is in Backing tracks and Stems.`
          : `Saved “${row.title}”.`,
      );
      refreshLibrary();
    } catch (cause) {
      setError(deviceSentence(cause, 'save the mix'));
    } finally {
      setBusy('');
    }
  }

  async function removeMix() {
    if (!saved || !song || !split) return;
    const ok = await ask({
      title: `Delete “${saved.title}”?`,
      body: 'The mix and its backing track are removed. The stems stay.',
      confirm: 'Delete mix',
    });
    if (!ok) return;
    setBusy('delete');
    setError('');
    try {
      await deleteSongMix(source.id, {
        id: saved.id,
        revision: saved.revision,
      });
      setSong({ ...song, mixes: song.mixes.filter((m) => m.id !== saved.id) });
      open(split, null);
      setNotice(`Deleted “${saved.title}”.`);
      refreshLibrary();
    } catch (cause) {
      setError(deviceSentence(cause, 'delete the mix'));
    } finally {
      setBusy('');
    }
  }

  async function removeSplit() {
    if (!song || !split || !(await mayDiscard())) return;
    const ok = await ask({
      title: 'Delete these stems?',
      body: 'The separated parts are removed. The original song stays.',
      confirm: 'Delete stems',
    });
    if (!ok) return;
    setBusy('delete');
    setError('');
    try {
      await deleteSongSplit(source.id, split.id);
      const remaining = song.splits.filter((row) => row.id !== split.id);
      setSong({ ...song, splits: remaining });
      const next = remaining.at(-1);
      if (next) open(next, null);
      else {
        setSplitId('');
        setSaved(null);
        setHistory(null);
      }
    } catch (cause) {
      setError(deviceSentence(cause, 'delete the stems'));
    } finally {
      setBusy('');
    }
  }

  // Protect locks authoring; live mixing stays available like the level.
  const editable = !locked && !busy;
  const mixable = (live || !locked) && !busy;
  const splitMixes = song?.mixes.filter((mix) => mix.split === splitId) ?? [];
  const quicks = useMemo(() => quickMixes(roles), [roles]);
  const quick = draft && matchingQuickMix(draft.recipe, roles, quicks);
  const showChooser =
    !!modes?.length && !running && (splitting || (song && !song.splits.length));

  return (
    <AdjustmentDialog
      title={source.title}
      description="Stems and mixes"
      sideSheet
      className="lg:w-[min(42rem,100vw)]"
      onCancel={() => {
        void mayDiscard().then((ok) => ok && onClose());
      }}
    >
      <div className="grid min-w-0 content-start gap-3">
        {locked && (
          <p className="flex min-w-0 flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-3 text-sm [&>svg]:size-4 [&>svg]:shrink-0">
            <Warning aria-hidden="true" weight="bold" />
            <span>
              Protect is on. You can play, mix live and download; turn it off to
              split, save or delete.
            </span>
          </p>
        )}
        {(error || refusal) && (
          <p
            className="flex min-w-0 flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-3 text-sm [&>svg]:size-4 [&>svg]:shrink-0"
            role="alert"
          >
            <Warning aria-hidden="true" weight="bold" />
            <span>{error || refusal}</span>
          </p>
        )}
        {!song && !error && <p role="status">Loading stems…</p>}

        {running && job && (
          <SplitProgressCard job={job} onCancel={() => void cancelSplit()} />
        )}
        {!running && job && job.phase !== 'ready' && (
          <p
            className="flex min-w-0 flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-3 text-sm [&>svg]:size-4 [&>svg]:shrink-0"
            role="status"
          >
            <Warning aria-hidden="true" weight="bold" />
            <span>
              {job.phase === 'failed'
                ? (job.error ?? 'The split failed.')
                : job.phase === 'cancelled'
                  ? 'Split cancelled. Earlier stems are unchanged.'
                  : 'The split stopped when Protect turned on or the device restarted. Earlier stems are unchanged.'}
            </span>
          </p>
        )}
        {song && !song.splits.length && !running && !modes?.length && (
          <Caption>
            {canSplit
              ? 'Splitting is not installed on this device. Use Import stems in Library › Stems for parts made elsewhere.'
              : 'This track has no stems.'}
          </Caption>
        )}
        {showChooser && modes && (
          <SplitChooser
            modes={modes}
            first={!song?.splits.length}
            disabled={!editable}
            onStart={(mode) => void startSplit(mode)}
            onCancel={
              song?.splits.length ? () => setSplitting(false) : undefined
            }
          />
        )}

        {song && split && draft && history && (
          <>
            <section
              className="grid min-w-0 gap-2 border-t border-border pt-3 first:border-0 first:pt-0"
              aria-labelledby="stem-mixes"
            >
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <Button
                  className="min-h-touch font-semibold"
                  aria-label={
                    playing ? 'Pause' : live ? 'Play' : 'Play the stems'
                  }
                  disabled={!!busy}
                  onClick={() => void playStems()}
                >
                  {playing ? (
                    <Pause aria-hidden="true" weight="fill" />
                  ) : (
                    <Play aria-hidden="true" weight="fill" />
                  )}
                  {playing ? 'Pause' : 'Play'}
                </Button>
                <div className="grid min-w-0 gap-0.5">
                  <strong id="stem-mixes">
                    {playing
                      ? 'Playing the stems live'
                      : live
                        ? 'Stems cued'
                        : 'Mix'}
                  </strong>
                  <Caption as="span" role="status">
                    {live
                      ? `${formatTime(at)} / ${formatTime(length)} · changes are heard as you make them`
                      : 'Press Play to hear changes as you make them.'}
                  </Caption>
                </div>
              </div>

              {splitMixes.length > 0 && (
                <div
                  className="flex min-w-0 flex-wrap items-center gap-2"
                  role="group"
                  aria-label="Saved mixes"
                >
                  {splitMixes.map((mix) => (
                    <Button
                      key={mix.id}
                      variant="outline"
                      aria-pressed={saved?.id === mix.id}
                      disabled={!!busy}
                      onClick={() => {
                        if (saved?.id === mix.id) return;
                        void mayDiscard().then((ok) => ok && open(split, mix));
                      }}
                    >
                      {mix.title}
                    </Button>
                  ))}
                  <Button
                    variant="outline"
                    aria-pressed={!saved}
                    disabled={!!busy}
                    onClick={() => {
                      if (!saved) return;
                      void mayDiscard().then((ok) => ok && open(split, null));
                    }}
                  >
                    New mix
                  </Button>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2">
                <span className="small-caps text-xs text-muted-foreground">
                  Start from
                </span>
                <SegmentedControl
                  size="sm"
                  className="max-w-full flex-wrap"
                  role="radiogroup"
                  aria-label="Start from"
                  value={quick?.name ?? ''}
                  disabled={!mixable}
                  onValueChange={(name) => {
                    const item = quicks.find((q) => q.name === name);
                    if (!item) return;
                    const named =
                      !saved &&
                      (draft.title === defaultTitle ||
                        quicks.some(
                          (q) => draft.title === `${source.title} – ${q.name}`,
                        ));
                    edit({
                      title: named
                        ? `${source.title} – ${item.name}`.slice(0, 120)
                        : draft.title,
                      recipe: applyQuickMix(draft.recipe, roles, item),
                    });
                  }}
                >
                  {quicks.map((item) => (
                    <Segment key={item.name} value={item.name}>
                      {item.name}
                    </Segment>
                  ))}
                </SegmentedControl>
              </div>

              <StemMixer
                roles={roles}
                recipe={draft.recipe}
                disabled={!mixable}
                slow={slow}
                download={(role) => stemWavPath(source.id, split.id, role)}
                onChange={(next, dragging) => {
                  const value = { ...draft, recipe: next };
                  if (dragging) drag(value);
                  else edit(value);
                }}
                onCommit={endDrag}
              />

              <label className="grid min-w-0 gap-1 text-sm font-medium [&>input]:min-h-touch [&>input]:min-w-0 [&>input]:rounded-md [&>input]:border [&>input]:border-input [&>input]:bg-background [&>input]:px-2">
                <span>Mix name</span>
                <input
                  maxLength={120}
                  value={draft.title}
                  disabled={!editable}
                  onFocus={() => {
                    titleStart.current = draft;
                  }}
                  onBlur={() => {
                    const from = titleStart.current;
                    titleStart.current = null;
                    if (from)
                      setHistory(
                        (state) => state && commit(state, state.current, from),
                      );
                  }}
                  onChange={(event) =>
                    setHistory(
                      (state) =>
                        state && {
                          ...state,
                          current: {
                            ...state.current,
                            title: event.target.value,
                          },
                        },
                    )
                  }
                />
              </label>

              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  size="icon"
                  aria-label="Undo"
                  title="Undo"
                  disabled={!mixable || !history.past.length}
                  onClick={() => void stepHistory('undo')}
                >
                  <ArrowCounterClockwise aria-hidden="true" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  aria-label="Redo"
                  title="Redo"
                  disabled={!mixable || !history.future.length}
                  onClick={() => void stepHistory('redo')}
                >
                  <ArrowClockwise aria-hidden="true" />
                </Button>
                {saved && dirty && (
                  <Button
                    variant="ghost"
                    disabled={!mixable}
                    onClick={() => open(split, saved)}
                  >
                    Revert
                  </Button>
                )}
                <span className="flex-1" role="status">
                  {busy === 'save'
                    ? 'Saving…'
                    : dirty
                      ? 'Unsaved changes'
                      : saved
                        ? 'Saved'
                        : ''}
                </span>
                {saved && (
                  <Button
                    variant="outline"
                    disabled={!editable || !draft.title.trim()}
                    onClick={() => void save(true)}
                  >
                    Save as new
                  </Button>
                )}
                <Button
                  disabled={
                    !editable || !draft.title.trim() || (!!saved && !dirty)
                  }
                  onClick={() => void save(false)}
                >
                  {saved ? 'Save' : 'Save as backing track'}
                </Button>
              </div>
              {notice && <Caption role="status">{notice}</Caption>}
            </section>

            {saved && (
              <section
                className="grid min-w-0 gap-2 border-t border-border pt-3 first:border-0 first:pt-0"
                aria-labelledby="stem-saved"
              >
                <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-2 [&>h2]:m-0 [&>h3]:m-0 [&>h3]:text-base [&>h3]:font-semibold">
                  <h3 id="stem-saved">“{saved.title}”</h3>
                </div>
                <Caption>
                  {describeRecipe(saved.recipe, roles)}. Saved mixes play from
                  Backing tracks, the Set list and linked rigs, and can still be
                  changed live in the player.
                </Caption>
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <Button variant="outline" asChild>
                    <a href={wavPath(saved.asset)} download>
                      <DownloadSimple aria-hidden="true" />
                      Mix WAV
                    </a>
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={!editable}
                    onClick={() => void removeMix()}
                  >
                    <Trash aria-hidden="true" />
                    Delete mix
                  </Button>
                </div>
                {!locked && (
                  <MixLinks
                    key={saved.id}
                    mix={{ source: source.id, mix: saved.id }}
                  />
                )}
              </section>
            )}

            <section
              className="grid min-w-0 gap-2 border-t border-border pt-3 first:border-0 first:pt-0"
              aria-labelledby="stem-files"
            >
              <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-2 [&>h2]:m-0 [&>h3]:m-0 [&>h3]:text-base [&>h3]:font-semibold">
                <h3 id="stem-files">Stems</h3>
                {song.splits.length > 1 && (
                  <SegmentedControl
                    aria-label="Stem set"
                    value={splitId}
                    onValueChange={(value) => {
                      const next = song.splits.find((row) => row.id === value);
                      if (!next || value === splitId) return;
                      void mayDiscard().then(
                        (ok) =>
                          ok &&
                          open(
                            next,
                            song.mixes
                              .filter((mix) => mix.split === next.id)
                              .at(-1) ?? null,
                          ),
                      );
                    }}
                  >
                    {song.splits.map((row) => (
                      <Segment key={row.id} value={row.id}>
                        {splitLabel(row, song.splits)}
                      </Segment>
                    ))}
                  </SegmentedControl>
                )}
              </div>
              <Caption>
                {split.importedRoles
                  ? `Uploaded stems: ${roles.map(roleLabel).join(', ')}.`
                  : `${MODE_INFO[split.mode].label} separated on this device: ${roles.map(roleLabel).join(', ')}.`}
              </Caption>
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <Button variant="outline" asChild>
                  <a href={stemArchivePath(source.id, split.id)} download>
                    <DownloadSimple aria-hidden="true" />
                    All stems (ZIP)
                  </a>
                </Button>
                {!!modes?.length && !running && !showChooser && (
                  <Button
                    variant="outline"
                    disabled={!editable}
                    onClick={() => setSplitting(true)}
                  >
                    <Scissors aria-hidden="true" />
                    Split again
                  </Button>
                )}
                {!split.importedRoles && (
                  <Button
                    variant="ghost"
                    disabled={!editable || splitMixes.length > 0}
                    title={
                      splitMixes.length
                        ? 'Delete the mixes made from these stems first'
                        : undefined
                    }
                    onClick={() => void removeSplit()}
                  >
                    <Trash aria-hidden="true" />
                    Delete stems
                  </Button>
                )}
              </div>
            </section>
          </>
        )}
      </div>
      {dialog}
    </AdjustmentDialog>
  );
}

function SplitChooser({
  modes,
  first,
  disabled,
  onStart,
  onCancel,
}: {
  modes: Mode[];
  first: boolean;
  disabled: boolean;
  onStart: (mode: Mode) => void;
  onCancel?: () => void;
}) {
  const [mode, setMode] = useState<Mode>(
    modes.includes('six') ? 'six' : 'four',
  );
  return (
    <section
      className="grid min-w-0 gap-2 border-t border-border pt-3 first:border-0 first:pt-0"
      aria-labelledby="stem-split"
    >
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-2 [&>h2]:m-0 [&>h3]:m-0 [&>h3]:text-base [&>h3]:font-semibold">
        <h3 id="stem-split">{first ? 'Split into stems' : 'Split again'}</h3>
      </div>
      <div
        className="grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,12rem),1fr))] gap-2"
        role="radiogroup"
        aria-label="Stems"
      >
        {(['four', 'six'] as const).map((value) => (
          <label
            key={value}
            className="relative grid min-h-touch min-w-0 cursor-pointer gap-1 rounded-md border border-border p-3 text-sm has-[:focus-visible]:outline-2 data-[checked]:border-foreground data-[checked]:bg-secondary data-[disabled]:cursor-not-allowed data-[disabled]:opacity-60 [&>input]:sr-only [&>span]:text-xs [&>span]:text-muted-foreground"
            data-checked={mode === value || undefined}
            data-disabled={!modes.includes(value) || undefined}
          >
            <input
              type="radio"
              name="stem-mode"
              value={value}
              checked={mode === value}
              disabled={!modes.includes(value)}
              onChange={() => setMode(value)}
            />
            <strong>{MODE_INFO[value].label}</strong>
            <span>
              {modes.includes(value)
                ? MODE_INFO[value].parts
                : 'Model not installed on this device.'}
            </span>
          </label>
        ))}
      </div>
      <Caption>
        Runs on this device in the background at low priority, so you can keep
        playing. A full song takes a few minutes; close this any time.
      </Caption>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Button disabled={disabled} onClick={() => onStart(mode)}>
          <Scissors aria-hidden="true" />
          Split song
        </Button>
        {onCancel && (
          <Button variant="outline" onClick={onCancel}>
            Not now
          </Button>
        )}
      </div>
    </section>
  );
}

const STAGE_WORD = {
  preparing: 'Preparing',
  separating: 'Separating',
  saving: 'Saving stems',
} as const;

function SplitProgressCard({
  job,
  onCancel,
}: {
  job: SongSplitJob;
  onCancel: () => void;
}) {
  const percent = job.progress?.percent ?? 0;
  return (
    <section
      className="grid min-w-0 gap-2 border-t border-border pt-3 first:border-0 first:pt-0"
      aria-label="Split progress"
    >
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-2 [&>h2]:m-0 [&>h3]:m-0 [&>h3]:text-base [&>h3]:font-semibold">
        <h3>Splitting into {MODE_INFO[job.mode].label}</h3>
        <span className="font-mono text-sm whitespace-nowrap tabular-nums">
          {percent}%
        </span>
      </div>
      <Progress label="Split progress" value={percent} />
      <Caption role="status">
        {job.progress ? STAGE_WORD[job.progress.stage] : 'Starting'}… You can
        keep playing or close this sheet; the split carries on.
      </Caption>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Button variant="outline" onClick={onCancel}>
          Cancel split
        </Button>
      </div>
    </section>
  );
}
