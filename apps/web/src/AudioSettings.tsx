import { Tabs, TabsContent, TabsList, TabsTrigger } from './components/ui/tabs';
import { useWorkspaceState } from './workspaceMemory';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './components/ui/select';

/** Hardware inspection only; playback lifecycle stays separate from the editor service.
 * @see docs/audio.md
 */
export function AudioSettings({ connected }: { connected: boolean }) {
  // The engine tab is a peer of the device, not buried under it (7.17).
  const [tab, setTab] = useWorkspaceState<'device' | 'engine'>(
    'settings-audio-tab',
    'device',
  );
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
          ? 'Audio interfaces cannot be listed on this device.'
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
    <Tabs
      value={tab}
      onValueChange={(value) => {
        if (value === 'device' || value === 'engine') setTab(value);
      }}
    >
      <TabsList aria-label="Audio sections">
        <TabsTrigger value="device">Audio device</TabsTrigger>
        <TabsTrigger value="engine">TONE3000 engine</TabsTrigger>
      </TabsList>
      <TabsContent value="engine">
        <section className="panel control-stack" aria-label="TONE3000 engine">
          <EngineSettings connected={connected} />
          <NativeDefaults connected={connected} />
        </section>
      </TabsContent>
      <TabsContent value="device">
        <section className="panel control-stack" aria-label="Audio devices">
          <h2 className="sr-only">Audio device</h2>
          <section
            className="audio-diagnostics"
            aria-labelledby="audio-interface-setup"
          >
            <h3 id="audio-interface-setup">Audio interface setup</h3>
            <p className="caption">
              Connected interfaces appear automatically. Check input and output
              here before starting a new playback session.
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
                      <Select
                        value={selectedInput || undefined}
                        disabled={inputEndpoints.length === 0}
                        onValueChange={(value) => {
                          setSelectedInput(value);
                          invalidate();
                          setMessage('');
                        }}
                      >
                        <SelectTrigger aria-label="Input">
                          <SelectValue
                            placeholder={
                              inputEndpoints.length === 0
                                ? 'No input detected'
                                : 'Choose an input'
                            }
                          />
                        </SelectTrigger>
                        <SelectContent>
                          {inputEndpoints.map((endpoint) => (
                            <SelectItem key={endpoint.id} value={endpoint.id}>
                              {endpoint.name} · {endpoint.id}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
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
                      <Select
                        value={selectedOutput || undefined}
                        disabled={outputEndpoints.length === 0}
                        onValueChange={(value) => {
                          setSelectedOutput(value);
                          invalidate();
                          setMessage('');
                        }}
                      >
                        <SelectTrigger aria-label="Output">
                          <SelectValue
                            placeholder={
                              outputEndpoints.length === 0
                                ? 'No output detected'
                                : 'Choose an output'
                            }
                          />
                        </SelectTrigger>
                        <SelectContent>
                          {outputEndpoints.map((endpoint) => (
                            <SelectItem key={endpoint.id} value={endpoint.id}>
                              {endpoint.name} · {endpoint.id}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
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
                      <Select
                        value={request.format}
                        onValueChange={(value) =>
                          update('format', value as AudioProbe['format'])
                        }
                      >
                        <SelectTrigger aria-label="Sample format">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="s16">16-bit integer</SelectItem>
                          <SelectItem value="s24">
                            24-bit in 32-bit container
                          </SelectItem>
                          <SelectItem value="s24_packed">
                            24-bit packed
                          </SelectItem>
                          <SelectItem value="s32">32-bit integer</SelectItem>
                          <SelectItem value="float">32-bit float</SelectItem>
                        </SelectContent>
                      </Select>
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
                        onChange={(e) =>
                          update('periods', Number(e.target.value))
                        }
                      />
                    </label>
                  </div>
                  <details className="control-help">
                    <summary>Buffers &amp; configuration checks</summary>
                    <p>
                      Smaller buffers reduce delay but need more processing
                      headroom. Periods set queued capacity; this is not
                      measured round-trip latency.
                    </p>
                    <p>
                      The check opens and releases input, then output. It does
                      not start playback or save the setup.
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
            <p role="status">{busy ? 'Inspecting audio…' : message}</p>
            {inventory && inventory.warnings.length > 0 && (
              <details className="control-help">
                <summary>Technical detail</summary>
                {inventory.warnings.map((warning, index) => (
                  <p key={index}>{warning}</p>
                ))}
              </details>
            )}
          </section>
          <MasterLevel />
          <PlaybackSettings
            connected={connected}
            input={input}
            output={output}
          />
        </section>
      </TabsContent>
    </Tabs>
  );
}
