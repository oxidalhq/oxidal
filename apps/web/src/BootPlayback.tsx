import { useState } from 'react';
import { Button } from './components/ui/button';
import {
  graphAudioCommand,
  graphAudioState,
  type GraphAudioState,
  playbackCommand,
  playbackState,
  rigAudioCommand,
  rigAudioState,
  type AudioState,
  type RigAudioState,
} from './api';

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
      setError(String(cause));
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
  return (
    <div className="control-stack">
      <Button
        variant="outline"
        disabled={disabled || busy || (!selected && !invalid && !running)}
        onClick={() => void toggle()}
      >
        {invalid
          ? 'Clear invalid boot setup'
          : selected
            ? 'Disable boot playback'
            : 'Use this session on boot'}
      </Button>
      {error && <p role="alert">{error}</p>}
      <details className="control-help">
        <summary>Boot playback</summary>
        <p className="caption">
          Captures the confirmed sound and device setup when enabled. Only one
          session starts on boot. Later edits do not change it; disable and
          enable again to replace it. Stop keeps this preference.
        </p>
        {native?.boot_error && <p role="alert">{native.boot_error}</p>}
      </details>
    </div>
  );
}
