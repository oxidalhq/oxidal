import {
  ArrowsSplit,
  Cpu,
  Faders,
  Info,
  Monitor,
  PianoKeys,
  Power,
  SpeakerHigh,
  UserCircle,
  WarningCircle,
  WifiHigh,
  Wrench,
} from '@phosphor-icons/react';
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

import { Button } from '@oxidal/design-system/components/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@oxidal/design-system/components/select';
import { Loading } from '@oxidal/design-system/components/states';
import { Switch } from '@oxidal/design-system/components/switch';
import { useNotice } from '@oxidal/design-system/notices';
import {
  AppShell,
  PageHeading,
} from '@oxidal/design-system/patterns/app-shell';
import { DisplaySettings } from '@oxidal/design-system/patterns/display-settings';
import { SettingsPage } from '@oxidal/design-system/patterns/settings-page';

import { About } from './About';
import {
  type Action,
  capabilities,
  deviceStorage,
  type MappingFile,
  midiAction,
  parseSnapshot,
  sendCommand,
  type Snapshot,
  type StorageState,
} from './api';
import { AudioSettings } from './AudioSettings';
import { NowPlaying, SplitStatus } from './components/media/NowPlaying';
import { MediaSheets } from './components/media/PlayerSheet';
import { SessionMediaProvider } from './components/media/SessionMediaProvider';
import { ControlEditor } from './ControlEditor';
import { DebugConsole } from './DebugConsole';
import { DevicePower } from './DevicePower';
import { EffectPacks } from './EffectPacks';
import { FeatureBoundary } from './FeatureBoundary';
import { GlobalTuner } from './GlobalTuner';
import { GuitarSettings } from './GuitarSettings';
import { friendlyError } from './lib/friendlyError';
import { leaveScreen } from './lib/leaveGuard';
import { publishPlayer } from './lib/playerFeed';
import { publishVenue } from './lib/venueFeed';
import { LiveRig } from './LiveRig';
import { MidiSettings } from './MidiSettings';
import { refreshMonitorFeed } from './monitorFeed';
import { NetworkSettings } from './NetworkSettings';
import { SignalChain } from './SignalChain';
import { StorageLock } from './StorageLock';
import { Tone3000Account } from './Tone3000Account';
import { TunerButton } from './TunerButton';
import { OPEN_TUNER_EVENT, requestTuner } from './tunerNavigation';
import { GUITARS_CHANGED_EVENT } from './useGuitars';
import { useResourceStatus } from './useResourceStatus';
import { useScreenSession } from './useScreenSession';
import {
  useSectionLocation,
  useWorkspaceNavigation,
  WorkspaceMemory,
} from './workspaceMemory';

const MixedRig = lazy(() =>
  import('./MixedRig').then((m) => ({ default: m.MixedRig })),
);
const GraphAuthor = lazy(() =>
  import('./GraphAuthor').then((m) => ({ default: m.GraphAuthor })),
);
const Library = lazy(() =>
  import('./Library').then((m) => ({ default: m.Library })),
);
const SoundCheck = lazy(() =>
  import('./SoundCheck').then((m) => ({ default: m.SoundCheck })),
);
const WebTerminal = lazy(() =>
  import('./WebTerminal').then((m) => ({ default: m.WebTerminal })),
);

/** Quiet rig control over a single authoritative Rust state model.
 * @see docs/architecture.md
 */
/** Settings destinations, each with its own link such as `#settings/accounts`. */
/** One icon per Settings section, beside its label. */
const settingsIcons = {
  audio: <SpeakerHigh aria-hidden="true" />,
  connections: <WifiHigh aria-hidden="true" />,
  accounts: <UserCircle aria-hidden="true" />,
  midi: <PianoKeys aria-hidden="true" />,
  effects: <Faders aria-hidden="true" />,
  display: <Monitor aria-hidden="true" />,
  device: <Cpu aria-hidden="true" />,
  maintenance: <Wrench aria-hidden="true" />,
  about: <Info aria-hidden="true" />,
} as const;
const settingsSections = [
  'audio',
  'connections',
  'accounts',
  'midi',
  'effects',
  'display',
  'device',
  'maintenance',
  'about',
] as const;

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
  useEffect(() => {
    const open = () => setTunerOpen(true);
    window.addEventListener(OPEN_TUNER_EVENT, open);
    return () => window.removeEventListener(OPEN_TUNER_EVENT, open);
  }, []);
  const lastTunerAction = useRef<number | null>(null);
  useEffect(() => {
    if (!connected) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const action = await midiAction();
        if (!active) return;
        if (lastTunerAction.current === null) {
          lastTunerAction.current = action.seq;
        } else if (
          action.seq !== lastTunerAction.current &&
          action.ok &&
          action.message === 'Tuner requested'
        ) {
          lastTunerAction.current = action.seq;
          requestTuner();
        } else if (
          action.seq !== lastTunerAction.current &&
          action.ok &&
          action.message.startsWith('Guitar: ')
        ) {
          // A footswitch chose another guitar: every guitar control reads again.
          lastTunerAction.current = action.seq;
          window.dispatchEvent(new Event(GUITARS_CHANGED_EVENT));
        } else {
          lastTunerAction.current = action.seq;
        }
      } catch {
        // The normal reconnect path remains authoritative if polling fails.
      } finally {
        if (active) timer = setTimeout(() => void poll(), 250);
      }
    }
    void poll();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [connected]);
  const [settingsSection, setSettingsSection] = useSectionLocation(
    'settings',
    settingsSections,
    'audio',
  );
  const settingsLabels = {
    audio: 'Audio',
    connections: 'Network',
    accounts: 'Accounts',
    midi: 'MIDI',
    effects: 'Effects',
    display: 'Display',
    device: 'Device',
    maintenance: 'Maintenance',
    about: 'About',
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
  const [statusMode, setStatusMode] = useState<'simple' | 'detailed'>(() => {
    try {
      return localStorage.getItem('oxidal.status') === 'detailed'
        ? 'detailed'
        : 'simple';
    } catch {
      return 'simple';
    }
  });
  const changeStatus = (mode: 'simple' | 'detailed') => {
    setStatusMode(mode);
    try {
      localStorage.setItem('oxidal.status', mode);
    } catch {
      /* Session preference still works. */
    }
  };
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
  /** Why the device could not be read; cleared when its state next arrives. */
  const [reachError, setReachError] = useState('');
  useNotice('device', error ? { tone: 'error', text: error } : null);
  // While disconnected, the resource strip's "Connection lost" already says it.
  useNotice(
    'device-reach',
    connected && reachError ? { tone: 'error', text: reachError } : null,
  );
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
    let retry: ReturnType<typeof setTimeout> | undefined;
    const open = () => {
      clearTimeout(retry);
      events?.close();
      const source = new EventSource('/api/v1/events');
      events = source;
      source.addEventListener('state', (event: MessageEvent<string>) => {
        try {
          const next = parseSnapshot(JSON.parse(event.data));
          if (active && events === source) {
            accept(next);
            setConnected(true);
            setReachError('');
            refreshMonitorFeed();
          }
        } catch {
          if (active) {
            setError('Device sent incompatible state');
            setConnected(false);
          }
        }
      });
      source.addEventListener('player', (event: MessageEvent<string>) => {
        try {
          if (active && events === source)
            publishPlayer(JSON.parse(event.data));
        } catch {
          /* An incompatible player snapshot leaves the last good one shown. */
        }
      });
      source.addEventListener('venue', (event: MessageEvent<string>) => {
        try {
          if (active && events === source) publishVenue(JSON.parse(event.data));
        } catch {
          /* An incompatible venue state leaves the last good one shown. */
        }
      });
      events.onerror = () => {
        if (!active) return;
        setConnected(false);
        // The browser retries a dropped stream itself, but gives up for good
        // when the daemon or proxy answers with an error, as during a restart.
        if (source.readyState === EventSource.CLOSED && events === source)
          retry = setTimeout(open, 2000);
      };
      void capabilities()
        .then((info) => {
          if (active) setSimulator(info.midi_transport === 'simulator');
        })
        .catch((e: unknown) => {
          if (active) setReachError(friendlyError(e, 'reach Oxidal'));
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
      clearTimeout(retry);
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
  const resource = useResourceStatus(displayMode, connected, () => {
    showSettings();
    setSettingsSection('audio');
  });
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
    <AppShell
      destination={view === 'monitor' ? 'levels' : view}
      onNavigate={(target) => {
        const destination = target === 'levels' ? 'monitor' : target;
        const go = () =>
          destination === 'settings' ? showSettings() : setView(destination);
        if (destination === view) go();
        else leaveScreen(go);
      }}
      nowPlaying={
        <>
          <span>
            {playingName ?? graphName ?? mixedName ?? 'No preset playing'}
          </span>
          <NowPlaying placement="masthead" />
          <SplitStatus />
        </>
      }
      readings={resource.readings}
      resourceState={resource.state}
      resourceConnected={resource.connected}
      resourceLabel={resource.label}
      status={statusMode}
      bottomBar={<NowPlaying placement="bottom" />}
    >
      <NowPlaying placement="strip" />
      {tunerOpen && (
        <GlobalTuner
          onClose={() => setTunerOpen(false)}
          slow={displayMode === 'epaper'}
        />
      )}
      <div className="workspace-content px-page pt-4">
        <div
          className={
            view === 'settings'
              ? 'contents'
              : view === 'rig' && audioRunning
                ? 'sr-only'
                : 'page-heading'
          }
        >
          {view === 'settings' ? (
            <PageHeading
              eyebrow="Settings"
              title="Settings"
              className="px-0 pt-0 md:sr-only"
            />
          ) : (
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
                      ? 'Levels'
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
                      ? 'Levels'
                      : view === 'library'
                        ? 'Library'
                        : settingsLabels[settingsSection]}
              </h1>
            </div>
          )}
          {state && view === 'rig' && developmentSimulator && !audioRunning && (
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
              <TunerButton />
              <Button
                className="bypass-switch min-h-12"
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
                showSettings();
                setSettingsSection('audio');
              }}
            >
              Audio setup
            </Button>
          </div>
        )}
        {!state ? (
          <Loading label="Connecting to Oxidal…" />
        ) : view === 'guitars' ? (
          <GuitarSettings />
        ) : view === 'monitor' ? (
          <FeatureBoundary name="Levels">
            <Suspense fallback={<Loading label="Loading Levels…" />}>
              <SoundCheck
                connected={connected}
                displayMode={displayMode}
                onGuitars={() => setView('guitars')}
                onLibrary={() => setView('library')}
                onAudioSetup={() => {
                  showSettings();
                  setSettingsSection('audio');
                }}
              />
            </Suspense>
          </FeatureBoundary>
        ) : view === 'library' ? (
          <FeatureBoundary name="the Library">
            <Suspense fallback={<Loading label="Loading Library…" />}>
              <Library connected={connected} onOpenRig={() => setView('rig')} />
            </Suspense>
          </FeatureBoundary>
        ) : view === 'rig' ? (
          <>
            {/* Every Rig view's header holds Mute/Protect (7.28). */}
            <LiveRig
              connected={connected}
              onPlaying={setPlayingName}
              onLibrary={() => setView('library')}
              onAudioSetup={() => {
                showSettings();
                setSettingsSection('audio');
              }}
              hideInactive={
                developmentSimulator || graphName !== null || mixedPresent
              }
            />
            <Suspense fallback={<Loading label="Loading the rig…" />}>
              <FeatureBoundary name="the mixed rig">
                <MixedRig
                  connected={connected}
                  onPlaying={setMixedName}
                  onPresent={setMixedPresent}
                  otherPlaying={playingName !== null || graphName !== null}
                />
              </FeatureBoundary>
              <FeatureBoundary name="the effects rig">
                <GraphAuthor
                  connected={connected}
                  liveOnly
                  onPlaying={setGraphName}
                />
              </FeatureBoundary>
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
                      <strong data-testid="last-origin">{state.origin}</strong>
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
                          setFocusedBlock(parameter.id.split('.')[0] ?? 'nam-a')
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
          <SettingsPage
            className="px-0"
            sections={settingsSections.map((id) => ({
              id,
              label: settingsLabels[id],
              icon: settingsIcons[id],
            }))}
            current={settingsSection}
            onSelect={(value) => {
              if (value === settingsSection) return;
              if (value in settingsLabels)
                leaveScreen(() =>
                  setSettingsSection(value as keyof typeof settingsLabels),
                );
            }}
          >
            {settingsSection === 'display' && (
              <DisplaySettings
                mode={displayMode}
                onModeChange={setDisplayMode}
                status={statusMode}
                onStatusChange={changeStatus}
                keepAwake={screen.keepAwake}
                onKeepAwakeChange={screen.setKeepAwake}
                wakeSupported={screen.wakeSupported}
                wakeStatus={screen.wakeStatus}
                onRetryWake={screen.retryWake}
                fullscreen={screen.fullscreen}
                fullscreenSupported={screen.fullscreenSupported}
                fullscreenError={screen.fullscreenError}
                onToggleFullscreen={() => void screen.toggleFullscreen()}
                help={
                  <details className="control-help">
                    <summary>Display &amp; screen help</summary>
                    <p>
                      Preferences are saved on this browser. Keep-awake works
                      while Oxidal is visible and retries when you return.
                      Browser power settings can release it; fullscreen alone
                      does not prevent sleep.
                    </p>
                    <p>
                      Night darkens every surface for a dark stage. Sunlight is
                      pure black on white. E-paper removes colour and motion.
                      Set brightness and e-paper refresh on your device.
                    </p>
                  </details>
                }
              />
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
              <EffectPacks connected={connected} audioRunning={audioRunning} />
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
                  Device maintenance · control protocol {state.protocol}. Audio
                  setup and monitoring remain available from their own pages.
                </p>
                <FeatureBoundary name="the terminal">
                  <Suspense fallback={<Loading label="Loading terminal…" />}>
                    <WebTerminal />
                  </Suspense>
                </FeatureBoundary>
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
                      .map((mapping) => `CC ${mapping.cc} → ${mapping.target}`)
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
                        onValueChange={(value) => setMode(value as typeof mode)}
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
                    Bypass and preset targets use absolute CC, linear 0–1 range,
                    and no pickup. Values below 64 select off/serial; 64–127
                    select on/parallel.
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
                    Ordinary knobs use pickup; they cannot physically follow web
                    edits.
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
                          <span data-testid="feedback-value">{item.value}</span>
                        </code>
                      ))
                    ) : (
                      <span>No feedback yet</span>
                    )}
                  </div>
                </section>
              </>
            )}
          </SettingsPage>
        )}
      </div>
      <MediaSheets />
    </AppShell>
  );
}

/** Workspace memory contains display context only, never authoritative audio state.
 * The backing player's session media outlives every page. */
export default function App() {
  const [memory] = useState(() => new Map<string, unknown>());
  return (
    <WorkspaceMemory.Provider value={memory}>
      <SessionMediaProvider>
        <InstrumentApp />
      </SessionMediaProvider>
    </WorkspaceMemory.Provider>
  );
}
