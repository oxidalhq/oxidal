import { useState } from 'react';
import { Button } from './components/ui/button';
import {
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
  disabled,
  onNative,
  onMixed,
}: {
  native: AudioState | null;
  mixed: RigAudioState | null;
  disabled: boolean;
  onNative: (state: AudioState) => void;
  onMixed: (state: RigAudioState) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const selected = native?.start_on_boot || mixed?.start_on_boot;
  const invalid = !!native?.boot_error;
  const running = native?.phase === 'running' || mixed?.phase === 'running';
  async function toggle() {
    setBusy(true);
    setError('');
    try {
      if (mixed?.start_on_boot) {
        onMixed(
          await rigAudioCommand(mixed, { kind: 'set_boot', enabled: false }),
        );
      } else if (native && (native.start_on_boot || invalid)) {
        onNative(
          await playbackCommand(native, { kind: 'set_boot', enabled: false }),
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
        const [audio, rig] = await Promise.all([
          playbackState(),
          rigAudioState(),
        ]);
        onNative(audio);
        onMixed(rig);
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
