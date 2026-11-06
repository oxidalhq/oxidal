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
  const selectedNow =
    native?.start_on_boot || mixed?.start_on_boot || effects?.start_on_boot;
  useEffect(() => {
    let alive = true;
    void startupState()
      .then((s) => alive && setStartup(s))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [selectedNow]);
  /** Off, Last played (follows each preset you play) or Pinned (exact version). */
  async function choose(policy: 'off' | 'follow' | 'pinned') {
    if (busy) return;
    if (policy === 'off') {
      if (selectedNow) await toggle();
      return;
    }
    if (!selectedNow) await toggle();
    setBusy(true);
    try {
      setStartup(await setStartupFollow(policy === 'follow'));
    } catch (cause) {
      setError(friendlyError(cause, 'change what starts with Oxidal'));
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
        <fieldset className="space-y-2" disabled={disabled || busy}>
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
                'This exact version',
                'Keeps the sound playing now, even after later edits.',
              ],
            ] as const
          ).map(([value, label, help]) => (
            <label key={value} className="flex items-start gap-2">
              <input
                type="radio"
                name="startup-policy"
                className="mt-1"
                checked={policy === value}
                disabled={value !== 'off' && !selected && !running}
                onChange={() => void choose(value)}
              />
              <span>
                {label}
                <span className="caption block">{help}</span>
              </span>
            </label>
          ))}
        </fieldset>
      )}
      {error && <p role="alert">{error}</p>}
      <details className="control-help">
        <summary>Automatic startup</summary>
        <p className="caption">
          Startup uses the confirmed sound and audio setup. With Last played,
          each preset you start or switch to replaces it; browsing does not.
          With This exact version, later edits do not change it. Missing
          hardware or files leave audio stopped with a message; Oxidal never
          picks a different sound. Stop keeps this preference.
        </p>
        {native?.boot_error && <p role="alert">{native.boot_error}</p>}
      </details>
    </div>
  );
}
