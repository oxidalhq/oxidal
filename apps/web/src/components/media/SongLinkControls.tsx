/**
 * Links between saved stem mixes and saved rigs or Set list entries, and the
 * explicit Cue control shown with the linked rig.
 *
 * @see docs/media.md#stem-mix-recipes
 */
import { LinkSimple, MusicNotes, X } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';

import { Button } from '@oxidal/design-system/components/button';
import { useConfirm } from '@oxidal/design-system/components/confirm';
import {
  Segment,
  SegmentedControl,
} from '@oxidal/design-system/components/segmented';
import { Caption } from '@oxidal/design-system/components/text';

import {
  type LibraryCatalog,
  libraryCatalog,
  type SetOrder,
  setOrder,
  type SongLinks,
  songLinks,
  type SongLinkUpdate,
  songView,
} from '../../api';
import { deviceSentence } from '../../lib/friendlyError';
import { useSessionMedia } from './sessionMedia';

const LINK_CHANGE = 'oxidal-song-links-changed';
type Target = SongLinkUpdate['target'];
type Mix = NonNullable<SongLinkUpdate['mix']>;
type CatalogItem = LibraryCatalog['items'][number];
const targetKey = (item: Pick<CatalogItem, 'kind' | 'id'>) =>
  `${item.kind}:${item.id}`;
const SCOPE_WORD: Record<Target['scope'], string> = {
  rig: 'Saved rig',
  set_list: 'Set list',
};

/** Where this mix is linked, and a form to link it to one more place. */
export function MixLinks({ mix }: { mix: Mix }) {
  const [catalog, setCatalog] = useState<LibraryCatalog | null>(null);
  const [links, setLinks] = useState<SongLinks | null>(null);
  const [scope, setScope] = useState<Target['scope']>('set_list');
  const [selected, setSelected] = useState('');
  const [state, setState] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    void Promise.all([libraryCatalog(), songLinks()]).then(
      ([nextCatalog, nextLinks]) => {
        if (!active) return;
        setCatalog(nextCatalog);
        setLinks(nextLinks);
      },
      (cause: unknown) => {
        if (active) setState(deviceSentence(cause, 'load backing links'));
      },
    );
    return () => {
      active = false;
    };
  }, []);

  const presets =
    catalog?.items.filter(
      (item) =>
        (item.kind === 'owned' || item.kind === 'rig') &&
        !item.archived &&
        !item.superseded,
    ) ?? [];
  const choices = presets.filter((item) => scope === 'rig' || item.in_set_list);
  const name = (target: Target) =>
    presets.find((item) => targetKey(item) === targetKey(target.preset))
      ?.name ?? 'Unavailable preset';
  const mine =
    links?.links.filter(
      (entry) => entry.mix.source === mix.source && entry.mix.mix === mix.mix,
    ) ?? [];
  const item = choices.find((candidate) => targetKey(candidate) === selected);
  const current = links?.links.find(
    (entry) =>
      entry.target.scope === scope &&
      targetKey(entry.target.preset) === selected,
  );
  const linked =
    current?.mix.source === mix.source && current.mix.mix === mix.mix;

  async function update(target: Target, remove: boolean) {
    if (!links) return;
    setBusy(true);
    setState('');
    try {
      const next = await songLinks({
        expected: links.revision,
        target,
        mix: remove ? null : mix,
      });
      setLinks(next);
      setSelected('');
      setState(
        remove
          ? `Unlinked from ${name(target)}.`
          : `Linked. Cue it from ${name(target)} in ${scope === 'rig' ? 'Rig' : 'the Set list'}.`,
      );
      window.dispatchEvent(new Event(LINK_CHANGE));
    } catch (cause) {
      setState(deviceSentence(cause, 'update the backing link'));
      void songLinks().then(setLinks, () => {});
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-w-0 content-start gap-3">
      <h4>
        <LinkSimple aria-hidden="true" />
        Plays with
      </h4>
      {links && !mine.length && (
        <Caption>
          Not linked yet. Link it to a rig or Set list entry to cue it from
          there.
        </Caption>
      )}
      {!!mine.length && (
        <ul className="m-0 grid list-none gap-1 p-0 [&>li]:flex [&>li]:min-w-0 [&>li]:flex-wrap [&>li]:items-center [&>li]:gap-2">
          {mine.map((entry) => (
            <li key={`${entry.target.scope}:${targetKey(entry.target.preset)}`}>
              <span>
                <strong>{name(entry.target)}</strong>
                <Caption as="span"> · {SCOPE_WORD[entry.target.scope]}</Caption>
              </span>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Unlink from ${name(entry.target)}`}
                title="Unlink"
                disabled={busy}
                onClick={() => void update(entry.target, true)}
              >
                <X aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      {catalog && (
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <SegmentedControl
            aria-label="Link to"
            value={scope}
            onValueChange={(value) => {
              if (value === 'rig' || value === 'set_list') {
                setScope(value);
                setSelected('');
              }
            }}
          >
            <Segment value="set_list">Set list entry</Segment>
            <Segment value="rig">Saved rig</Segment>
          </SegmentedControl>
          <select
            aria-label={scope === 'rig' ? 'Saved rig' : 'Set list entry'}
            value={selected}
            disabled={busy || !choices.length}
            onChange={(event) => setSelected(event.target.value)}
          >
            <option value="">
              {choices.length
                ? 'Choose…'
                : scope === 'rig'
                  ? 'No saved rigs yet'
                  : 'Set list is empty'}
            </option>
            {choices.map((entry) => (
              <option key={targetKey(entry)} value={targetKey(entry)}>
                {entry.name}
              </option>
            ))}
          </select>
          <Button
            variant="outline"
            disabled={busy || !item || linked}
            onClick={() =>
              item &&
              void update(
                { scope, preset: { kind: item.kind, id: item.id } },
                false,
              )
            }
          >
            {linked ? 'Linked' : current ? 'Replace link' : 'Link'}
          </Button>
        </div>
      )}
      {current && !linked && (
        <Caption>
          {name(current.target)} currently plays “
          {current.title ?? 'an unavailable mix'}”. Linking replaces it.
        </Caption>
      )}
      {state && <Caption role="status">{state}</Caption>}
    </div>
  );
}

/** Only cues after the player explicitly chooses it. */
export function CueLinkedMix({
  preset,
  scope,
  disabled,
}: {
  preset: Target['preset'];
  scope: Target['scope'];
  disabled: boolean;
}) {
  const { ready } = useSessionMedia();
  const [links, setLinks] = useState<SongLinks | null>(null);
  const { id, kind } = preset;
  useEffect(() => {
    if (!ready) return;
    let current = true;
    const refresh = () =>
      void songLinks().then(
        (value) => {
          if (current) setLinks(value);
        },
        () => {},
      );
    refresh();
    window.addEventListener(LINK_CHANGE, refresh);
    return () => {
      current = false;
      window.removeEventListener(LINK_CHANGE, refresh);
    };
  }, [ready, id, kind, scope]);
  const find = (state: SongLinks | null) =>
    state?.links.find(
      (entry) =>
        entry.target.scope === scope &&
        entry.target.preset.id === id &&
        entry.target.preset.kind === kind,
    );
  const link = find(links);
  if (!ready || !link) return null;
  return (
    <CueBackingButton
      title={link.title ?? 'Mix unavailable'}
      asset={link.asset}
      disabled={disabled}
      resolve={async () => {
        const latest = await songLinks();
        setLinks(latest);
        return find(latest)?.asset;
      }}
    />
  );
}

/** Resolve the selected occurrence and its latest rendered mix only upon a deliberate cue. */
export function CueEntryBacking({
  row,
  disabled,
}: {
  row: SetOrder['entries'][number];
  disabled: boolean;
}) {
  const media = useSessionMedia();
  const { track, mix } = row.entry.settings;
  if (!media.ready || !track) return null;
  const name =
    media.tracks.find((t) => t.id === track)?.title ?? 'Linked track';
  return (
    <CueBackingButton
      title={mix ? name + ' · saved mix' : name}
      asset={mix ? undefined : track}
      available={true}
      disabled={disabled}
      resolve={async () => {
        const current = (await setOrder()).entries.find(
          (r) => r.entry.id === row.entry.id,
        )?.entry.settings;
        if (!current || current.track !== track || current.mix !== mix)
          throw new Error('The entry changed. Reopen it before cueing.');
        return mix
          ? (await songView(track)).mixes.find((m) => m.id === mix)?.asset
          : track;
      }}
    />
  );
}
function CueBackingButton({
  title,
  asset,
  available = !!asset,
  disabled,
  resolve,
}: {
  title: string;
  asset?: string | null;
  available?: boolean;
  disabled: boolean;
  resolve: () => Promise<string | null | undefined>;
}) {
  const { player, pending, send } = useSessionMedia();
  const { ask, dialog } = useConfirm();
  const [error, setError] = useState('');
  const [resolving, setResolving] = useState(false);
  const cued = !!asset && player?.track?.id === asset;
  async function cue() {
    if (resolving) return;
    setResolving(true);
    setError('');
    try {
      const asset = await resolve();
      if (!asset) {
        setError('This backing mix is no longer available.');
        return;
      }
      if (
        player?.state === 'playing' &&
        player.track?.id !== asset &&
        !(await ask({
          title: 'Cue this backing mix?',
          body: `“${player.track?.title ?? 'Another track'}” is playing. It stops and this mix is cued.`,
          confirm: 'Stop and cue',
        }))
      )
        return;
      await send({ kind: 'cue', asset });
    } catch (cause) {
      setError(deviceSentence(cause, 'cue the backing mix'));
    } finally {
      setResolving(false);
    }
  }
  return (
    <div
      className="flex min-w-0 flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-3 text-sm [&>svg]:size-4 [&>svg]:shrink-0"
      data-missing={!available || undefined}
    >
      <MusicNotes aria-hidden="true" />
      <span className="min-w-0 flex-1 font-semibold break-words">
        <Caption as="span">Backing </Caption>
        {title}
      </span>
      <Button
        variant="outline"
        disabled={disabled || !available || cued || pending || resolving}
        onClick={() => void cue()}
      >
        {cued ? 'Cued' : 'Cue backing'}
      </Button>
      {error && (
        <Caption as="span" role="alert">
          {error}
        </Caption>
      )}
      {dialog}
    </div>
  );
}
