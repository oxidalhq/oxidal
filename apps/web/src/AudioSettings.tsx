import { useCallback, useEffect, useRef, useState } from 'react';
import { EngineSettings } from './EngineSettings';
import { MasterLevel } from './MasterLevel';
import { NativeDefaults } from './NativeDefaults';
import { PlaybackSettings } from './PlaybackSettings';
import {
  audioDevices,
  probeAudio,
  type AudioDevices,
  type AudioProbe,
} from './api';
import { Button } from './components/ui/button';

/** Hardware inspection only; playback lifecycle stays separate from the editor service.
 * @see docs/audio.md
 */
export function AudioSettings({ connected }: { connected: boolean }) {
  const [input, setInput] = useState<AudioProbe | null>(null);
  const [output, setOutput] = useState<AudioProbe | null>(null);
  const [inventory, setInventory] = useState<AudioDevices | null>(null);
  const [selectedInput, setSelectedInput] = useState('');
  const [selectedOutput, setSelectedOutput] = useState('');
  const [request, setRequest] = useState({
    sample_rate: 48000,
    input_channels: 1,
    output_channels: 2,
    format: 's16',
    period_frames: 128,
    periods: 3,
  });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const refreshing = useRef(false);
  const inputEndpoint = inventory?.endpoints.find(
    (endpoint) =>
      endpoint.direction === 'capture' && endpoint.id === selectedInput,
  );
  const outputEndpoint = inventory?.endpoints.find(
    (endpoint) =>
      endpoint.direction === 'playback' && endpoint.id === selectedOutput,
  );
  const inputEndpoints =
    inventory?.endpoints.filter(
      (endpoint) => endpoint.direction === 'capture',
    ) ?? [];
  const outputEndpoints =
    inventory?.endpoints.filter(
      (endpoint) => endpoint.direction === 'playback',
    ) ?? [];
  const refresh = useCallback(async () => {
    if (refreshing.current) return;
    refreshing.current = true;
    setBusy(true);
    setMessage('');
    setInput(null);
    setOutput(null);
    setInventory(null);
    try {
      const devices = await audioDevices();
      const inputs = devices.endpoints.filter(
        (endpoint) => endpoint.direction === 'capture',
      );
      const outputs = devices.endpoints.filter(
        (endpoint) => endpoint.direction === 'playback',
      );
      setInventory(devices);
      setSelectedInput((current) =>
        inputs.some((endpoint) => endpoint.id === current)
          ? current
          : inputs.length === 1
            ? inputs[0]!.id
            : '',
      );
      setSelectedOutput((current) => {
        const matchingInput =
          inputs.length === 1
            ? outputs.find((endpoint) => endpoint.id === inputs[0]!.id)
            : undefined;
        if (matchingInput) return matchingInput.id;
        if (outputs.some((endpoint) => endpoint.id === current)) return current;
        return outputs.length === 1 ? outputs[0]!.id : '';
      });
      setMessage(
        !devices.backend_available
          ? devices.warnings.join(' ')
          : devices.endpoints.length === 0
            ? 'No hardware audio endpoints found. Authoring remains available.'
            : `Found ${inputs.length} input${inputs.length === 1 ? '' : 's'} and ${outputs.length} output${outputs.length === 1 ? '' : 's'}. Check both before starting audio.`,
      );
    } catch (error) {
      setMessage(String(error));
    } finally {
      refreshing.current = false;
      setBusy(false);
    }
  }, []);
  useEffect(() => {
    if (!connected) return;
    const request = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(request);
  }, [connected, refresh]);
  async function check() {
    if (!inputEndpoint || !outputEndpoint) return;
    setBusy(true);
    setMessage('');
    invalidate();
    try {
      const shared = {
        sample_rate: request.sample_rate,
        format: request.format as AudioProbe['format'],
        period_frames: request.period_frames,
        periods: request.periods,
      };
      const checkedInput = await probeAudio({
        ...shared,
        endpoint: inputEndpoint.id,
        direction: 'capture',
        channels: request.input_channels,
      });
      const checkedOutput = await probeAudio({
        ...shared,
        endpoint: outputEndpoint.id,
        direction: 'playback',
        channels: request.output_channels,
      });
      setInput(checkedInput.configuration);
      setOutput(checkedOutput.configuration);
      setMessage(
        `Input and output accepted at ${request.sample_rate} Hz · ${request.period_frames} × ${request.periods}. Interface released; choose a preset and start audio below.`,
      );
    } catch (error) {
      setMessage(String(error));
    } finally {
      setBusy(false);
    }
  }
  function invalidate() {
    setInput(null);
    setOutput(null);
  }
  function update<K extends keyof typeof request>(
    key: K,
    value: (typeof request)[K],
  ) {
    setMessage('');
    invalidate();
    setRequest((previous) => ({ ...previous, [key]: value }));
  }
  return (
    <section className="panel control-stack" aria-label="Audio devices">
      <h2>Audio</h2>
      <MasterLevel />
      <section
        className="audio-diagnostics"
        aria-labelledby="audio-interface-setup"
      >
        <h3 id="audio-interface-setup">Audio interface setup</h3>
        <p className="caption">
          Connected interfaces appear automatically. Check input and output here
          before starting a new playback session.
        </p>
        <Button
          variant="outline"
          disabled={busy || !connected}
          onClick={() => void refresh()}
        >
          Refresh audio devices
        </Button>
        {inventory?.backend_available && (
          <>
            <fieldset
              disabled={busy || !connected}
              className="audio-probe-fields"
            >
              <legend>Configuration check</legend>
              <div className="form-grid">
                <label className="field">
                  Input
                  <select
                    aria-label="Input"
                    value={selectedInput}
                    disabled={inputEndpoints.length === 0}
                    onChange={(e) => {
                      setSelectedInput(e.target.value);
                      invalidate();
                      setMessage('');
                    }}
                  >
                    <option value="">
                      {inputEndpoints.length === 0
                        ? 'No input detected'
                        : 'Choose an input'}
                    </option>
                    {inputEndpoints.map((endpoint) => (
                      <option key={endpoint.id} value={endpoint.id}>
                        {endpoint.name} · {endpoint.id}
                      </option>
                    ))}
                  </select>
                  {inputEndpoints.length === 0 && (
                    <span className="caption">
                      {outputEndpoints.length > 0
                        ? 'HDMI and other playback-only devices cannot receive your guitar. Connect or reconnect a USB audio interface, then refresh.'
                        : 'No audio input is connected. Connect or reconnect a USB audio interface, then refresh.'}
                    </span>
                  )}
                </label>
                <label className="field">
                  Output
                  <select
                    aria-label="Output"
                    value={selectedOutput}
                    disabled={outputEndpoints.length === 0}
                    onChange={(e) => {
                      setSelectedOutput(e.target.value);
                      invalidate();
                      setMessage('');
                    }}
                  >
                    <option value="">
                      {outputEndpoints.length === 0
                        ? 'No output detected'
                        : 'Choose an output'}
                    </option>
                    {outputEndpoints.map((endpoint) => (
                      <option key={endpoint.id} value={endpoint.id}>
                        {endpoint.name} · {endpoint.id}
                      </option>
                    ))}
                  </select>
                  {outputEndpoints.length === 0 && (
                    <span className="caption">
                      Connect an audio output, then refresh.
                    </span>
                  )}
                </label>
                <label className="field">
                  Sample rate (Hz)
                  <input
                    type="number"
                    min={8000}
                    max={192000}
                    value={request.sample_rate}
                    onChange={(e) =>
                      update('sample_rate', Number(e.target.value))
                    }
                  />
                </label>
                <label className="field">
                  Input channels
                  <input
                    type="number"
                    min={1}
                    max={64}
                    value={request.input_channels}
                    onChange={(e) =>
                      update('input_channels', Number(e.target.value))
                    }
                  />
                </label>
                <label className="field">
                  Output channels
                  <input
                    type="number"
                    min={1}
                    max={64}
                    value={request.output_channels}
                    onChange={(e) =>
                      update('output_channels', Number(e.target.value))
                    }
                  />
                </label>
                <label className="field">
                  Sample format
                  <select
                    value={request.format}
                    onChange={(e) =>
                      update('format', e.target.value as AudioProbe['format'])
                    }
                  >
                    <option value="s16">16-bit integer</option>
                    <option value="s24">24-bit in 32-bit container</option>
                    <option value="s24_packed">24-bit packed</option>
                    <option value="s32">32-bit integer</option>
                    <option value="float">32-bit float</option>
                  </select>
                </label>
                <label className="field">
                  Buffer size (samples per period)
                  <input
                    type="number"
                    min={16}
                    max={8192}
                    value={request.period_frames}
                    onChange={(e) =>
                      update('period_frames', Number(e.target.value))
                    }
                  />
                </label>
                <label className="field">
                  Buffer periods
                  <input
                    type="number"
                    min={2}
                    max={8}
                    value={request.periods}
                    onChange={(e) => update('periods', Number(e.target.value))}
                  />
                </label>
              </div>
              <details className="control-help">
                <summary>Buffers &amp; configuration checks</summary>
                <p>
                  Smaller buffers reduce delay but need more processing
                  headroom. Periods set queued capacity; this is not measured
                  round-trip latency.
                </p>
                <p>
                  The check opens and releases input, then output. It does not
                  start playback or save the setup.
                </p>
              </details>
              <Button
                variant="outline"
                disabled={!inputEndpoint || !outputEndpoint}
                onClick={() => void check()}
              >
                Check input and output
              </Button>
            </fieldset>
          </>
        )}
        {inventory?.backend_available &&
          inventory.warnings.map((warning, index) => (
            <p key={index} className="muted">
              {warning}
            </p>
          ))}
        <p role="status">{busy ? 'Inspecting audio…' : message}</p>
      </section>
      <PlaybackSettings connected={connected} input={input} output={output} />
      <EngineSettings connected={connected} />
      <NativeDefaults connected={connected} />
    </section>
  );
}
