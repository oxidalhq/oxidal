import { useCallback, useEffect, useRef, useState } from 'react';

import { Button } from '@oxidal/design-system/components/button';
import { Card, CardHeader } from '@oxidal/design-system/components/card';
import {
  ActionRow,
  FormField,
  FormGrid,
} from '@oxidal/design-system/components/form-layout';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@oxidal/design-system/components/select';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@oxidal/design-system/components/tabs';
import { Caption } from '@oxidal/design-system/components/text';

import {
  type AudioDevices,
  audioDevices,
  type AudioProbe,
  probeAudio,
} from './api';
import { VenueEq } from './components/media/VenueEq';
import { EngineSettings } from './EngineSettings';
import { friendlyError } from './lib/friendlyError';
import { leaveScreen } from './lib/leaveGuard';
import { MasterLevel } from './MasterLevel';
import { NativeDefaults } from './NativeDefaults';
import { PlaybackSettings } from './PlaybackSettings';
import { useWorkspaceState } from './workspaceMemory';

/** Hardware inspection only; playback lifecycle stays separate from the editor service.
 * @see docs/audio.md
 */
export function AudioSettings({ connected }: { connected: boolean }) {
  // The engine tab is a peer of the device, not buried under it (7.17).
  const [tab, setTab] = useWorkspaceState<'device' | 'output' | 'engine'>(
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
      setMessage(friendlyError(error, 'change the audio settings'));
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
      setMessage(friendlyError(error, 'change the audio settings'));
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
      activationMode="manual"
      value={tab}
      onValueChange={(value) => {
        if (value === 'device' || value === 'output' || value === 'engine')
          leaveScreen(() => setTab(value));
      }}
    >
      <TabsList aria-label="Audio sections">
        <TabsTrigger value="device">Audio device</TabsTrigger>
        <TabsTrigger value="output">Output</TabsTrigger>
        <TabsTrigger value="engine">TONE3000 engine</TabsTrigger>
      </TabsList>
      <TabsContent value="output">
        <Caption>
          Master level and Mono (under Audio device) apply after the mix and
          Venue EQ.
        </Caption>
        <VenueEq connected={connected} />
      </TabsContent>
      <TabsContent value="engine">
        <Card
          className="grid min-w-0 items-start gap-3 [&>button]:max-w-full [&>button]:justify-self-start"
          aria-label="TONE3000 engine"
        >
          <EngineSettings connected={connected} />
          <NativeDefaults connected={connected} />
        </Card>
      </TabsContent>
      <TabsContent value="device">
        <Card
          className="grid min-w-0 items-start gap-3 [&>button]:max-w-full [&>button]:justify-self-start"
          aria-label="Audio devices"
        >
          <h2 className="sr-only">Audio device</h2>
          <PlaybackSettings
            connected={connected}
            input={input}
            output={output}
            level={<MasterLevel />}
            interfaceCard={
              <Card aria-labelledby="audio-interface-setup">
                <CardHeader>
                  <h3 id="audio-interface-setup">Interface and buffers</h3>
                  <Button
                    variant="outline"
                    disabled={busy || !connected}
                    onClick={() => void refresh()}
                  >
                    Refresh audio devices
                  </Button>
                </CardHeader>
                <Caption>
                  Connected interfaces appear automatically. Check input and
                  output before starting a new playback session.
                </Caption>
                {inventory?.backend_available && (
                  <>
                    <fieldset
                      disabled={busy || !connected}
                      className="grid min-w-0 gap-3 border-0 p-0 [&_select]:max-w-full"
                    >
                      <legend className="mb-2 text-md font-semibold">
                        Configuration check
                      </legend>
                      <FormGrid>
                        <FormField>
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
                                <SelectItem
                                  key={endpoint.id}
                                  value={endpoint.id}
                                >
                                  {endpoint.name} · {endpoint.id}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {inputEndpoints.length === 0 && (
                            <Caption as="span">
                              {outputEndpoints.length > 0
                                ? 'HDMI and other playback-only devices cannot receive your guitar. Connect or reconnect a USB audio interface, then refresh.'
                                : 'No audio input is connected. Connect or reconnect a USB audio interface, then refresh.'}
                            </Caption>
                          )}
                        </FormField>
                        <FormField>
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
                                <SelectItem
                                  key={endpoint.id}
                                  value={endpoint.id}
                                >
                                  {endpoint.name} · {endpoint.id}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {outputEndpoints.length === 0 && (
                            <Caption as="span">
                              Connect an audio output, then refresh.
                            </Caption>
                          )}
                        </FormField>
                        <FormField>
                          Sample rate (Hz)
                          <input
                            type="number"
                            list="audio-sample-rates"
                            min={8000}
                            max={192000}
                            value={request.sample_rate}
                            onChange={(e) =>
                              update('sample_rate', Number(e.target.value))
                            }
                          />
                        </FormField>
                        <FormField>
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
                        </FormField>
                        <FormField>
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
                        </FormField>
                        <FormField>
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
                              <SelectItem value="s16">
                                16-bit integer
                              </SelectItem>
                              <SelectItem value="s24">
                                24-bit in 32-bit container
                              </SelectItem>
                              <SelectItem value="s24_packed">
                                24-bit packed
                              </SelectItem>
                              <SelectItem value="s32">
                                32-bit integer
                              </SelectItem>
                              <SelectItem value="float">
                                32-bit float
                              </SelectItem>
                            </SelectContent>
                          </Select>
                        </FormField>
                        <FormField>
                          Buffer size (samples per period)
                          <input
                            type="number"
                            list="audio-buffer-sizes"
                            min={16}
                            max={8192}
                            value={request.period_frames}
                            onChange={(e) =>
                              update('period_frames', Number(e.target.value))
                            }
                          />
                        </FormField>
                        <FormField>
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
                        </FormField>
                      </FormGrid>
                      <datalist id="audio-sample-rates">
                        {[44100, 48000, 88200, 96000].map((rate) => (
                          <option key={rate} value={rate} />
                        ))}
                      </datalist>
                      <datalist id="audio-buffer-sizes">
                        {[16, 32, 64, 128, 256, 512, 1024, 2048].map((size) => (
                          <option key={size} value={size} />
                        ))}
                      </datalist>
                      <Caption aria-label="Queued audio">
                        ≈{' '}
                        {(
                          ((request.period_frames * request.periods) /
                            Math.max(1, request.sample_rate)) *
                          1000
                        ).toFixed(1)}{' '}
                        ms queued ({request.period_frames} × {request.periods}{' '}
                        at {(request.sample_rate / 1000).toFixed(1)} kHz).
                        Smaller buffers lower delay but need more processing
                        headroom; this is not measured round-trip latency.
                      </Caption>
                      <ActionRow>
                        <Button
                          variant="outline"
                          disabled={!inputEndpoint || !outputEndpoint}
                          onClick={() => void check()}
                        >
                          Check input and output
                        </Button>
                        <Caption role="status">
                          {busy ? 'Inspecting audio…' : message}
                        </Caption>
                      </ActionRow>
                      <Caption>
                        The check opens and releases input, then output. It
                        never plays or saves the setup.
                      </Caption>
                    </fieldset>
                  </>
                )}
                {!inventory?.backend_available && (
                  <p role="status">{busy ? 'Inspecting audio…' : message}</p>
                )}
                {inventory && inventory.warnings.length > 0 && (
                  <details className="border-y border-border py-1 text-sm [&>p]:mb-3 [&>p]:text-muted-foreground [&>summary]:flex [&>summary]:min-h-touch [&>summary]:cursor-pointer [&>summary]:items-center [&>summary]:justify-between [&>summary]:gap-3 [&>summary]:font-medium [&>summary]:after:text-lg [&>summary]:after:text-muted-foreground [&>summary]:after:content-['›'] open:[&>summary]:after:content-['−']">
                    <summary>Technical detail</summary>
                    {inventory.warnings.map((warning, index) => (
                      <p key={index}>{warning}</p>
                    ))}
                  </details>
                )}
              </Card>
            }
          />
        </Card>
      </TabsContent>
    </Tabs>
  );
}
