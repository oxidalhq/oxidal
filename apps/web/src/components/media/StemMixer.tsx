/**
 * One row per stem: Mute, Solo, level and an optional WAV download. Used by
 * the stem editor and by the backing player while stems play live, where
 * every change is heard at once and can be saved to the mix.
 *
 * @see docs/media.md#stem-mix-recipes
 */
import { DownloadSimple, Faders } from '@phosphor-icons/react';
import { useState } from 'react';

import { Button } from '@oxidal/design-system/components/button';
import { StemStrip } from '@oxidal/design-system/widgets/stem-strip';

import { type PlayerSnapshot, saveSongMix, songView } from '../../api';
import { deviceSentence } from '../../lib/friendlyError';
import {
  mixSourceOf,
  useProtect,
  useSessionMedia,
  useStemMixSender,
} from './sessionMedia';
import {
  audible,
  controls,
  formatGain,
  GAIN_MAX,
  GAIN_MIN,
  type Recipe,
  ROLE_ORDER,
  roleLabel,
  sameRecipe,
  type StemControls,
  type StemRole,
  withControls,
} from './stemMix';

export function StemMixer({
  roles,
  recipe,
  disabled,
  slow,
  download,
  onChange,
  onCommit,
}: {
  roles: StemRole[];
  recipe: Recipe;
  disabled: boolean;
  /** E-paper: 1 dB step buttons instead of sliders. */
  slow: boolean;
  download?: (role: StemRole) => string;
  /** `dragging` is true while a slider moves; `onCommit` ends the drag. */
  onChange: (next: Recipe, dragging: boolean) => void;
  onCommit: () => void;
}) {
  return (
    <ul
      className={
        slow ? 'grid min-w-0 gap-3' : 'flex gap-3 overflow-x-auto px-1 pb-1'
      }
      aria-label="Stem controls"
      data-slot={slow ? undefined : 'stem-mixer'}
    >
      {roles.map((role) => (
        <StemRow
          key={role}
          role={role}
          settings={controls(recipe, role)}
          heard={audible(recipe, roles, role)}
          disabled={disabled}
          slow={slow}
          download={download?.(role)}
          onChange={(next, dragging) =>
            onChange(withControls(recipe, role, next), dragging)
          }
          onCommit={onCommit}
        />
      ))}
    </ul>
  );
}

function StemRow({
  role,
  settings,
  heard,
  disabled,
  slow,
  download,
  onChange,
  onCommit,
}: {
  role: StemRole;
  settings: StemControls;
  heard: boolean;
  disabled: boolean;
  slow: boolean;
  download?: string;
  onChange: (next: StemControls, dragging: boolean) => void;
  onCommit: () => void;
}) {
  const label = roleLabel(role);
  const gain = settings.gain_tenths_db;
  const set = (next: Partial<StemControls>) =>
    onChange({ ...settings, ...next }, false);
  const step = (delta: number) =>
    set({
      gain_tenths_db: Math.min(GAIN_MAX, Math.max(GAIN_MIN, gain + delta)),
    });
  return (
    <li
      className={
        slow
          ? 'grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-t border-border py-2 first:border-0 data-[silent]:text-muted-foreground sm:grid-cols-[minmax(4.5rem,1fr)_auto_minmax(6rem,1fr)_auto]'
          : 'grid shrink-0 justify-items-center gap-1'
      }
      data-silent={!heard || undefined}
      data-download={download ? '' : undefined}
    >
      {slow ? (
        <>
          <span className="min-w-0 text-sm font-semibold break-words">
            {label}
          </span>
          <div className="flex min-w-0 flex-wrap items-center gap-1">
            <Button
              variant="outline"
              size="icon"
              className="min-h-touch"
              aria-label={`Mute ${label}`}
              aria-pressed={settings.muted}
              title={`Mute ${label}`}
              disabled={disabled}
              onClick={() => set({ muted: !settings.muted })}
            >
              M
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="min-h-touch"
              aria-label={`Solo ${label}`}
              aria-pressed={settings.solo}
              title={`Solo ${label}`}
              disabled={disabled}
              onClick={() => set({ solo: !settings.solo })}
            >
              S
            </Button>
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-1">
            <Button
              variant="outline"
              size="icon"
              aria-label={`Lower ${label}`}
              disabled={disabled || gain <= GAIN_MIN}
              onClick={() => step(-10)}
            >
              −
            </Button>
            <Button
              variant="outline"
              size="icon"
              aria-label={`Raise ${label}`}
              disabled={disabled || gain >= GAIN_MAX}
              onClick={() => step(10)}
            >
              +
            </Button>
          </div>
        </>
      ) : (
        <StemStrip
          role={role}
          controls={{
            level: gain / 10,
            muted: settings.muted,
            solo: settings.solo,
          }}
          heard={heard}
          minimumLevel={GAIN_MIN / 10}
          className="h-64"
          disabled={disabled}
          onChange={(next) => {
            const nextGain = Math.round(next.level * 10);
            onChange(
              { gain_tenths_db: nextGain, muted: next.muted, solo: next.solo },
              nextGain !== gain,
            );
          }}
          onCommit={onCommit}
        />
      )}
      <button
        type="button"
        className="inline-flex min-h-touch items-center justify-center rounded-md px-2 font-mono text-sm whitespace-nowrap tabular-nums focus-visible:outline-2 disabled:opacity-50"
        aria-label={`${label} ${formatGain(gain)}. Reset to 0 dB`}
        title="Reset to 0 dB"
        disabled={disabled || gain === 0}
        onClick={() => set({ gain_tenths_db: 0 })}
      >
        {formatGain(gain)}
      </button>
      {download && (
        <Button variant="ghost" size="icon" asChild>
          <a
            href={download}
            download
            aria-label={`Download ${label} WAV`}
            title={`Download ${label} WAV`}
          >
            <DownloadSimple aria-hidden="true" />
          </a>
        </Button>
      )}
    </li>
  );
}

type LiveStems = NonNullable<PlayerSnapshot['stems']>;

/** The player's Stems section, shown while a mix or song plays as stems. */
export function LiveStemsPanel() {
  const { player } = useSessionMedia();
  const live = player?.stems;
  const track = player?.track;
  if (!live || !track) return null;
  return (
    <LiveStemsBody
      key={`${track.id}:${live.split}`}
      live={live}
      trackId={track.id}
    />
  );
}

function LiveStemsBody({
  live,
  trackId,
}: {
  live: LiveStems;
  trackId: string;
}) {
  const { tracks, slow, refreshLibrary } = useSessionMedia();
  const protect = useProtect();
  const sendMix = useStemMixSender();
  const [recipe, setRecipe] = useState(live.recipe);
  const [baseline, setBaseline] = useState(live.recipe);
  const [seenRecipe, setSeenRecipe] = useState(live.recipe);
  if (!sameRecipe(seenRecipe, live.recipe)) {
    setSeenRecipe(live.recipe);
    setRecipe(live.recipe);
  }
  const [state, setState] = useState('');
  const [saving, setSaving] = useState(false);
  // The logical mix stays the same across saves, though its render changes.
  const [mixId] = useState(() => {
    const asset = tracks.find((track) => track.id === trackId);
    const details = asset?.provenance as { splitMix?: { mix?: string } } | null;
    return asset && mixSourceOf(asset) === live.source
      ? (details?.splitMix?.mix ?? null)
      : null;
  });
  const song = tracks.find((track) => track.id === live.source);
  const changed = !sameRecipe(recipe, baseline);

  function change(next: Recipe) {
    setRecipe(next);
    setState('');
    void sendMix({ split: live.split, expected: recipe, recipe: next });
  }

  async function save() {
    setSaving(true);
    setState('');
    try {
      const view = await songView(live.source);
      const mix = mixId ? view.mixes.find((item) => item.id === mixId) : null;
      const row = await saveSongMix(live.source, {
        title: mix?.title ?? `${song?.title ?? 'Song'} mix`.slice(0, 120),
        split: live.split,
        recipe,
        replace: mix ? { id: mix.id, revision: mix.revision } : null,
      });
      setBaseline(recipe);
      setState(`Saved to “${row.title}”.`);
      refreshLibrary();
    } catch (cause) {
      setState(deviceSentence(cause, 'save the mix'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section
      className="grid min-w-0 content-start gap-3"
      aria-labelledby="live-stems-title"
    >
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-2 [&>h2]:m-0 [&>h3]:m-0 [&>h3]:text-base [&>h3]:font-semibold">
        <h3 id="live-stems-title">
          <Faders aria-hidden="true" /> Stems
        </h3>
        <span className="caption">Changes are heard as you make them</span>
      </div>
      <StemMixer
        roles={ROLE_ORDER.filter((role) => live.roles.includes(role))}
        recipe={recipe}
        disabled={false}
        slow={slow}
        onChange={(next) => change(next)}
        onCommit={() => {}}
      />
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Button
          variant="ghost"
          disabled={!changed}
          onClick={() => change(baseline)}
        >
          Reset
        </Button>
        <span className="flex-1" role="status">
          {state || (changed ? 'Not saved' : '')}
        </span>
        <Button
          variant="outline"
          disabled={!changed || saving || protect}
          title={protect ? 'Turn Protect off to save' : undefined}
          onClick={() => void save()}
        >
          {saving ? 'Saving…' : mixId ? 'Save to this mix' : 'Save as a mix'}
        </Button>
      </div>
    </section>
  );
}
