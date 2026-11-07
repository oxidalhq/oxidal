import { useEffect, useState } from 'react';
import { Button } from './components/ui/button';
import {
  graphAudioCommand,
  graphAudioState,
  type GraphAudioState,
  playbackCommand,
  playbackState,
  rigAudioCommand,
  rigAudioState,
  setStartupFollow,
  startupState,
  libraryCatalog,
  type StartupState,
  type AudioState,
  type RigAudioState,
} from './api';
import { friendlyError } from './lib/friendlyError';

/** A single boot choice remains reachable regardless of the current audio owner. */
export function BootPlayback({
  native,
  mixed,
  effects,
  disabled,
  onNative,
  onMixed,
  onEffects,
}: {
  native: AudioState | null;
  mixed: RigAudioState | null;
  effects: GraphAudioState | null;
  disabled: boolean;
  onNative: (state: AudioState) => void;
  onMixed: (state: RigAudioState) => void;
  onEffects: (state: GraphAudioState) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [startup, setStartup] = useState<StartupState | null>(null);
  const [namedTarget, setNamedTarget] = useState<{
    id: string;
    kind: string;
    name: string;
  } | null>(null);
  const targetName =
    namedTarget?.id === startup?.target?.id &&
    namedTarget?.kind === startup?.target?.kind
      ? namedTarget?.name
      : '';
  const selectedNow =
    native?.start_on_boot || mixed?.start_on_boot || effects?.start_on_boot;
  useEffect(() => {
    let alive = true;
    void startupState()
      .then((s) => alive && setStartup(s))
      .catch((cause) => {
        if (alive) setError(friendlyError(cause, 'read the startup choice'));
      });
    return () => {
      alive = false;
    };
  }, [
    selectedNow,
    mixed?.configured?.revision,
    native?.configured?.preset_id,
    effects?.configured?.library_id,
  ]);
  useEffect(() => {
    let alive = true;
    const target = startup?.target;
    if (target)
      void libraryCatalog()
        .then((catalog) => {
          const item = catalog.items.find(
            (item) => item.kind === target?.kind && item.id === target.id,
          );
          if (alive)
            setNamedTarget({ ...target, name: item?.name ?? 'Saved preset' });
        })
        .catch(() => {
          if (alive) setNamedTarget({ ...target, name: 'Saved preset' });
        });
    return () => {
      alive = false;
    };
  }, [startup?.target]);
  /** Off, Last played (follows each preset you play) or Pinned (exact version). */
  async function choose(policy: 'off' | 'follow' | 'pinned') {
    if (busy) return;
    if (policy === 'off') {
      if (selectedNow) await toggle();
      return;
    }
    setBusy(true);
    setError('');
    try {
      if (!startup)
        throw new Error('Read the startup choice before changing it.');
      const owner =
        mixed?.phase === 'running'
          ? 'mixed'
          : native?.phase === 'running'
            ? 'native'
            : effects?.phase === 'running'
              ? 'effects'
              : null;
      const current =
        owner === 'mixed'
          ? mixed
          : owner === 'native'
            ? native
            : owner === 'effects'
              ? effects
              : null;
      if (policy === 'pinned' && !current)
        throw new Error('Play the saved version you want to pin first.');
      setStartup(
        await setStartupFollow(policy === 'follow', {
          expected: startup,
          capture:
            current && owner
              ? { owner, session: current.session, revision: current.revision }
              : null,
        }),
      );
    } catch (cause) {
      setError(friendlyError(cause, 'change what starts with Oxidal'));
      void startupState().then(setStartup, () => {});
    } finally {
      setBusy(false);
    }
  }
  const selected =
    native?.start_on_boot || mixed?.start_on_boot || effects?.start_on_boot;
  const invalid = !!native?.boot_error;
  const running =
    native?.phase === 'running' ||
    mixed?.phase === 'running' ||
    effects?.phase === 'running';
  async function toggle() {
    setBusy(true);
    setError('');
    try {
      if (effects?.start_on_boot) {
        onEffects(
          await graphAudioCommand(effects, {
            kind: 'set_boot',
            enabled: false,
          }),
        );
      } else if (mixed?.start_on_boot) {
        onMixed(
          await rigAudioCommand(mixed, { kind: 'set_boot', enabled: false }),
        );
      } else if (native && (native.start_on_boot || invalid)) {
        onNative(
          await playbackCommand(native, { kind: 'set_boot', enabled: false }),
        );
      } else if (effects?.phase === 'running') {
        onEffects(
          await graphAudioCommand(effects, { kind: 'set_boot', enabled: true }),
        );
      } else if (mixed?.phase === 'running') {
        onMixed(
          await rigAudioCommand(mixed, { kind: 'set_boot', enabled: true }),
        );
      } else if (native?.phase === 'running') {
        onNative(
          await playbackCommand(native, { kind: 'set_boot', enabled: true }),
        );
      }
    } catch (cause) {
      setError(friendlyError(cause, 'change automatic startup'));
    } finally {
      try {
        const [audio, rig, graph] = await Promise.all([
          playbackState(),
          rigAudioState(),
          graphAudioState(),
        ]);
        onNative(audio);
        onMixed(rig);
        onEffects(graph);
      } catch {
        /* Preserve confirmed state until the next successful status poll. */
      }
      setBusy(false);
    }
  }
  if (!selected && !invalid && !running) return null;
  const policy = invalid
    ? 'off'
    : (startup?.policy ?? (selected ? 'pinned' : 'off'));
  return (
    <div className="control-stack">
      {invalid ? (
        <Button
          variant="outline"
          disabled={disabled || busy}
          onClick={() => void toggle()}
        >
          Clear invalid startup setup
        </Button>
      ) : (
        <fieldset className="space-y-2" disabled={disabled || busy || !startup}>
          <legend className="mb-1 font-medium">When Oxidal starts</legend>
          {(
            [
              ['off', 'Nothing plays', 'Start audio yourself.'],
              [
                'follow',
                'Last played preset',
                'Each preset you play becomes the startup sound.',
              ],
              [
                'pinned',
                'Pinned saved version',
                'Pins the saved version playing now. Save and play it first if you have edits.',
              ],
            ] as const
          ).map(([value, label, help]) => (
            <label key={value} className="startup-option">
              <input
                type="radio"
                name="startup-policy"
                className="mt-1"
                checked={policy === value}
                disabled={
                  value === 'pinned'
                    ? !running
                    : value !== 'off' && !selected && !running
                }
                onChange={() => void choose(value)}
              />
              <span className="startup-option-text">
                <span>{label}</span>
                {/* Not Tailwind's `block`: the project `.block` class draws a
                    tile and made each description a tall empty box (7.29). */}
                <span className="caption">{help}</span>
              </span>
            </label>
          ))}
        </fieldset>
      )}
      {startup?.target && (
        <div className="caption">
          Startup preset: {targetName || 'Reading name…'}
          <details>
            <summary>Saved version</summary>
            <code>{startup.target.id}</code>
          </details>
        </div>
      )}
      {policy === 'pinned' && running && (
        <Button
          variant="outline"
          disabled={disabled || busy || !startup}
          onClick={() => void choose('pinned')}
        >
          Pin the playing saved version
        </Button>
      )}
      {error && <p role="alert">{error}</p>}
      <details className="control-help">
        <summary>Automatic startup</summary>
        <p className="caption">
          Startup uses the confirmed sound and audio setup. With Last played,
          each preset you start or switch to replaces it; browsing does not.
          With Pinned saved version, later edits do not change it. Missing
          hardware or files leave audio stopped with a message; Oxidal never
          picks a different sound. Stop keeps this preference.
        </p>
        {native?.boot_error && <p role="alert">{native.boot_error}</p>}
      </details>
    </div>
  );
}
