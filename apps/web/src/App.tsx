import {
  ArrowsSplit,
  Info,
  LockSimple,
  Monitor,
  Power,
  Repeat,
  WarningCircle,
  Waveform,
} from '@phosphor-icons/react';
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from 'react';

import { Button } from '@oxidal/design-system/components/button';
import { Card } from '@oxidal/design-system/components/card';
import {
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
import { Loading } from '@oxidal/design-system/components/states';
import { Switch } from '@oxidal/design-system/components/switch';
import { Caption, Eyebrow, Title } from '@oxidal/design-system/components/text';
import { healthOf } from '@oxidal/design-system/lib/health';
import { useVerticalRig } from '@oxidal/design-system/lib/use-media';
import { useNotice } from '@oxidal/design-system/notices';
import {
  AppShell,
  type Destination,
  PageHeading,
  PlayingPreset,
} from '@oxidal/design-system/patterns/app-shell';
import { DisplaySettings } from '@oxidal/design-system/patterns/display-settings';
import {
  FirstRun,
  type FirstRunRoute,
} from '@oxidal/design-system/patterns/first-run';
import { SettingsPage } from '@oxidal/design-system/patterns/settings-page';
import {
  SettingDisclosure,
  SettingGroup,
  SettingRow,
} from '@oxidal/design-system/patterns/settings-page';
import { SETTINGS_SECTIONS } from '@oxidal/design-system/patterns/settings-sections';
import {
  LibrarySkeleton,
  LoadingScreen,
  PlayerSkeleton,
  RigSkeleton,
  SettingsSkeleton,
} from '@oxidal/design-system/patterns/skeletons';

import { About } from './About';
import {
  type Action,
  capabilities,
  deviceStorage,
  graphAudioState,
  type MappingFile,
  parseMidiAction,
  parseSnapshot,
  playbackState,
  rigDocument,
  sendCommand,
  type Snapshot,
  type StorageState,
} from './api';
import { AppSearch } from './AppSearch';
import { AudioSettings } from './AudioSettings';
import { SplitStatus } from './components/media/NowPlaying';
import { MediaSheets } from './components/media/PlayerSheet';
import { useSessionMedia } from './components/media/sessionMedia';
import { SessionMediaProvider } from './components/media/SessionMediaProvider';
import { ControlEditor } from './ControlEditor';
import { DebugConsole } from './DebugConsole';
import { DevicePower } from './DevicePower';
import { EffectPacks } from './EffectPacks';
import { EngineSettings } from './EngineSettings';
import { FeatureBoundary } from './FeatureBoundary';
import { PhoneMiniPlayer, PlayerTime } from './features/dock/AppDock';
import { requestTool } from './features/dock/toolNavigation';
import { PerformanceTools } from './features/library/PerformanceTools';
import { ProtectOffDialog } from './features/stage/StageControls';
import { useOutputMute, useProtect } from './features/stage/stageState';
import { GlobalTuner } from './GlobalTuner';
import { GuitarSettings } from './GuitarSettings';
import { InstalledEffects } from './InstalledEffects';
import { friendlyError } from './lib/friendlyError';
import { leaveScreen } from './lib/leaveGuard';
import { publishPlayer } from './lib/playerFeed';
import { publishVenue } from './lib/venueFeed';
import { LiveRig } from './LiveRig';
import { MidiSettings } from './MidiSettings';
import { refreshMonitorFeed } from './monitorFeed';
import { NativeDefaults } from './NativeDefaults';
import { NetworkSettings } from './NetworkSettings';
import { ResourceContext } from './resourceContext';
import { OPEN_SCREEN_EVENT, type ScreenTarget } from './screenNavigation';
import { publishSheetMidi } from './sheetMidi';
import { SignalChain } from './SignalChain';
import { StorageLock } from './StorageLock';
import { Tone3000Account } from './Tone3000Account';
import { TunerButton } from './TunerButton';
import { OPEN_TUNER_EVENT, requestTuner } from './tunerNavigation';
import { GUITARS_CHANGED_EVENT } from './useGuitars';
import { useResourceStatus } from './useResourceStatus';
import { useScreenSession } from './useScreenSession';
import {
  replaceWorkspaceLocation,
  useSectionLocation,
  useWorkspaceNavigation,
  WORKSPACE_LOCATION_EVENT,
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

const settingsSections = SETTINGS_SECTIONS.map((section) => section.id);

/** What each page says once at its top (C2). */
const PAGE_WORDS = {
  library: {
    eyebrow: 'On this unit',
    title: 'Library',
    caption: 'Your presets, Oxidal sounds, set lists, tones and stems.',
  },
  monitor: {
    eyebrow: 'Loudness',
    title: 'Levels',
    caption: 'Sound check and readings for every preset.',
  },
  settings: {
    eyebrow: 'This unit',
    title: 'Settings',
    caption: 'Audio, MIDI, network, display and the device itself.',
  },
} as const;

function InstrumentApp() {
  const screen = useScreenSession();
  const [playingName, setPlayingName] = useState<string | null>(null);
  const [graphName, setGraphName] = useState<string | null>(null);
  const [graphPresent, setGraphPresent] = useState(false);
  const [mixedPresent, setMixedPresent] = useState(false);
  const [mixedName, setMixedName] = useState<string | null>(null);
  const audioRunning =
    playingName !== null || graphName !== null || mixedName !== null;
  const [state, setState] = useState<Snapshot | null>(null);
  const [connected, setConnected] = useState(false);
  const [setupOpen, setSetupOpen] = useState(
    () => location.hash === '#settings/essentials/setup',
  );
  useEffect(() => {
    const sync = () =>
      setSetupOpen(location.hash === '#settings/essentials/setup');
    window.addEventListener('hashchange', sync);
    window.addEventListener(WORKSPACE_LOCATION_EVENT, sync);
    return () => {
      window.removeEventListener('hashchange', sync);
      window.removeEventListener(WORKSPACE_LOCATION_EVENT, sync);
    };
  }, []);
  const [storage, setStorage] = useState<StorageState | null>(null);
  const [simulator, setSimulator] = useState(false);
  // Example state is never a fallback for a stopped or unavailable audio engine.
  // Both an explicit development URL and server capability are required.
  const developmentSimulator =
    simulator &&
    new URLSearchParams(window.location.search).get('development') ===
      'simulator';
  const [view, setView] = useWorkspaceNavigation();
  const phone = useVerticalRig();
  const [tunerOpen, setTunerOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  // ⌘K or Ctrl+K opens the one search from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => {
    const open = () => setTunerOpen(true);
    window.addEventListener(OPEN_TUNER_EVENT, open);
    return () => window.removeEventListener(OPEN_TUNER_EVENT, open);
  }, []);
  const [settingsSection, setSettingsSection] = useSectionLocation(
    'settings',
    settingsSections,
    'audio',
  );
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
      // Simple (as C2: the light only on a problem) unless chosen.
      return localStorage.getItem('oxidal.status') === 'detailed'
        ? 'detailed'
        : 'simple';
    } catch {
      return 'simple';
    }
  });
  // Settings › Display: keep the capsule open while playing (this browser only).
  const [keepMenuOpen, setKeepMenuOpen] = useState(() => {
    try {
      return localStorage.getItem('oxidal.capsule.keep-open') === 'on';
    } catch {
      return false;
    }
  });
  const changeKeepMenuOpen = (keep: boolean) => {
    setKeepMenuOpen(keep);
    try {
      localStorage.setItem('oxidal.capsule.keep-open', keep ? 'on' : 'off');
    } catch {
      /* Session preference still works. */
    }
  };
  // Restart and Shut down from the capsule's ☰ open Settings › Device with
  // their usual confirmation; each request remounts that section.
  const [powerAsk, setPowerAsk] = useState<{
    action: 'reboot' | 'shutdown';
    key: number;
  } | null>(null);
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
      let lastMidi: ReturnType<typeof parseMidiAction> | undefined;
      source.addEventListener('open', () => {
        lastMidi = undefined;
      });
      source.addEventListener('midi-action', (event: MessageEvent<string>) => {
        if (!active || events !== source) return;
        try {
          const action = parseMidiAction(JSON.parse(event.data));
          const previous = lastMidi;
          if (previous && action.seq <= previous.seq) return;
          lastMidi = action;
          if (!previous) return;
          publishSheetMidi(previous, action);
          if (!action.ok) return;
          if (action.message === 'Tuner requested') requestTuner();
          else if (action.message.startsWith('Guitar: '))
            window.dispatchEvent(new Event(GUITARS_CHANGED_EVENT));
        } catch {
          // Keep the last confirmed action when a message is incompatible.
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

  function openSetupStep(route: FirstRunRoute) {
    leaveScreen(() => {
      if (route === 'guitars') return setView('guitars');
      if (route === 'library/oxidal') {
        setView('library');
        const url = new URL(window.location.href);
        url.hash = route;
        replaceWorkspaceLocation(url);
        return;
      }
      showSettings();
      setSettingsSection(
        route === 'settings/audio'
          ? 'audio'
          : route === 'settings/midi'
            ? 'midi'
            : 'connections',
      );
    });
  }

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
  const presetId = resource.preset?.id;
  const presetKind = resource.preset?.kind;
  const [headerPreset, setHeaderPreset] = useState<{
    id: string;
    name: string;
  } | null>(null);
  useEffect(() => {
    if (view === 'rig' || !presetId || !presetKind) return;
    let current = true;
    const reading =
      presetKind === 'rig'
        ? rigDocument(presetId).then((doc) => doc.manifest.name)
        : presetKind === 'graph'
          ? graphAudioState().then((audio) => audio.configured?.name)
          : playbackState().then((audio) => audio.preset_name);
    void reading.then(
      (name) => {
        if (current && name) setHeaderPreset({ id: presetId, name });
      },
      () => {},
    );
    return () => {
      current = false;
    };
  }, [view, presetId, presetKind]);
  const headerName =
    view === 'rig'
      ? (playingName ?? graphName ?? mixedName)
      : resource.running
        ? headerPreset && headerPreset.id === presetId
          ? headerPreset.name
          : 'Current rig'
        : null;
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

  const mute = useOutputMute(connected);
  const lock = useProtect(connected);
  useNotice(
    'stage-controls',
    mute.error || lock.error
      ? { tone: 'error', text: mute.error || lock.error }
      : null,
  );
  const health = healthOf(resource.readings, resource.state);
  const media = useSessionMedia();
  const openSettings = (section: (typeof settingsSections)[number]) =>
    leaveScreen(() => {
      showSettings();
      setSettingsSection(section);
    });
  // Other screens ask for a screen by event (the chain bar, the edge lanes).
  const openScreen = useEffectEvent((target: ScreenTarget) => {
    if (target.screen === 'settings') openSettings(target.section);
    else leaveScreen(() => setView(target.screen));
  });
  useEffect(() => {
    const on = (event: Event) =>
      openScreen((event as CustomEvent<ScreenTarget>).detail);
    window.addEventListener(OPEN_SCREEN_EVENT, on);
    return () => window.removeEventListener(OPEN_SCREEN_EVENT, on);
  }, []);
  const capsuleMenu = [
    [
      {
        id: 'display',
        label: 'Display mode',
        icon: <Monitor />,
        onSelect: () => openSettings('display'),
      },
      {
        id: 'protect',
        label: lock.protect ? 'Protected' : 'Protect',
        icon: <LockSimple />,
        checked: !!lock.protect,
        disabled: lock.disabled,
        onSelect: lock.request,
      },
    ],
    [
      {
        id: 'restart-audio',
        label: 'Restart audio',
        icon: <Waveform />,
        onSelect: () => openSettings('audio'),
      },
      {
        id: 'restart-device',
        label: 'Restart device',
        icon: <Repeat />,
        onSelect: () => {
          setPowerAsk({ action: 'reboot', key: Date.now() });
          openSettings('device');
        },
      },
      {
        id: 'shut-down',
        label: 'Shut down device',
        icon: <Power />,
        destructive: true,
        onSelect: () => {
          setPowerAsk({ action: 'shutdown', key: Date.now() });
          openSettings('device');
        },
      },
    ],
    [
      {
        id: 'about',
        label: 'About',
        icon: <Info />,
        onSelect: () => openSettings('about'),
      },
    ],
  ];

  const navigate = (target: Destination) => {
    const destination = target === 'levels' ? 'monitor' : target;
    const go = () =>
      destination === 'settings' ? showSettings() : setView(destination);
    if (destination === view) go();
    else leaveScreen(go);
  };

  return (
    <ResourceContext.Provider value={resource}>
      <AppShell
        destination={view === 'monitor' ? 'levels' : view}
        onNavigate={navigate}
        onSearch={() => setSearchOpen(true)}
        nowPlaying={
          <>
            <PlayingPreset name={headerName} />
            <SplitStatus />
          </>
        }
        readings={resource.readings}
        resourceState={resource.state}
        resourceConnected={resource.connected}
        resourceLabel={resource.label}
        status={statusMode}
        bar="capsule"
        capsule={{
          status: {
            word: health.word,
            problem: health.tone === 'hot' || resource.state === 'disconnected',
          },
          muted: !!mute.muted,
          onMute: mute.toggle,
          muteDisabled: mute.disabled,
          menu: capsuleMenu,
          playing: resource.running,
          inputLevel: resource.levels?.input[0] ?? null,
          keepOpen: keepMenuOpen,
          rig: view === 'rig',
          presetName: headerName,
          // A track that is playing or paused partway: the capsule's
          // now-playing part opens the Player. A track only cued at the
          // start, or played to the end, waits in the Player instead, so the
          // capsule does not carry a track nobody is using.
          media:
            media.ready &&
            media.player?.track &&
            (['playing', 'stalled', 'paused', 'interrupted'].includes(
              media.shown,
            ) ||
              (media.shown === 'ready' && media.player.frame > 0))
              ? {
                  title: media.player.track.title,
                  playing:
                    media.shown === 'playing' || media.shown === 'stalled',
                  position: <PlayerTime />,
                  work:
                    media.split?.phase === 'running'
                      ? `Splitting ${media.split.percent}%`
                      : undefined,
                  onOpen: () => requestTool('player'),
                }
              : undefined,
          wordmark:
            displayMode === 'stage'
              ? '/brand/wordmark-white.svg'
              : '/brand/wordmark.svg',
          onHome: () => {
            window.location.hash = '#rig';
          },
        }}
        tempo={resource.tempo}
        levels={resource.levels}
        bottomBar={<PhoneMiniPlayer />}
      >
        {lock.confirmOff && (
          <ProtectOffDialog onKeep={lock.keepOn} onTurnOff={lock.turnOff} />
        )}
        <AppSearch
          open={searchOpen}
          onOpenChange={setSearchOpen}
          onNavigate={navigate}
          onTuner={() => setTunerOpen(true)}
        />
        <PerformanceTools
          rig={view === 'rig'}
          stage={displayMode === 'stage'}
          tunerOpen={tunerOpen}
          connected={connected}
          slow={displayMode === 'epaper'}
        >
          {tunerOpen && (
            <GlobalTuner
              onClose={() => setTunerOpen(false)}
              slow={displayMode === 'epaper'}
            />
          )}
          <div
            className={
              'workspace-content px-page' +
              (view === 'rig' && !audioRunning ? ' pt-4' : '')
            }
          >
            <div
              aria-hidden={
                (view === 'rig' &&
                  (playingName !== null || mixedName !== null)) ||
                undefined
              }
              className={
                view === 'settings' ||
                view === 'library' ||
                view === 'monitor' ||
                view === 'guitars'
                  ? 'contents'
                  : view === 'rig' && audioRunning
                    ? 'sr-only'
                    : 'page-heading'
              }
            >
              {view === 'guitars' ||
              (view === 'settings' &&
                settingsSection === 'essentials' &&
                setupOpen) ? null : view === 'settings' ||
                view === 'library' ||
                view === 'monitor' ? (
                // The page name once (C2); on a phone the section picker
                // follows, so the eyebrow and caption step aside.
                <PageHeading
                  size="lg"
                  eyebrow={phone ? undefined : PAGE_WORDS[view].eyebrow}
                  title={PAGE_WORDS[view].title}
                  caption={phone ? undefined : PAGE_WORDS[view].caption}
                  className="px-0 pt-6 pb-4 max-md:pt-4 max-md:pb-3"
                />
              ) : (
                <div>
                  <Eyebrow>
                    {view === 'rig'
                      ? audioRunning
                        ? 'Playing'
                        : developmentSimulator
                          ? 'Development simulator'
                          : 'Rig'
                      : 'Rig'}
                  </Eyebrow>
                  <Title size="md" data-testid="active-preset">
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
                      : SETTINGS_SECTIONS.find(
                          ({ id }) => id === settingsSection,
                        )?.label}
                  </Title>
                </div>
              )}
              {state &&
                view === 'rig' &&
                developmentSimulator &&
                !audioRunning && (
                  <div className="m-0 flex shrink-0 flex-nowrap items-end justify-between gap-3 text-xs max-[380px]:flex-wrap min-[761px]:justify-start min-[761px]:gap-4 [&>[data-slot=form-field]]:m-0 max-[760px]:[&>[data-slot=form-field]]:min-w-0 max-[760px]:[&>[data-slot=form-field]]:flex-1 max-[380px]:[&>[data-slot=form-field]]:basis-full min-[761px]:[&>[data-slot=form-field]]:min-w-40">
                    <FormField>
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
                    </FormField>
                    <TunerButton />
                    <Button
                      className="min-h-[max(48px,3rem)] min-w-[136px] max-[380px]:w-full"
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
              <div className="mb-2 flex flex-wrap items-center gap-2 gap-2.5 border border-l-2 border-border border-muted-foreground bg-muted bg-transparent px-2.5 px-3 py-1 py-2.5 text-sm text-muted-foreground [&_svg]:shrink-0 [&>button]:ml-auto">
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
              <LoadingScreen
                label="Connecting to Oxidal"
                skeleton={
                  view === 'library' ? (
                    location.hash === '#library/backing' ? (
                      <PlayerSkeleton />
                    ) : (
                      <LibrarySkeleton
                        artwork={location.hash === '#library/tone3000'}
                      />
                    )
                  ) : view === 'rig' ? (
                    <RigSkeleton />
                  ) : (
                    <SettingsSkeleton />
                  )
                }
              />
            ) : view === 'guitars' ? (
              <div className="-mx-page">
                <GuitarSettings />
              </div>
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
                  <Library
                    connected={connected}
                    onOpenRig={() => setView('rig')}
                  />
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
                    developmentSimulator || graphPresent || mixedPresent
                  }
                />
                <Suspense
                  fallback={
                    <LoadingScreen
                      label="Loading the rig"
                      skeleton={<RigSkeleton />}
                    />
                  }
                >
                  <FeatureBoundary name="the mixed rig">
                    <MixedRig
                      connected={connected}
                      onPlaying={setMixedName}
                      onPresent={setMixedPresent}
                      otherPlaying={
                        playingName !== null ||
                        graphName !== null ||
                        graphPresent
                      }
                    />
                  </FeatureBoundary>
                  <FeatureBoundary name="the effects rig">
                    <GraphAuthor
                      connected={connected}
                      liveOnly
                      onPlaying={setGraphName}
                      onPresent={setGraphPresent}
                      onBrowseLibrary={() => setView('library')}
                      otherPlaying={playingName !== null || mixedName !== null}
                      otherPresent={mixedPresent}
                    />
                  </FeatureBoundary>
                </Suspense>
                {developmentSimulator && !audioRunning && (
                  <>
                    <Card
                      className="chain-panel mb-0 rounded-b-none bg-background text-foreground [box-shadow:none] [&_h2]:font-mono"
                      aria-label="Signal chain"
                    >
                      <div className="mb-4 flex min-w-0 flex-wrap items-center justify-between gap-3">
                        <div>
                          <Title as="h2" size="sm">
                            Signal chain
                          </Title>
                        </div>
                        <div
                          className="flex flex-wrap gap-1.5"
                          aria-label="Routing mode"
                        >
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
                      <details className="[&>summary]:justify-end [&>summary]:text-xs [&>summary]:text-muted-foreground">
                        <summary className="min-h-touch">
                          Routing details
                        </summary>
                        <Caption>
                          {parallel
                            ? 'Input splits into A and B, then merges before the shared delay and reverb.'
                            : 'One NAM path feeds the shared delay and reverb.'}{' '}
                          Routing validation is active; this preview does not
                          process audio.
                        </Caption>
                      </details>
                    </Card>
                    <Card
                      className="rounded-t-none border-t-0"
                      aria-label="Rig controls"
                    >
                      <div className="mb-4 flex min-w-0 flex-wrap items-center justify-between gap-3">
                        <div>
                          <Eyebrow>Quick controls</Eyebrow>
                          <Title as="h2" size="sm">
                            {blockNames[selectedBlock]}{' '}
                            <span className="text-sm text-muted-foreground">
                              / selected
                            </span>
                          </Title>
                        </div>
                        <span
                          className="input-source"
                          title="Last control input"
                        >
                          Input:
                          <strong data-testid="last-origin">
                            {state.origin}
                          </strong>
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-2 min-[680px]:grid-cols-4">
                        {state.parameters.map((parameter) => (
                          <div
                            className="grid min-w-0 gap-1.5 rounded-md border border-border bg-card p-2 data-[selected=true]:border-foreground [&_output]:font-mono [&_output]:tabular-nums"
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
                            <span className="text-base">{parameter.label}</span>
                            <ControlEditor
                              parameter={parameter}
                              state={state}
                              connected={connected}
                              accept={accept}
                            />
                          </div>
                        ))}
                      </div>
                    </Card>
                  </>
                )}
              </>
            ) : settingsSection === 'essentials' && setupOpen ? (
              // The first-run welcome stands on its own under the capsule
              // (C2), which already carries the wordmark.
              <FirstRun
                wordmark={false}
                onStep={(route) => {
                  setSetupOpen(false);
                  openSetupStep(route);
                }}
                onDone={() => {
                  setSetupOpen(false);
                  setView('rig');
                }}
              />
            ) : (
              <SettingsPage
                className="px-0 pt-4"
                sections={SETTINGS_SECTIONS}
                current={settingsSection}
                onSelect={(value) => {
                  const section = SETTINGS_SECTIONS.find(
                    ({ id }) => id === value,
                  );
                  if (section && section.id !== settingsSection)
                    leaveScreen(() => setSettingsSection(section.id));
                }}
              >
                {settingsSection === 'essentials' &&
                  (setupOpen ? (
                    <FirstRun
                      onStep={(route) => {
                        setSetupOpen(false);
                        openSetupStep(route);
                      }}
                      onDone={() => {
                        setSetupOpen(false);
                        setView('rig');
                      }}
                    />
                  ) : (
                    <>
                      <Suspense
                        fallback={<Loading label="Reading device checks…" />}
                      >
                        <SoundCheck
                          connected={connected}
                          displayMode={displayMode}
                          onGuitars={() => setView('guitars')}
                          onLibrary={() => setView('library')}
                          onAudioSetup={() => setSettingsSection('audio')}
                          beforePlay={{
                            storage: storage?.available
                              ? (storage.current ?? null)
                              : null,
                            onStorage: () => setSettingsSection('maintenance'),
                            onLevels: () => setView('monitor'),
                          }}
                        />
                      </Suspense>
                      <SettingGroup title="Setup">
                        <SettingRow
                          label="Setup guide"
                          caption="Step through audio, guitar, controller and network again."
                        >
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              window.location.hash =
                                'settings/essentials/setup';
                            }}
                          >
                            Open setup guide
                          </Button>
                        </SettingRow>
                      </SettingGroup>
                    </>
                  ))}
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
                    keepMenuOpen={keepMenuOpen}
                    onKeepMenuOpenChange={changeKeepMenuOpen}
                    help={
                      <SettingDisclosure label="Display & screen help">
                        <Caption>
                          Preferences are saved on this browser. Keep-awake
                          works while Oxidal is visible and retries when you
                          return. Browser power settings can release it;
                          fullscreen alone does not prevent sleep.
                        </Caption>
                        <Caption>
                          Night darkens every surface for a dark stage. Sunlight
                          is pure black on white. E-paper removes colour and
                          motion. Set brightness and e-paper refresh on your
                          device.
                        </Caption>
                      </SettingDisclosure>
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
                {settingsSection === 'nam' && (
                  <section
                    className="grid min-w-0 items-start gap-3 [&>button]:max-w-full [&>button]:justify-self-start"
                    aria-label="NAM engine controls"
                  >
                    <EngineSettings connected={connected} />
                    <NativeDefaults connected={connected} />
                  </section>
                )}
                {settingsSection === 'effects' && (
                  <InstalledEffects connected={connected} />
                )}
                {settingsSection === 'plugins' && (
                  <EffectPacks
                    connected={connected}
                    audioRunning={audioRunning}
                  />
                )}
                {settingsSection === 'device' && (
                  <>
                    <SettingGroup title="This device">
                      <SettingRow label="Memory">
                        {resource.readings.ram
                          ? `${(resource.readings.ram.total / 1024).toFixed(1)} GiB`
                          : 'Unavailable'}
                      </SettingRow>
                      <SettingRow label="Temperature">
                        {resource.readings.temperature != null
                          ? `${resource.readings.temperature.toFixed(0)} °C`
                          : 'Unavailable'}
                      </SettingRow>
                    </SettingGroup>
                    <DevicePower
                      key={powerAsk?.key ?? 0}
                      connected={connected}
                      ask={powerAsk?.action ?? null}
                      onAnswered={() => setPowerAsk(null)}
                    />
                  </>
                )}
                {settingsSection === 'maintenance' && (
                  <>
                    <SettingGroup title="Storage">
                      <SettingRow
                        label="Backup"
                        caption="Presets, set lists, descriptions, MIDI maps and local NAM and IR files."
                      >
                        <Button size="sm" variant="outline" asChild>
                          <a href="/api/v1/backup/library" download>
                            Download backup
                          </a>
                        </Button>
                      </SettingRow>
                      <SettingRow
                        label="Restore chord sheets"
                        caption="Open Songbook to review and restore a Songbook JSON backup."
                      >
                        <Button size="sm" variant="outline" asChild>
                          <a href="#library/songbook">Open Songbook</a>
                        </Button>
                      </SettingRow>
                    </SettingGroup>
                    <StorageLock
                      connected={connected}
                      state={storage}
                      onState={setStorage}
                    />
                    <SettingGroup title="Diagnostics">
                      <FeatureBoundary name="the terminal">
                        <Suspense
                          fallback={<Loading label="Loading terminal…" />}
                        >
                          <WebTerminal />
                        </Suspense>
                      </FeatureBoundary>
                      <DebugConsole />
                    </SettingGroup>
                    {developmentSimulator && (
                      <details className="grid gap-3 rounded-lg border border-border bg-card p-4">
                        <summary className="min-h-touch">
                          Rig validation inspector
                        </summary>
                        <FormField>
                          Rig JSON
                          <textarea
                            aria-label="Rig JSON"
                            rows={8}
                            value={draft || JSON.stringify(state.rig, null, 2)}
                            onChange={(event) => setDraft(event.target.value)}
                            spellCheck={false}
                          />
                        </FormField>
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
                    <Card>
                      <Title as="h2" size="sm">
                        MIDI mapping
                      </Title>
                      <p className="text-sm text-muted-foreground">
                        Current mapping:{' '}
                        {state.mappings.mappings
                          .map(
                            (mapping) => `CC ${mapping.cc} → ${mapping.target}`,
                          )
                          .join(', ') || 'none'}
                        . This form replaces the PoC knob mapping.
                      </p>
                      <FormGrid>
                        <FormField>
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
                        </FormField>
                        <FormField>
                          MIDI channel
                          <input
                            type="number"
                            min="1"
                            max="16"
                            value={channel}
                            onChange={(e) => setChannel(Number(e.target.value))}
                          />
                        </FormField>
                        <FormField>
                          CC number
                          <input
                            type="number"
                            min="0"
                            max="127"
                            value={cc}
                            onChange={(e) => setCc(Number(e.target.value))}
                          />
                        </FormField>
                        <FormField>
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
                        </FormField>
                      </FormGrid>
                      <FormGrid>
                        <FormField>
                          Mapped minimum (0–1)
                          <input
                            type="number"
                            min="0"
                            max="1"
                            step="0.01"
                            value={minimum}
                            onChange={(e) => setMinimum(Number(e.target.value))}
                          />
                        </FormField>
                        <FormField>
                          Mapped maximum (0–1)
                          <input
                            type="number"
                            min="0"
                            max="1"
                            step="0.01"
                            value={maximum}
                            onChange={(e) => setMaximum(Number(e.target.value))}
                          />
                        </FormField>
                        <FormField>
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
                        </FormField>
                      </FormGrid>
                      <div className="flex min-w-0 flex-wrap items-center gap-3">
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
                      <Caption>
                        Bypass and preset targets use absolute CC, linear 0–1
                        range, and no pickup. Values below 64 select off/serial;
                        64–127 select on/parallel.
                      </Caption>
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
                      <Caption>
                        Feedback updates supported displays, LEDs, or motors.
                        Ordinary knobs use pickup; they cannot physically follow
                        web edits.
                      </Caption>
                    </Card>
                    <Card>
                      <Title as="h2" size="sm">
                        MIDI simulator
                      </Title>
                      <p>
                        Inject a CC message into the running TONE3000 rig. The
                        simulator does not require a connected controller.
                      </p>
                      <FormField>
                        MIDI value
                        <input
                          aria-label="MIDI value"
                          type="number"
                          min="0"
                          max="127"
                          value={midiValue}
                          onChange={(e) => setMidiValue(Number(e.target.value))}
                        />
                      </FormField>
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
                      <div
                        className="mt-6 flex flex-col gap-3 rounded-lg bg-muted p-4 text-sm"
                        aria-label="MIDI feedback"
                      >
                        <Eyebrow>
                          Confirmed output / isolated feedback route
                        </Eyebrow>
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
                    </Card>
                  </>
                )}
              </SettingsPage>
            )}
          </div>
          <MediaSheets />
        </PerformanceTools>
      </AppShell>
    </ResourceContext.Provider>
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
