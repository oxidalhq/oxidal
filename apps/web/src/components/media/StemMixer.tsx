/**
 * One row per stem: Mute, Solo, level and an optional WAV download. Used by
 * the stem editor and by the backing player while stems play live, where
 * every change is heard at once and can be saved to the mix.
 *
 * @see docs/media.md#stem-mix-recipes
 */
import { useState } from 'react';
import { DownloadSimple, Faders } from '@phosphor-icons/react';
import { saveSongMix, songView, type PlayerSnapshot } from '../../api';
import { deviceSentence } from '../../lib/friendlyError';
import { Button } from '../ui/button';
import { Slider } from '../ui/slider';
import {
  mixSourceOf,
  useProtect,
  useSessionMedia,
  useStemMixSender,
} from './sessionMedia';
import {
  GAIN_MAX,
  GAIN_MIN,
  ROLE_ORDER,
  audible,
  controls,
  formatGain,
  roleLabel,
  sameRecipe,
  withControls,
  type Recipe,
  type StemControls,
  type StemRole,
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
    <ul className="stem-mixer" aria-label="Stem controls">
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
      className="stem-row"
      data-silent={!heard || undefined}
      data-download={download ? '' : undefined}
    >
      <span className="stem-row-name">{label}</span>
      <div className="stem-row-toggles">
        <Button
          variant="outline"
          size="icon"
          className="stem-toggle"
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
          className="stem-toggle"
          aria-label={`Solo ${label}`}
          aria-pressed={settings.solo}
          title={`Solo ${label}`}
          disabled={disabled}
          onClick={() => set({ solo: !settings.solo })}
        >
          S
        </Button>
      </div>
      {slow ? (
        <div className="stem-row-steps">
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
      ) : (
        <Slider
          className="stem-row-level"
          aria-label={`${label} level`}
          min={GAIN_MIN}
          max={GAIN_MAX}
          step={5}
          value={[gain]}
          disabled={disabled}
          onValueChange={([value]) =>
            onChange({ ...settings, gain_tenths_db: value ?? 0 }, true)
          }
          onValueCommit={onCommit}
        />
      )}
      <button
        type="button"
        className="stem-row-gain media-mono"
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
    void sendMix(next);
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
    <section className="practice" aria-labelledby="live-stems-title">
      <div className="stem-section-head">
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
      <div className="stem-save">
        <Button
          variant="ghost"
          disabled={!changed}
          onClick={() => change(baseline)}
        >
          Reset
        </Button>
        <span className="stem-save-spacer" role="status">
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
