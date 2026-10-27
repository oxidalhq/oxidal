import { BootPlayback } from './BootPlayback';
import { RecoveryNotice } from './RecoveryNotice';
import { useEffect, useState } from 'react';
import {
  playbackState,
  rigAudioState,
  type RigAudioState,
  graphAudioState,
  graphAudioCommand,
  playbackCommand,
  presetLibrary,
  nativeState,
  type AudioState,
  type AudioAction,
  type AudioProbe,
  type StartAudio,
} from './api';
import { Button } from './components/ui/button';
import { MixedPlaybackSettings } from './MixedPlaybackSettings';
import { AudioReconfigure } from './AudioReconfigure';

function configurationLabel(configuration: AudioProbe) {
  return `${configuration.endpoint} · ${configuration.sample_rate} Hz · ${configuration.channels} channels · ${configuration.format} · ${configuration.period_frames} samples × ${configuration.periods} periods (${configuration.period_frames * configuration.periods} samples total)`;
}

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
  const [mixed, setMixed] = useState<RigAudioState | null>(null);
  const [graphOwnsDevice, setGraphOwnsDevice] = useState(false);
  function acceptMixed(next: RigAudioState) {
    setMixed((current) =>
      current?.session === next.session && current.revision > next.revision
        ? current
        : next,
    );
  }
  const [error, setError] = useState('');
  const [graphMessage, setGraphMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [presets, setPresets] = useState<
    { id: string; owned: boolean; name: string }[]
  >([]);
  const [selected, setSelected] = useState('');
  const [inputMap, setInputMap] = useState<[number, number]>([0, 1]);
  const [outputMap, setOutputMap] = useState<[number, number]>([0, 1]);
  function accept(next: AudioState) {
    setState((current) =>
      current?.session === next.session && current.revision > next.revision
        ? current
        : next,
    );
  }
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const [next, rig, graph] = await Promise.all([
          playbackState(),
          rigAudioState(),
          graphAudioState(),
        ]);
        if (active) {
          accept(next);
          acceptMixed(rig);
          setGraphOwnsDevice(graph.device_owned);
        }
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
      accept(await playbackCommand(state, action));
    } catch (cause) {
      setError(String(cause));
    } finally {
      try {
        accept(await playbackState());
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
  const boot = (
    <BootPlayback
      native={state}
      mixed={mixed}
      disabled={
        !connected ||
        busy ||
        transitioning ||
        mixed?.phase === 'starting' ||
        mixed?.phase === 'stopping'
      }
      onNative={accept}
      onMixed={acceptMixed}
    />
  );
  if (
    mixed?.configured &&
    mixed.phase !== 'unavailable' &&
    !state?.device_owned &&
    !graphOwnsDevice
  )
    return (
      <MixedPlaybackSettings
        state={mixed}
        connected={connected}
        input={input}
        output={output}
        onState={acceptMixed}
        boot={boot}
      />
    );
  return (
    <section className="control-stack" aria-label="Playback controls">
      <h3>Audio playback</h3>
      <RecoveryNotice message={mixed?.recovery_error} />
      {input && output && (
        <div className="action-row">
          <Button
            variant="outline"
            disabled={!connected || busy}
            onClick={async () => {
              setBusy(true);
              setError('');
              setGraphMessage('');
              try {
                const graph = await graphAudioState();
                await graphAudioCommand(graph, {
                  kind: 'configure',
                  stream: {
                    input,
                    output,
                    input_map: inputMap,
                    output_map: outputMap,
                  },
                });
                setGraphMessage('Audio setup ready for New preset.');
              } catch (cause) {
                setError(String(cause));
              } finally {
                setBusy(false);
              }
            }}
          >
            Use for new rigs
          </Button>
          {graphMessage && <p role="status">{graphMessage}</p>}
        </div>
      )}

      <p role="status">
        Audio: {state?.phase ?? 'checking'}
        {state?.device_owned ? ' · interface reserved' : ''}
      </p>
      {boot}
      {unavailable ? (
        <p className="muted">
          Experimental Linux playback is not enabled. Silent authoring remains
          available.
        </p>
      ) : (
        <>
          <p className="caption">
            Prototype audio · hardware qualification pending.
          </p>
          <div className="action-row">
            {state?.device_owned ? (
              <>
                <Button
                  disabled={!connected || busy || transitioning}
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
              </>
            ) : state?.configured ? (
              <Button
                disabled={!connected || busy || transitioning}
                onClick={() => void command({ kind: 'resume' })}
              >
                Resume session
              </Button>
            ) : null}
          </div>
          <details className="control-help">
            <summary>Playback help</summary>
            <p>
              Stop releases the interface and keeps Oxidal open. Resume and
              Restart retain live adjustments. The last confirmed session is
              checkpointed for recovery after a daemon restart.
            </p>
            <p>
              To use another audio app, stop here first. Close that app’s audio
              session before resuming.
            </p>
          </details>
          {state?.configured && (
            <details
              className="control-help"
              aria-label="Playback session configuration"
            >
              <summary>Current device &amp; buffers</summary>
              <p>Input: {configurationLabel(state.configured.stream.input)}</p>
              <p>
                Output: {configurationLabel(state.configured.stream.output)}
              </p>
              <AudioReconfigure
                key={JSON.stringify(state.configured.stream)}
                initial={state.configured.stream}
                checkedInput={input}
                checkedOutput={output}
                disabled={!connected || busy || transitioning}
                running={state.phase === 'running'}
                onApply={(stream) =>
                  void command({ kind: 'reconfigure', stream })
                }
              />
            </details>
          )}
          <details className="control-help" open={!state?.configured}>
            <summary>New playback session</summary>
            <fieldset
              className="control-stack"
              disabled={
                !connected || busy || transitioning || state?.device_owned
              }
            >
              <legend className="sr-only">New playback session</legend>
              <p>
                Check input and output, then choose a preset. Use matching
                device, rate and buffer settings.
              </p>
              <p aria-label="Checked audio configuration">
                Input: {input ? configurationLabel(input) : 'Not checked'} ·
                Output: {output ? configurationLabel(output) : 'Not checked'}
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
                <details className="control-help channel-routing">
                  <summary>Channel routing</summary>
                  <div className="form-grid">
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
                  <p>
                    Repeat an input channel for mono. Repeat an output channel
                    to mix stereo to mono.
                  </p>
                </details>
              </div>
              <Button
                disabled={!settings}
                onClick={() =>
                  settings && void command({ kind: 'start', settings })
                }
              >
                Start audio
              </Button>
            </fieldset>{' '}
          </details>
        </>
      )}
      {(error || state?.error) && <p role="alert">{error || state?.error}</p>}
    </section>
  );
}
