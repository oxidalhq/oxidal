import { WorkspaceMemory, useWorkspaceNavigation } from './workspaceMemory';
import { GuitarSettings } from './GuitarSettings';
import { MidiSettings } from './MidiSettings';
import { GlobalTuner } from './GlobalTuner';
import { DevicePower } from './DevicePower';
import { EffectPacks } from './EffectPacks';
import { StorageLock } from './StorageLock';
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  ArrowsSplit,
  Power,
  WarningCircle,
  Waveform,
  Stack,
  ChartLine,
  Guitar,
  GearSix,
} from '@phosphor-icons/react';
import { Button } from './components/ui/button';
import { Switch } from './components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './components/ui/tabs';
import { LiveRig } from './LiveRig';
const MixedRig = lazy(() =>
  import('./MixedRig').then((m) => ({ default: m.MixedRig })),
);
const GraphAuthor = lazy(() =>
  import('./GraphAuthor').then((m) => ({ default: m.GraphAuthor })),
);
import { useScreenSession } from './useScreenSession';
import { ResourceStrip } from './ResourceStrip';
import { refreshMonitorFeed } from './monitorFeed';
import { SignalChain } from './SignalChain';
const Library = lazy(() =>
  import('./Library').then((m) => ({ default: m.Library })),
);
const SoundCheck = lazy(() =>
  import('./SoundCheck').then((m) => ({ default: m.SoundCheck })),
);
import { DebugConsole } from './DebugConsole';
const WebTerminal = lazy(() =>
  import('./WebTerminal').then((m) => ({ default: m.WebTerminal })),
);
import { Tone3000Account } from './Tone3000Account';
import { NetworkSettings } from './NetworkSettings';
import { AudioSettings } from './AudioSettings';
import { About } from './About';
import { ControlEditor } from './ControlEditor';
import {
  capabilities,
  deviceStorage,
  parseSnapshot,
  sendCommand,
  type Action,
  type MappingFile,
  type Snapshot,
  type StorageState,
} from './api';

/** Quiet rig control over a single authoritative Rust state model.
 * @see docs/architecture.md
 */
function InstrumentApp() {
  const screen = useScreenSession();
  const [playingName, setPlayingName] = useState<string | null>(null);
  const [graphName, setGraphName] = useState<string | null>(null);
  const [mixedPresent, setMixedPresent] = useState(false);
  const [mixedName, setMixedName] = useState<string | null>(null);
  const audioRunning =
    playingName !== null || graphName !== null || mixedName !== null;
  const [state, setState] = useState<Snapshot | null>(null);
  const [connected, setConnected] = useState(false);
  const [storage, setStorage] = useState<StorageState | null>(null);
  const [simulator, setSimulator] = useState(false);
  // Example state is never a fallback for a stopped or unavailable audio engine.
  // Both an explicit development URL and server capability are required.
  const developmentSimulator =
    simulator &&
    new URLSearchParams(window.location.search).get('development') ===
      'simulator';
  const [view, setView] = useWorkspaceNavigation();
  const [tunerOpen, setTunerOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<
    | 'audio'
    | 'connections'
    | 'accounts'
    | 'midi'
    | 'effects'
    | 'display'
    | 'device'
    | 'maintenance'
    | 'about'
  >('audio');
  const settingsLabels = {
    audio: 'Audio setup',
    connections: 'Network',
    accounts: 'Accounts',
    midi: 'MIDI controls',
    effects: 'Effects',
    display: 'Display',
    device: 'Device',
    maintenance: 'Maintenance',
    about: 'About Oxidal',
  };
  const [displayMode, setDisplayMode] = useState(() => {
    try {
      const saved = localStorage.getItem('oxidal.display');
      // `orchid` was the default before the Oxidal identity.
      if (saved === 'orchid') return 'default';
      return saved && ['default', 'sunlight', 'stage', 'epaper'].includes(saved)
        ? saved
        : 'default';
    } catch {
      return 'default';
    }
  });
  useEffect(() => {
    document.documentElement.dataset.display = displayMode;
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute(
        'content',
        displayMode === 'stage'
          ? '#0c0c0b'
          : displayMode === 'default'
            ? '#1b1a17'
            : '#000000',
      );
    try {
      localStorage.setItem('oxidal.display', displayMode);
    } catch {
      /* The selection still works when browser storage is unavailable. */
    }
  }, [displayMode]);
  const [focusedBlock, setFocusedBlock] = useState('nam-a');
  const [error, setError] = useState('');
  const [validation, setValidation] = useState('');
  const [draft, setDraft] = useState('');
  const [midiValue, setMidiValue] = useState(64);
  const [cc, setCc] = useState(21);
  const [channel, setChannel] = useState(1);
  const [target, setTarget] = useState('nam-a.level');
  const [mode, setMode] = useState<'absolute' | 'relative_twos_complement'>(
    'absolute',
  );
  const [minimum, setMinimum] = useState(0);
  const [maximum, setMaximum] = useState(1);
  const [curve, setCurve] = useState<'linear' | 'logarithmic'>('linear');
  const [learning, setLearning] = useState(false);
  const learnArmed = useRef(false);
  const [pickup, setPickup] = useState(false);
  const [feedback, setFeedback] = useState(true);
  const accept = useCallback((next: Snapshot, expectedSession?: string) => {
    setState((previous) => {
      if (previous && expectedSession && previous.session !== expectedSession)
        return previous;
      return !previous ||
        previous.session !== next.session ||
        next.revision >= previous.revision
        ? next
        : previous;
    });
    if (learnArmed.current && next.origin === 'midi' && next.last_midi) {
      setCc(next.last_midi.cc);
      setChannel(next.last_midi.channel);
      learnArmed.current = false;
      setLearning(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    let events: EventSource | null = null;
    const open = () => {
      events?.close();
      const source = new EventSource('/api/v1/events');
      events = source;
      source.addEventListener('state', (event: MessageEvent<string>) => {
        try {
          const next = parseSnapshot(JSON.parse(event.data));
          if (active && events === source) {
            accept(next);
            setConnected(true);
            refreshMonitorFeed();
          }
        } catch {
          if (active) {
            setError('Device sent incompatible state');
            setConnected(false);
          }
        }
      });
      events.onerror = () => {
        if (active) setConnected(false);
      };
      void capabilities()
        .then((info) => {
          if (active) setSimulator(info.midi_transport === 'simulator');
        })
        .catch((e: unknown) => {
          if (active) setError(String(e));
        });
    };
    const offline = () => {
      events?.close();
      if (active) setConnected(false);
    };
    window.addEventListener('offline', offline);
    window.addEventListener('online', open);
    open();
    return () => {
      active = false;
      events?.close();
      window.removeEventListener('offline', offline);
      window.removeEventListener('online', open);
    };
  }, [accept]);

  useEffect(() => {
    let active = true;
    if (connected)
      void deviceStorage()
        .then((next) => {
          if (active) setStorage(next);
        })
        .catch(() => {
          if (active) setStorage(null);
        });
    return () => {
      active = false;
    };
  }, [connected]);

  function showSettings() {
    const mapping = state?.mappings.mappings[0];
    if (mapping) {
      setCc(mapping.cc);
      setChannel(mapping.channel);
      setTarget(mapping.target);
      setMode(mapping.mode);
      setMinimum(mapping.min);
      setMaximum(mapping.max);
      setCurve(mapping.curve);
      setPickup(mapping.pickup);
      setFeedback(mapping.feedback);
    }
    setView('settings');
  }

  async function run(action: Action, structural = false) {
    setError('');
    try {
      const next = await sendCommand(
        action,
        structural ? (state?.revision ?? null) : null,
        state?.session ?? '',
      );
      accept(next, state?.session);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to update device');
    }
  }
  async function routing(parallel: boolean) {
    if (!state) return;
    const rig = structuredClone(state.rig);
    rig.nodes = rig.nodes.filter((node) => node.id !== 'nam-b');
    rig.edges = rig.edges.filter(
      (edge) => edge.from !== 'nam-b' && edge.to !== 'nam-b',
    );
    if (parallel) {
      rig.nodes.splice(2, 0, { id: 'nam-b', kind: 'nam', level: 0.5 });
      rig.edges.push(
        { from: 'input', to: 'nam-b' },
        { from: 'nam-b', to: 'delay' },
      );
    }
    await run({ type: 'routing', rig }, true);
  }
  async function validateDraft() {
    try {
      const rig: unknown = JSON.parse(draft || JSON.stringify(state?.rig));
      const response = await fetch('/api/v1/rig/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rig),
      });
      const result: unknown = await response.json();
      if (
        !response.ok ||
        !result ||
        typeof result !== 'object' ||
        !('valid' in result) ||
        !('errors' in result) ||
        !Array.isArray(result.errors)
      )
        throw new Error('Invalid rig payload');
      setValidation(result.valid ? 'Rig is valid' : result.errors.join(' · '));
    } catch {
      setValidation('Invalid JSON or rig payload');
    }
  }
  function saveMapping() {
    const file: MappingFile = {
      version: 1,
      mappings: [
        {
          id: 'knob-1',
          device: 'simulator',
          channel,
          cc,
          target,
          mode,
          pickup,
          feedback,
          min: minimum,
          max: maximum,
          curve,
        },
      ],
    };
    void run({ type: 'mappings', file }, true);
  }
  const parallel = state?.rig.nodes.some((node) => node.id === 'nam-b');
  const named = (id: string) => state?.rig.nodes.find((node) => node.id === id);
  const selectedBlock = named(focusedBlock) ? focusedBlock : 'nam-a';
  const blockNames: Record<string, string> = {
    'nam-a': 'NAM A',
    'nam-b': 'NAM B',
    delay: 'Delay',
    reverb: 'Reverb',
    output: 'Output',
  };

  return (
    <div className="app-shell" data-view={view}>
      <header className="masthead">
        <a className="wordmark" href="/" aria-label="Oxidal home">
          <span className="brand-wordmark" aria-hidden="true" />
        </a>

        <nav aria-label="Instrument navigation">
          {(['rig', 'guitars', 'library', 'monitor', 'settings'] as const).map(
            (destination) => (
              <Button
                key={destination}
                variant="ghost"
                aria-current={view === destination ? 'page' : undefined}
                onClick={() =>
                  destination === 'settings'
                    ? showSettings()
                    : setView(destination)
                }
              >
                {
                  {
                    rig: <Waveform aria-hidden="true" />,
                    guitars: <Guitar aria-hidden="true" />,
                    library: <Stack aria-hidden="true" />,
                    monitor: <ChartLine aria-hidden="true" />,
                    settings: <GearSix aria-hidden="true" />,
                  }[destination]
                }
                {
                  {
                    rig: 'Rig',
                    guitars: 'Guitars',
                    library: 'Library',
                    monitor: 'Sound Check',
                    settings: 'Settings',
                  }[destination]
                }
              </Button>
            ),
          )}
        </nav>
      </header>
      {tunerOpen && (
        <GlobalTuner
          onClose={() => setTunerOpen(false)}
          slow={displayMode === 'epaper'}
        />
      )}
      <ResourceStrip
        displayMode={displayMode}
        connected={connected}
        onDetails={() => setView('monitor')}
        onTuner={() => setTunerOpen(true)}
      />
      <div className="workspace">
        <main>
          <div
            className={
              view === 'rig' && audioRunning ? 'sr-only' : 'page-heading'
            }
          >
            <div>
              <span className="eyebrow">
                {view === 'rig'
                  ? audioRunning
                    ? 'Playing'
                    : developmentSimulator
                      ? 'Development simulator'
                      : 'Rig'
                  : view === 'guitars'
                    ? 'Guitars'
                    : view === 'monitor'
                      ? 'Sound Check'
                      : view === 'library'
                        ? 'Library'
                        : 'Settings'}
              </span>
              <h1 data-testid="active-preset">
                {view === 'rig'
                  ? (playingName ??
                    graphName ??
                    mixedName ??
                    (!developmentSimulator
                      ? 'No preset playing'
                      : !state
                        ? 'Connecting'
                        : state.preset === 'custom'
                          ? 'Custom routing'
                          : state.preset === 'parallel'
                            ? 'Parallel rig'
                            : 'Serial rig'))
                  : view === 'guitars'
                    ? 'Your guitars'
                    : view === 'monitor'
                      ? 'Instrument health'
                      : view === 'library'
                        ? 'Library'
                        : settingsLabels[settingsSection]}
              </h1>
            </div>
            {state &&
              view === 'rig' &&
              developmentSimulator &&
              !audioRunning && (
                <div className="performance-actions preset-controls">
                  <label className="field">
                    Example preset
                    <Select
                      disabled={!connected}
                      value={state.preset}
                      onValueChange={(value) =>
                        void run(
                          {
                            type: 'set',
                            target: 'rig.preset',
                            value: value === 'parallel' ? 1 : 0,
                          },
                          true,
                        )
                      }
                    >
                      <SelectTrigger aria-label="Example preset">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="custom" disabled>
                          Custom routing
                        </SelectItem>
                        <SelectItem value="serial">Serial</SelectItem>
                        <SelectItem value="parallel">Parallel</SelectItem>
                      </SelectContent>
                    </Select>
                  </label>
                  <Button
                    className="bypass-switch"
                    variant="outline"
                    disabled={!connected}
                    aria-pressed={state.bypassed}
                    onClick={() =>
                      void run({
                        type: 'set',
                        target: 'rig.bypass',
                        value: state.bypassed ? 0 : 1,
                      })
                    }
                  >
                    <Power size={20} aria-hidden="true" />
                    {state.bypassed ? 'Bypass on' : 'Bypass off'}
                  </Button>
                </div>
              )}
          </div>
          {view === 'rig' && developmentSimulator && !audioRunning && (
            <div className="notice rig-status">
              <WarningCircle size={18} aria-hidden="true" />
              <span>
                <strong>Development simulator · no audio.</strong>
              </span>
              <Button
                variant="outline"
                onClick={() => {
                  setSettingsSection('audio');
                  showSettings();
                }}
              >
                Audio setup
              </Button>
            </div>
          )}
          {error && (
            <div className="error" role="alert">
              {error}
            </div>
          )}
          {!state ? (
            <p className="empty">Waiting for Oxidal…</p>
          ) : view === 'guitars' ? (
            <GuitarSettings />
          ) : view === 'monitor' ? (
            <Suspense fallback={<p>Loading Sound Check…</p>}>
              <SoundCheck
                connected={connected}
                displayMode={displayMode}
                onGuitars={() => setView('guitars')}
                onLibrary={() => setView('library')}
                onAudioSetup={() => {
                  setSettingsSection('audio');
                  showSettings();
                }}
              />
            </Suspense>
          ) : view === 'library' ? (
            <Suspense fallback={<p>Loading library…</p>}>
              <Library connected={connected} onOpenRig={() => setView('rig')} />
            </Suspense>
          ) : view === 'rig' ? (
            <>
              <LiveRig
                connected={connected}
                onPlaying={setPlayingName}
                onLibrary={() => setView('library')}
                onAudioSetup={() => {
                  setSettingsSection('audio');
                  showSettings();
                }}
                hideInactive={
                  developmentSimulator || graphName !== null || mixedPresent
                }
              />
              <Suspense fallback={null}>
                <MixedRig
                  connected={connected}
                  onPlaying={setMixedName}
                  onPresent={setMixedPresent}
                  otherPlaying={playingName !== null || graphName !== null}
                />
                <GraphAuthor
                  connected={connected}
                  liveOnly
                  onPlaying={setGraphName}
                />
              </Suspense>
              {developmentSimulator && !audioRunning && (
                <>
                  <section
                    className="panel chain-panel"
                    aria-label="Signal chain"
                  >
                    <div className="section-heading">
                      <div>
                        <h2>Signal chain</h2>
                      </div>
                      <div className="segmented" aria-label="Routing mode">
                        <Button
                          variant="outline"
                          aria-pressed={!parallel}
                          disabled={!connected}
                          onClick={() => void routing(false)}
                        >
                          Serial
                        </Button>
                        <Button
                          variant="outline"
                          aria-pressed={parallel}
                          disabled={!connected}
                          onClick={() => void routing(true)}
                        >
                          <ArrowsSplit size={17} />
                          Parallel
                        </Button>
                      </div>
                    </div>
                    <SignalChain
                      state={state}
                      parallel={!!parallel}
                      selectedBlock={selectedBlock}
                      connected={connected}
                      onSelect={(id, parameter) => {
                        setFocusedBlock(id);
                        document
                          .getElementById(`control-${parameter}`)
                          ?.scrollIntoView({ block: 'nearest' });
                      }}
                    />
                    <details className="routing-details">
                      <summary>Routing details</summary>
                      <p className="caption">
                        {parallel
                          ? 'Input splits into A and B, then merges before the shared delay and reverb.'
                          : 'One NAM path feeds the shared delay and reverb.'}{' '}
                        Routing validation is active; this preview does not
                        process audio.
                      </p>
                    </details>
                  </section>
                  <section
                    className="panel controls-panel"
                    aria-label="Rig controls"
                  >
                    <div className="section-heading">
                      <div>
                        <span className="eyebrow">Quick controls</span>
                        <h2>
                          {blockNames[selectedBlock]}{' '}
                          <span className="muted">/ selected</span>
                        </h2>
                      </div>
                      <span className="input-source" title="Last control input">
                        Input:
                        <strong data-testid="last-origin">
                          {state.origin}
                        </strong>
                      </span>
                    </div>
                    <div className="parameters">
                      {state.parameters.map((parameter) => (
                        <div
                          className="parameter"
                          key={parameter.id}
                          id={`control-${parameter.id}`}
                          data-selected={parameter.id.startsWith(
                            `${selectedBlock}.`,
                          )}
                          onFocusCapture={() =>
                            setFocusedBlock(
                              parameter.id.split('.')[0] ?? 'nam-a',
                            )
                          }
                        >
                          <span className="parameter-name">
                            {parameter.label}
                          </span>
                          <ControlEditor
                            parameter={parameter}
                            state={state}
                            connected={connected}
                            accept={accept}
                          />
                        </div>
                      ))}
                    </div>
                  </section>
                </>
              )}
            </>
          ) : (
            <Tabs
              className="settings-workspace"
              value={settingsSection}
              onValueChange={(value) => {
                if (value in settingsLabels)
                  setSettingsSection(value as keyof typeof settingsLabels);
              }}
            >
              <TabsList aria-label="Settings sections">
                {(
                  Object.keys(settingsLabels) as (keyof typeof settingsLabels)[]
                )
                  .filter((section) => section !== 'about')
                  .map((section) => (
                    <TabsTrigger key={section} value={section}>
                      {section === 'audio'
                        ? 'Audio'
                        : section === 'midi'
                          ? 'MIDI'
                          : settingsLabels[section]}
                    </TabsTrigger>
                  ))}
              </TabsList>
              <TabsContent className="settings-content" value={settingsSection}>
                {settingsSection === 'display' && (
                  <>
                    <section
                      className="panel control-stack"
                      aria-label="Display preferences"
                    >
                      <h2 className="sr-only">Display</h2>
                      <label className="field display-mode">
                        <span>Display mode</span>
                        <Select
                          value={displayMode}
                          onValueChange={setDisplayMode}
                        >
                          <SelectTrigger aria-label="Display mode">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="default">Default</SelectItem>
                            <SelectItem value="stage">Night</SelectItem>
                            <SelectItem value="sunlight">Sunlight</SelectItem>
                            <SelectItem value="epaper">E-paper</SelectItem>
                          </SelectContent>
                        </Select>
                      </label>

                      <div className="action-row">
                        <Button
                          variant="outline"
                          disabled={!screen.fullscreenSupported}
                          onClick={() => void screen.toggleFullscreen()}
                        >
                          {screen.fullscreen
                            ? 'Exit fullscreen'
                            : 'Enter fullscreen'}
                        </Button>
                        <Button
                          variant="outline"
                          aria-pressed={screen.keepAwake}
                          disabled={!screen.wakeSupported}
                          onClick={() => screen.setKeepAwake(!screen.keepAwake)}
                        >
                          Keep screen awake
                        </Button>
                        {screen.keepAwake &&
                          screen.wakeSupported &&
                          ['paused', 'denied'].includes(screen.wakeStatus) && (
                            <Button
                              variant="outline"
                              onClick={screen.retryWake}
                            >
                              Retry keep-awake
                            </Button>
                          )}
                      </div>
                      <p role="status" aria-label="Screen awake status">
                        {!screen.wakeSupported
                          ? 'Keep-awake unavailable: use HTTPS and a supported browser.'
                          : {
                              off: 'Screen awake: off',
                              requesting: 'Screen awake: requesting',
                              active: 'Screen awake: active',
                              paused: 'Screen awake: paused by browser',
                              denied:
                                'Screen awake: not allowed by browser or power settings',
                            }[screen.wakeStatus]}
                      </p>
                      {!screen.fullscreenSupported && (
                        <p className="caption">
                          Page fullscreen is unavailable in this browser.
                        </p>
                      )}
                      {screen.fullscreenError && (
                        <p role="alert">{screen.fullscreenError}</p>
                      )}
                      <details className="control-help">
                        <summary>Display &amp; screen help</summary>
                        <p>
                          Preferences are saved on this browser. Keep-awake
                          works while Oxidal is visible and retries when you
                          return. Browser power settings can release it;
                          fullscreen alone does not prevent sleep.
                        </p>
                        <p>
                          Night darkens every surface for a dark stage. Sunlight
                          is pure black on white. E-paper removes colour and
                          motion. Set brightness and e-paper refresh on your
                          device.
                        </p>
                      </details>
                    </section>
                  </>
                )}
                {settingsSection === 'connections' && (
                  <NetworkSettings connected={connected} />
                )}
                {settingsSection === 'accounts' && (
                  <Tone3000Account connected={connected} />
                )}
                {settingsSection === 'audio' && (
                  <AudioSettings connected={connected} />
                )}
                {settingsSection === 'effects' && (
                  <EffectPacks
                    connected={connected}
                    audioRunning={audioRunning}
                  />
                )}
                {settingsSection === 'device' && (
                  <>
                    <StorageLock
                      connected={connected}
                      state={storage}
                      onState={setStorage}
                    />
                    <DevicePower connected={connected} />
                  </>
                )}
                {settingsSection === 'maintenance' && (
                  <>
                    <p className="caption">
                      Device maintenance · control protocol {state.protocol}.
                      Audio setup and monitoring remain available from their own
                      pages.
                    </p>
                    <Suspense fallback={<p>Loading terminal…</p>}>
                      <WebTerminal />
                    </Suspense>
                    <DebugConsole />
                    {developmentSimulator && (
                      <details className="panel">
                        <summary>Rig validation inspector</summary>
                        <label className="field">
                          Rig JSON
                          <textarea
                            aria-label="Rig JSON"
                            rows={8}
                            value={draft || JSON.stringify(state.rig, null, 2)}
                            onChange={(event) => setDraft(event.target.value)}
                            spellCheck={false}
                          />
                        </label>
                        <Button
                          variant="outline"
                          onClick={() => void validateDraft()}
                          disabled={!connected}
                        >
                          Validate rig
                        </Button>
                        <p role="status">{validation}</p>
                      </details>
                    )}
                  </>
                )}
                {settingsSection === 'about' && <About />}
                {settingsSection === 'midi' && !developmentSimulator && (
                  <MidiSettings connected={connected} />
                )}
                {settingsSection === 'midi' && developmentSimulator && (
                  <>
                    <section className="panel">
                      <h2>MIDI mapping</h2>
                      <p className="muted">
                        Current mapping:{' '}
                        {state.mappings.mappings
                          .map(
                            (mapping) => `CC ${mapping.cc} → ${mapping.target}`,
                          )
                          .join(', ') || 'none'}
                        . This form replaces the PoC knob mapping.
                      </p>
                      <div className="form-grid">
                        <label className="field">
                          Target
                          <Select value={target} onValueChange={setTarget}>
                            <SelectTrigger aria-label="Target">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {state.parameters.map((p) => (
                                <SelectItem key={p.id} value={p.id}>
                                  {p.label}
                                </SelectItem>
                              ))}
                              {state.actions.map((action) => (
                                <SelectItem key={action.id} value={action.id}>
                                  {action.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </label>
                        <label className="field">
                          MIDI channel
                          <input
                            type="number"
                            min="1"
                            max="16"
                            value={channel}
                            onChange={(e) => setChannel(Number(e.target.value))}
                          />
                        </label>
                        <label className="field">
                          CC number
                          <input
                            type="number"
                            min="0"
                            max="127"
                            value={cc}
                            onChange={(e) => setCc(Number(e.target.value))}
                          />
                        </label>
                        <label className="field">
                          Knob mode
                          <Select
                            value={mode}
                            onValueChange={(value) =>
                              setMode(value as typeof mode)
                            }
                          >
                            <SelectTrigger aria-label="Knob mode">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="absolute">Absolute</SelectItem>
                              <SelectItem value="relative_twos_complement">
                                Relative · two’s complement
                              </SelectItem>
                            </SelectContent>
                          </Select>
                        </label>
                      </div>
                      <div className="form-grid">
                        <label className="field">
                          Mapped minimum (0–1)
                          <input
                            type="number"
                            min="0"
                            max="1"
                            step="0.01"
                            value={minimum}
                            onChange={(e) => setMinimum(Number(e.target.value))}
                          />
                        </label>
                        <label className="field">
                          Mapped maximum (0–1)
                          <input
                            type="number"
                            min="0"
                            max="1"
                            step="0.01"
                            value={maximum}
                            onChange={(e) => setMaximum(Number(e.target.value))}
                          />
                        </label>
                        <label className="field">
                          Scaling curve
                          <Select
                            value={curve}
                            onValueChange={(value) =>
                              setCurve(value as typeof curve)
                            }
                          >
                            <SelectTrigger aria-label="Scaling curve">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="linear">Linear</SelectItem>
                              <SelectItem value="logarithmic">
                                Logarithmic (minimum above zero)
                              </SelectItem>
                            </SelectContent>
                          </Select>
                        </label>
                      </div>
                      <div className="performance-actions">
                        <Button
                          variant="outline"
                          disabled={!connected || !simulator}
                          onClick={() => {
                            learnArmed.current = !learnArmed.current;
                            setLearning(learnArmed.current);
                          }}
                        >
                          {learning
                            ? 'Cancel MIDI learn'
                            : 'Learn next MIDI message'}
                        </Button>
                        <span role="status">
                          {learning
                            ? 'Move a knob or send a simulator message…'
                            : state.last_midi
                              ? `Last input: CH ${state.last_midi.channel} / CC ${state.last_midi.cc} (${state.midi_mapped ? 'mapped' : 'unmapped'})`
                              : 'No MIDI input yet'}
                        </span>
                      </div>
                      <p className="caption">
                        Bypass and preset targets use absolute CC, linear 0–1
                        range, and no pickup. Values below 64 select off/serial;
                        64–127 select on/parallel.
                      </p>
                      <div className="grid max-w-xl gap-2">
                        <label className="flex min-h-11 items-center justify-between gap-3 text-sm">
                          <span>Pickup / soft takeover</span>
                          <Switch
                            checked={pickup}
                            onCheckedChange={setPickup}
                            aria-label="Pickup / soft takeover"
                          />
                        </label>
                        <label className="flex min-h-11 items-center justify-between gap-3 text-sm">
                          <span>Send controller feedback</span>
                          <Switch
                            checked={feedback}
                            onCheckedChange={setFeedback}
                            aria-label="Send controller feedback"
                          />
                        </label>
                      </div>
                      <Button disabled={!connected} onClick={saveMapping}>
                        Save mapping
                      </Button>
                      <p className="caption">
                        Feedback updates supported displays, LEDs, or motors.
                        Ordinary knobs use pickup; they cannot physically follow
                        web edits.
                      </p>
                    </section>
                    <section className="panel">
                      <h2>MIDI simulator</h2>
                      <p>
                        Inject a CC message into the running TONE3000 rig. The
                        simulator does not require a connected controller.
                      </p>
                      <label className="field">
                        MIDI value
                        <input
                          aria-label="MIDI value"
                          type="number"
                          min="0"
                          max="127"
                          value={midiValue}
                          onChange={(e) => setMidiValue(Number(e.target.value))}
                        />
                      </label>
                      <Button
                        disabled={!connected || !simulator}
                        onClick={() =>
                          void run({
                            type: 'midi',
                            input: {
                              device: 'simulator',
                              channel,
                              cc,
                              value: midiValue,
                            },
                          })
                        }
                      >
                        Send MIDI CC
                      </Button>
                      <div className="feedback" aria-label="MIDI feedback">
                        <span className="eyebrow">
                          Confirmed output / isolated feedback route
                        </span>
                        {state.feedback.length ? (
                          state.feedback.map((item) => (
                            <code key={item.mapping}>
                              CH {item.channel} · CC {item.cc} · VALUE{' '}
                              <span data-testid="feedback-value">
                                {item.value}
                              </span>
                            </code>
                          ))
                        ) : (
                          <span>No feedback yet</span>
                        )}
                      </div>
                    </section>
                  </>
                )}
              </TabsContent>
              <div className="settings-about-link">
                <Button
                  variant="ghost"
                  onClick={() => {
                    setSettingsSection(
                      settingsSection === 'about' ? 'audio' : 'about',
                    );
                    window.scrollTo({ top: 0 });
                  }}
                >
                  {settingsSection === 'about'
                    ? 'Back to settings'
                    : 'About Oxidal'}
                </Button>
              </div>
            </Tabs>
          )}
        </main>
      </div>
    </div>
  );
}

/** Workspace memory contains display context only, never authoritative audio state. */
export default function App() {
  const [memory] = useState(() => new Map<string, unknown>());
  return (
    <WorkspaceMemory.Provider value={memory}>
      <InstrumentApp />
    </WorkspaceMemory.Provider>
  );
}
