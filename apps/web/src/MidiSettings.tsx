import { useEffect, useRef, useState } from 'react';
import { MidiControls } from './SceneMidi';
import {
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
      const opening = generation.current;
      try {
        const [a, b] = await Promise.all([playbackState(), rigAudioState()]);
        if (active && !sending.current && opening === generation.current) {
          setNative(a);
          setMixed(b);
          setError('');
        }
      } catch (cause) {
        if (active) setError(String(cause));
      } finally {
        if (active) timer = setTimeout(() => void refresh(), 750);
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
  return (
    <section className="panel space-y-3" aria-label="MIDI device settings">
      <h2>Controller &amp; assignments</h2>
      {(applyError || error) && <p role="alert">{applyError || error}</p>}
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
              target: { kind: 'native', node: 'native', parameter: c.target },
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
              setApplyError(String(cause));
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
              setApplyError(String(cause));
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
            : 'Play a preset to configure its MIDI assignments. Effects-only MIDI configuration is not available here yet.'}
        </p>
      )}
    </section>
  );
}
