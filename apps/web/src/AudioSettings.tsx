import { useCallback, useEffect, useRef, useState } from 'react';

import { Button } from '@oxidal/design-system/components/button';
import { Card } from '@oxidal/design-system/components/card';
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
  SettingDisclosure,
  SettingGroup,
  SettingRow,
} from '@oxidal/design-system/patterns/settings-page';

import {
  type AudioDevices,
  audioDevices,
  type AudioProbe,
  probeAudio,
  type StartAudio,
} from './api';
import { InterfaceRoutingSlot } from './audioSettingsShared';
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
  /** Device's disclosures, kept open across a change of audio owner. */
  const [openParts, setOpenParts] = useState({
    interface: false,
    check: false,
  });
  /** Where the running session's Interface routing is drawn (under Device). */
  const [routingSlot, setRoutingSlot] = useState<HTMLDivElement | null>(null);
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
  /** Each interface once, by its ALSA id, whichever directions it has. */
  const interfaces = [
    ...new Map(
      (inventory?.endpoints ?? []).map((endpoint) => [endpoint.id, endpoint]),
    ).values(),
  ];
  const chosenInterface = selectedInput || selectedOutput;
  /** Check the chosen interface both ways, where it has each direction. */
  function chooseInterface(id: string) {
    setSelectedInput(inputEndpoints.some((e) => e.id === id) ? id : '');
    setSelectedOutput(outputEndpoints.some((e) => e.id === id) ? id : '');
    invalidate();
    setMessage('');
  }
  /** "Name · 2 in, 2 out" for the session's interface, else the chosen one. */
  function interfaceCaption(stream?: StartAudio['stream']) {
    const id = stream?.input.endpoint ?? chosenInterface;
    const name =
      inventory?.endpoints.find((endpoint) => endpoint.id === id)?.name ?? id;
    if (!name)
      return inventory ? 'No interface chosen' : 'Looking for interfaces…';
    return stream
      ? `${name} · ${stream.input.channels} in, ${stream.output.channels} out`
      : name;
  }
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
        <section aria-label="Audio devices" className="grid min-w-0">
          <h2 className="sr-only">Audio device</h2>
          <InterfaceRoutingSlot.Provider value={routingSlot}>
            <PlaybackSettings
              connected={connected}
              input={input}
              output={output}
              level={<MasterLevel layout="page" />}
              device={(stream) => (
                <SettingGroup title="Device">
                  <SettingRow
                    id="audio-interface"
                    label="Audio interface"
                    caption={interfaceCaption(stream)}
                  >
                    <Select
                      value={chosenInterface || undefined}
                      disabled={busy || !connected || interfaces.length === 0}
                      onValueChange={chooseInterface}
                    >
                      <SelectTrigger
                        id="audio-interface"
                        size="sm"
                        aria-label="Interface to check"
                        className="w-auto max-w-72"
                      >
                        <SelectValue
                          placeholder={
                            interfaces.length === 0
                              ? 'No interface found'
                              : 'Choose an interface'
                          }
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {interfaces.map((endpoint) => (
                          <SelectItem key={endpoint.id} value={endpoint.id}>
                            {endpoint.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </SettingRow>
                  <div
                    ref={setRoutingSlot}
                    className="grid min-w-0 empty:hidden"
                  />
                  <SettingDisclosure
                    label="Interface and buffers"
                    open={openParts.interface}
                    onOpenChange={(open) =>
                      setOpenParts((old) => ({ ...old, interface: open }))
                    }
                  >
                    <section
                      aria-label="Interface and buffers"
                      className="grid min-w-0 gap-3"
                    >
                      <Caption>
                        Connected interfaces appear automatically. Check input
                        and output before starting a new playback session.
                      </Caption>
                      <Button
                        size="sm"
                        variant="outline"
                        className="justify-self-start"
                        disabled={busy || !connected}
                        onClick={() => void refresh()}
                      >
                        Refresh audio devices
                      </Button>
                      <p role="status" className="text-sm">
                        {busy ? 'Inspecting audio…' : message}
                      </p>
                      {inventory && inventory.warnings.length > 0 && (
                        <SettingDisclosure label="Technical detail">
                          {inventory.warnings.map((warning, index) => (
                            <Caption key={index}>{warning}</Caption>
                          ))}
                        </SettingDisclosure>
                      )}
                    </section>
                  </SettingDisclosure>
                  {inventory?.backend_available && (
                    <SettingDisclosure
                      label="Configuration check"
                      open={openParts.check}
                      onOpenChange={(open) =>
                        setOpenParts((old) => ({ ...old, check: open }))
                      }
                    >
                      <fieldset
                        disabled={busy || !connected}
                        className="grid min-w-0 gap-3 border-0 p-0 [&_select]:max-w-full"
                      >
                        <legend className="sr-only">Configuration check</legend>
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
                                update(
                                  'output_channels',
                                  Number(e.target.value),
                                )
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
                          {[16, 32, 64, 128, 256, 512, 1024, 2048].map(
                            (size) => (
                              <option key={size} value={size} />
                            ),
                          )}
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
                    </SettingDisclosure>
                  )}
                </SettingGroup>
              )}
            />
          </InterfaceRoutingSlot.Provider>
        </section>
      </TabsContent>
    </Tabs>
  );
}
