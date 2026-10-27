import { useState } from 'react';
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
  const [selected, setSelected] = useState('');
  const [request, setRequest] = useState<
    Omit<AudioProbe, 'endpoint' | 'direction'>
  >({
    sample_rate: 48000,
    channels: 2,
    format: 's16',
    period_frames: 128,
    periods: 3,
  });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const endpoint = inventory?.endpoints.find(
    (e) => `${e.id}/${e.direction}` === selected,
  );
  async function refresh() {
    setBusy(true);
    setMessage('');
    setSelected('');
    setInput(null);
    setOutput(null);
    setInventory(null);
    try {
      const devices = await audioDevices();
      setInventory(devices);
      setMessage(
        !devices.backend_available
          ? devices.warnings.join(' ')
          : devices.endpoints.length === 0
            ? 'No hardware audio endpoints found. Authoring remains available.'
            : 'Choose an endpoint to check. No device is selected for playback.',
      );
    } catch (error) {
      setMessage(String(error));
    } finally {
      setBusy(false);
    }
  }
  async function probe() {
    if (!endpoint) return;
    setBusy(true);
    setMessage('');
    invalidate(endpoint.direction);
    try {
      const result = await probeAudio({
        ...request,
        endpoint: endpoint.id,
        direction: endpoint.direction,
      });
      if (result.configuration.direction === 'capture')
        setInput(result.configuration);
      else setOutput(result.configuration);
      setMessage(
        `Settings accepted: ${result.configuration.sample_rate} Hz, ${result.configuration.channels} channels, ${result.buffer_frames} buffer frames. Interface released. This is not a playback or latency test.`,
      );
    } catch (error) {
      setMessage(String(error));
    } finally {
      setBusy(false);
    }
  }
  function invalidate(direction?: AudioProbe['direction']) {
    if (direction === 'capture') setInput(null);
    if (direction === 'playback') setOutput(null);
  }
  function update<K extends keyof typeof request>(
    key: K,
    value: (typeof request)[K],
  ) {
    setMessage('');
    invalidate(endpoint?.direction);
    setRequest((previous) => ({ ...previous, [key]: value }));
  }
  return (
    <section className="panel control-stack" aria-label="Audio devices">
      <h2>Audio devices</h2>
      <p className="caption">
        Check your interface, then start a saved preset.
      </p>
      <Button
        variant="outline"
        disabled={busy || !connected}
        onClick={() => void refresh()}
      >
        Refresh audio devices
      </Button>
      {inventory?.backend_available && inventory.endpoints.length > 0 && (
        <>
          <fieldset
            disabled={busy || !connected}
            className="audio-probe-fields"
          >
            <legend>Configuration check</legend>
            <div className="form-grid">
              <label className="field">
                Audio endpoint
                <select
                  value={selected}
                  onChange={(e) => {
                    setSelected(e.target.value);
                    invalidate(
                      inventory.endpoints.find(
                        (candidate) =>
                          `${candidate.id}/${candidate.direction}` ===
                          e.target.value,
                      )?.direction,
                    );
                    setMessage('');
                  }}
                >
                  <option value="">Choose a device and direction</option>
                  {inventory.endpoints.map((e) => (
                    <option
                      key={`${e.id}/${e.direction}`}
                      value={`${e.id}/${e.direction}`}
                    >
                      {e.name} · {e.direction} · {e.id}
                    </option>
                  ))}
                </select>
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
                Channel count
                <input
                  type="number"
                  min={1}
                  max={64}
                  value={request.channels}
                  onChange={(e) => update('channels', Number(e.target.value))}
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
                Smaller buffers reduce delay but need more processing headroom.
                Periods set queued capacity; this is not measured round-trip
                latency.
              </p>
              <p>
                Check input and output separately. A check briefly opens and
                releases the device; it does not start playback or save the
                setup.
              </p>
            </details>
            <Button
              variant="outline"
              disabled={!endpoint}
              onClick={() => void probe()}
            >
              Check audio settings
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
      <PlaybackSettings connected={connected} input={input} output={output} />
      <p role="status">{busy ? 'Inspecting audio…' : message}</p>
    </section>
  );
}
