import { useEffect, useState } from 'react';
import {
  playbackState,
  playbackCommand,
  presetLibrary,
  nativeState,
  type AudioState,
  type AudioAction,
  type AudioProbe,
  type StartAudio,
} from './api';
import { Button } from './components/ui/button';

/** Audio ownership is independent of silent authoring. @see docs/audio.md */
export function PlaybackSettings({
  connected,
  input,
  output,
}: {
  connected: boolean;
  input: AudioProbe | null;
  output: AudioProbe | null;
}) {
  const [state, setState] = useState<AudioState | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [presets, setPresets] = useState<
    { id: string; owned: boolean; name: string }[]
  >([]);
  const [selected, setSelected] = useState('');
  const [inputMap, setInputMap] = useState<[number, number]>([0, 1]);
  const [outputMap, setOutputMap] = useState<[number, number]>([0, 1]);
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const next = await playbackState();
        if (active) setState(next);
      } catch (cause) {
        if (active) setError(String(cause));
      } finally {
        if (active) timer = setTimeout(() => void refresh(), 1500);
      }
    }
    void refresh();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, []);
  async function loadPresets() {
    setBusy(true);
    setError('');
    try {
      const originals = await presetLibrary();
      const native = await nativeState().catch(() => null);
      setPresets([
        ...originals.map((p) => ({ id: p.sha256, owned: false, name: p.name })),
        ...(native?.owned ?? []).map((p) => ({
          id: p.id,
          owned: true,
          name: `${p.preset.name} (saved copy)`,
        })),
      ]);
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  }
  async function command(action: AudioAction) {
    if (!state) return;
    setBusy(true);
    setError('');
    try {
      setState(await playbackCommand(state, action));
    } catch (cause) {
      setError(String(cause));
    } finally {
      try {
        setState(await playbackState());
      } catch {
        /* Keep last known state; do not assume stopped. */
      }
      setBusy(false);
    }
  }
  const preset = presets.find((p) => `${p.owned}/${p.id}` === selected);
  const settings: StartAudio | null =
    input && output && preset
      ? {
          stream: { input, output, input_map: inputMap, output_map: outputMap },
          preset_id: preset.id,
          owned: preset.owned,
        }
      : null;
  const unavailable = !state || state.phase === 'unavailable';
  const transitioning =
    state?.phase === 'starting' || state?.phase === 'stopping';
  return (
    <section aria-label="Playback controls">
      <h3>Audio playback</h3>
      <p>
        Stop audio releases the interface while keeping the library and silent
        authoring open. Saved presets play in a separate session; editing a
        draft does not change its sound.
      </p>
      <p role="status">
        Audio: {state?.phase ?? 'checking'}
        {state?.device_owned ? ' · interface reserved' : ''}
      </p>
      {unavailable ? (
        <p className="muted">
          Experimental Linux playback is not enabled. Silent authoring remains
          available.
        </p>
      ) : (
        <>
          <p className="muted">
            Experimental playback — physical audio and live performance are not
            qualified yet. No automatic start or device fallback.
          </p>
          <div className="toolbar">
            <Button
              disabled={
                !connected || busy || transitioning || !state?.device_owned
              }
              onClick={() => void command({ kind: 'stop' })}
            >
              Stop audio
            </Button>
            <Button
              variant="outline"
              disabled={
                !connected || busy || transitioning || !state?.configured
              }
              onClick={() => void command({ kind: 'restart' })}
            >
              Restart audio
            </Button>
            <Button
              variant="outline"
              disabled={
                !connected ||
                busy ||
                transitioning ||
                state?.device_owned ||
                !state?.configured
              }
              onClick={() =>
                state?.configured &&
                void command({ kind: 'start', settings: state.configured })
              }
            >
              Resume saved session
            </Button>
          </div>
          <p>
            To hand the interface to another application, stop audio and wait
            for “stopped”. Launch the application separately; close its audio
            session before resuming here.
          </p>
          <fieldset
            disabled={
              !connected || busy || transitioning || state?.device_owned
            }
          >
            <legend>New playback session</legend>
            <p>
              Check input and output above, then choose a saved preset. Both
              directions must use the same hardware endpoint, rate and period
              size.
            </p>
            <p>
              Input:{' '}
              {input
                ? `${input.endpoint}, ${input.channels} channels`
                : 'Not checked'}{' '}
              · Output:{' '}
              {output
                ? `${output.endpoint}, ${output.channels} channels`
                : 'Not checked'}
            </p>
            <Button variant="outline" onClick={() => void loadPresets()}>
              Refresh saved presets
            </Button>
            <div className="form-grid">
              <label className="field">
                Playback preset
                <select
                  value={selected}
                  onChange={(e) => setSelected(e.target.value)}
                >
                  <option value="">Select saved preset</option>
                  {presets.map((p) => (
                    <option
                      key={`${p.owned}/${p.id}`}
                      value={`${p.owned}/${p.id}`}
                    >
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              {(
                [
                  'Input left',
                  'Input right',
                  'Output left',
                  'Output right',
                ] as const
              ).map((label, i) => {
                const capture = i < 2;
                const index = (i % 2) as 0 | 1;
                const values = capture ? inputMap : outputMap;
                return (
                  <label key={label} className="field">
                    {label} channel (1-based)
                    <input
                      type="number"
                      min={1}
                      max={(capture ? input : output)?.channels ?? 64}
                      value={values[index] + 1}
                      onChange={(e) => {
                        const next: [number, number] = [...values];
                        next[index] = Number(e.target.value) - 1;
                        if (capture) setInputMap(next);
                        else setOutputMap(next);
                      }}
                    />
                  </label>
                );
              })}
            </div>
            <p className="muted">
              Use the same input channel twice for mono input. Use the same
              output channel twice for an equal stereo-to-mono mix.
            </p>
            <Button
              disabled={!settings}
              onClick={() =>
                settings && void command({ kind: 'start', settings })
              }
            >
              Start audio
            </Button>
          </fieldset>
        </>
      )}
      {(error || state?.error) && <p role="alert">{error || state?.error}</p>}
    </section>
  );
}
