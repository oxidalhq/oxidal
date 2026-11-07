import { friendlyError } from './lib/friendlyError';
import { useEffect, useRef, useState } from 'react';
import { MidiControls } from './SceneMidi';
import { MidiMapScreen } from './MidiMapScreen';
import {
  type MidiMap,
  playbackState,
  playbackCommand,
  rigAudioState,
  rigAudioCommand,
  type AudioState,
  type RigAudioState,
} from './api';

/** Settings and Rig configure the same sounding MIDI owner. */
export function MidiSettings({ connected }: { connected: boolean }) {
  const [native, setNative] = useState<AudioState | null>(null);
  const [mixed, setMixed] = useState<RigAudioState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [applyError, setApplyError] = useState('');
  const generation = useRef(0);
  const sending = useRef(false);
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      let nextDelay = 3000;
      const opening = generation.current;
      try {
        const [a, b] = await Promise.all([playbackState(), rigAudioState()]);
        nextDelay =
          (a.phase === 'running' && a.midi?.connected) ||
          (b.phase === 'running' && b.control?.midi?.connected)
            ? 750
            : 3000;
        if (active && !sending.current && opening === generation.current) {
          setNative(a);
          setMixed(b);
          setError('');
        }
      } catch (cause) {
        if (active) setError(friendlyError(cause, 'read MIDI settings'));
      } finally {
        if (active) timer = setTimeout(() => void refresh(), nextDelay);
      }
    }
    void refresh();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, []);
  const activeNative = native?.phase === 'running';
  const activeMixed = mixed?.phase === 'running' && mixed.control;
  async function syncPlayingMap(map: MidiMap) {
    const entry = map.entries.find((candidate) => {
      if (
        activeNative &&
        native.configured &&
        !native.configured.draft &&
        native.configured.owned
      ) {
        return (
          candidate.entry.kind === 'owned' &&
          candidate.entry.id === native.configured.preset_id
        );
      }
      return (
        activeMixed &&
        mixed.configured &&
        candidate.entry.kind === 'rig' &&
        candidate.entry.id === mixed.configured.revision
      );
    });
    const settings = map.input
      ? {
          input: map.input,
          channel: map.channel,
          bindings: entry?.bindings ?? [],
          branch_bindings: entry?.branch_bindings ?? [],
          parameter_bindings: entry?.parameter_bindings ?? [],
        }
      : null;
    sending.current = true;
    generation.current++;
    setBusy(true);
    setApplyError('');
    try {
      if (activeNative) {
        setNative(await playbackCommand(native, { kind: 'midi', settings }));
      } else if (activeMixed) {
        setMixed(await rigAudioCommand(mixed, { kind: 'midi', settings }));
      }
    } catch (cause) {
      setApplyError(friendlyError(cause, 'change MIDI settings'));
      throw cause;
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }
  return (
    <section className="panel space-y-4" aria-label="MIDI device settings">
      <div className="space-y-1">
        <h2>MIDI map</h2>
        <p className="caption">
          Preset recall follows the Mine set-list. Scene and control mappings
          stay with each saved preset.
        </p>
      </div>
      {(applyError || error) && <p role="alert">{applyError || error}</p>}
      <MidiMapScreen
        connected={connected && !busy && !error}
        native={native}
        mixed={mixed}
        onMapApplied={syncPlayingMap}
      />
      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
        {activeNative ? (
          <MidiControls
            key={`native:${native.session}`}
            configured={native.configured?.midi ?? null}
            preset={
              native.configured &&
              !native.configured.draft &&
              native.configured.owned
                ? { kind: 'owned' as const, id: native.configured.preset_id }
                : undefined
            }
            disabled={!connected || busy || !!error}
            control={{
              midi: native.midi,
              scenes: null,
              branches: [],
              controls: native.controls.map((c) => ({
                target: {
                  kind: 'native',
                  node: 'native',
                  parameter: c.target,
                },
                label: c.label,
                value: c.value,
                minimum: 0,
                maximum: 1,
                integer: c.toggle,
                toggle: c.toggle,
                logarithmic: false,
                display: c.display,
              })),
            }}
            onApply={async (settings) => {
              if (sending.current) return;
              sending.current = true;
              generation.current++;
              setBusy(true);
              setApplyError('');
              try {
                setNative(
                  await playbackCommand(native, { kind: 'midi', settings }),
                );
              } catch (cause) {
                setApplyError(friendlyError(cause, 'change MIDI settings'));
              } finally {
                sending.current = false;
                setBusy(false);
              }
            }}
          />
        ) : activeMixed ? (
          <MidiControls
            key={`mixed:${mixed.session}`}
            configured={mixed.configured?.midi ?? null}
            preset={
              mixed.configured
                ? { kind: 'rig' as const, id: mixed.configured.revision }
                : undefined
            }
            control={mixed.control ?? null}
            disabled={!connected || busy || !!error}
            onApply={async (settings) => {
              if (sending.current) return;
              sending.current = true;
              generation.current++;
              setBusy(true);
              setApplyError('');
              try {
                setMixed(
                  await rigAudioCommand(mixed, { kind: 'midi', settings }),
                );
              } catch (cause) {
                setApplyError(friendlyError(cause, 'change MIDI settings'));
              } finally {
                sending.current = false;
                setBusy(false);
              }
            }}
          />
        ) : (
          <p className="caption">
            {!native || !mixed
              ? 'Reading the playing preset…'
              : 'Play a preset to add or edit its scene and control mappings.'}
          </p>
        )}
        {(activeNative || activeMixed) && (
          <span className="caption">Edit the playing preset’s assignments</span>
        )}
      </div>
    </section>
  );
}
