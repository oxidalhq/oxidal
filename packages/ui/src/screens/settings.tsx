import { ArrowsClockwise } from '@phosphor-icons/react';
import { useState } from 'react';

import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { NumberField } from '../components/ui/number-field';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import { Switch } from '../components/ui/switch';
import { Readout } from '../components/ui/text';
import { STACK_CREDITS } from '../lib/credits';
import { DEFAULT_MAP } from '../lib/midi';
import { AboutPage } from '../patterns/about-page';
import { PageHeading } from '../patterns/app-shell';
import { AudioChangeDemo } from '../patterns/audio-change.demo';
import {
  ControllerSetupDemo,
  ExtraControllersDemo,
} from '../patterns/controller-setup.demo';
import {
  BootPlaybackDemo,
  DebugConsoleDemo,
  StorageLockDemo,
} from '../patterns/device-flows.demo';
import { DevicePower } from '../patterns/device-power';
import { DisplaySettings } from '../patterns/display-settings';
import {
  BuiltInEffectsDemo,
  NamEngineDemo,
  PluginPacksDemo,
} from '../patterns/engine-settings.demo';
import { SoundCheck } from '../patterns/guitar-tools';
import { NetworkSettingsDemo } from '../patterns/network-settings.demo';
import {
  SettingDisclosure,
  SettingGroup,
  SettingRow,
  SettingsPage,
} from '../patterns/settings-page';
import { SETTINGS_SECTIONS } from '../patterns/settings-sections';
import { Tone3000AccountDemo } from '../patterns/tone3000.demo';
import { MidiBar, MidiProvider } from '../widgets/midi';
import { PretendController, WebMidiButton } from '../widgets/midi-controller';
import { MidiMap } from '../widgets/midi-map';

function Audio() {
  return (
    <>
      <SettingGroup title="Device">
        <SettingRow
          id="device"
          label="Audio interface"
          caption="Hotone Jogg · USB · 2 in, 2 out"
        >
          <Select defaultValue="jogg">
            <SelectTrigger id="device" size="sm" className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="jogg">Hotone Jogg</SelectItem>
              <SelectItem value="scarlett">Scarlett 2i2</SelectItem>
            </SelectContent>
          </Select>
        </SettingRow>
      </SettingGroup>
      <AudioChangeDemo />
      <BootPlaybackDemo />
      <SettingGroup title="Playback">
        <SettingRow label="Audio" caption="Running · 0 xruns in 12 min">
          <Button size="sm" variant="outline">
            <ArrowsClockwise /> Restart
          </Button>
          <Button size="sm" variant="destructive">
            Stop
          </Button>
        </SettingRow>
      </SettingGroup>
    </>
  );
}

function Accounts() {
  return (
    <>
      <Tone3000AccountDemo initial="connected" />
      <SettingGroup title="TONE3000">
        <SettingRow
          id="auto"
          label="Keep auditioned tones"
          caption="Saves a copy of any tone you audition for ten seconds or more."
        >
          <Switch id="auto" />
        </SettingRow>
      </SettingGroup>
    </>
  );
}

function Midi() {
  return (
    <MidiProvider initial={DEFAULT_MAP}>
      <SettingGroup title="Controller">
        <SettingRow
          label="M-Vave Chocolate"
          caption="Bluetooth · 4 switches · mode A"
        >
          <Badge tone="live">Connected</Badge>
        </SettingRow>
        <SettingRow label="MIDI Captain STD 10" caption="USB · not connected">
          <Button size="sm" variant="ghost">
            Set up…
          </Button>
        </SettingRow>
      </SettingGroup>
      <ControllerSetupDemo />
      <ExtraControllersDemo />
      <SettingGroup title="Switches">
        {[
          'A · Scene 1',
          'B · Scene 2',
          'C · Next preset',
          'D · Tuner (hold: tap tempo)',
        ].map((s) => (
          <SettingRow key={s} label={s}>
            <Button size="sm" variant="ghost">
              Learn…
            </Button>
          </SettingRow>
        ))}
      </SettingGroup>
      <SettingGroup title="Map">
        <MidiBar className="mb-2" />
        <MidiMap />
      </SettingGroup>
      <SettingGroup title="Try it without a pedal">
        <PretendController />
        <WebMidiButton />
      </SettingGroup>
    </MidiProvider>
  );
}

function Display() {
  const [mode, setMode] = useState('default');
  const [status, setStatus] = useState<'simple' | 'detailed'>('detailed');
  const [awake, setAwake] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  return (
    <DisplaySettings
      mode={mode}
      onModeChange={setMode}
      status={status}
      onStatusChange={setStatus}
      keepAwake={awake}
      onKeepAwakeChange={setAwake}
      fullscreen={fullscreen}
      onToggleFullscreen={() => setFullscreen(!fullscreen)}
    />
  );
}

function Device() {
  const [threshold, setThreshold] = useState(80);
  const [powerAction, setPowerAction] = useState<'reboot' | 'shutdown' | null>(
    null,
  );
  const [powerReceipt, setPowerReceipt] = useState('');
  return (
    <>
      <SettingGroup title="This device">
        <SettingRow
          label="Raspberry Pi 5"
          caption="8 GB · 32 GB card · 58° now"
        >
          <Badge>Oxidal 0.1.0</Badge>
        </SettingRow>
        <SettingRow
          id="temp"
          label="Protect above"
          caption="Pauses preparation jobs when the SoC is hotter than this."
        >
          <NumberField
            label="Protect above"
            value={threshold}
            onChange={setThreshold}
            min={60}
            max={90}
            step={1}
            unit="°"
            digits={0}
            size="sm"
          />
        </SettingRow>
      </SettingGroup>
      <DevicePower
        action={powerAction}
        disabled={Boolean(powerReceipt)}
        notice={
          powerReceipt && (
            <p role="status" className="text-sm">
              {powerReceipt}
            </p>
          )
        }
        onRequest={setPowerAction}
        onCancel={() => setPowerAction(null)}
        onConfirm={() => {
          setPowerReceipt(
            `Demo: ${powerAction === 'reboot' ? 'restart' : 'shutdown'} requested.`,
          );
          setPowerAction(null);
        }}
      />
    </>
  );
}

function Maintenance() {
  return (
    <>
      <SettingGroup title="Storage">
        <SettingRow
          label="Used"
          caption="Models 2.1 GB · tracks and stems 4.8 GB · recordings 0.3 GB"
        >
          <Readout size="sm">7.2 / 28 GB</Readout>
        </SettingRow>
        <SettingRow
          label="Backup"
          caption="Presets, set lists, descriptions, MIDI maps and local NAM and IR files."
        >
          <Button size="sm" variant="outline">
            Download backup
          </Button>
        </SettingRow>
        <SettingRow
          label="Restore chord sheets"
          caption="Open Songbook to review and restore a Songbook JSON backup."
        >
          <Button size="sm" variant="outline" asChild>
            <a href="?id=patterns-songbook--connected-layout">Open Songbook</a>
          </Button>
        </SettingRow>
      </SettingGroup>
      <SettingDisclosure label="Advanced">
        <SettingRow
          label="Debug shell"
          caption="A bounded shell for support. Off unless you turn it on."
        >
          <Switch aria-label="Debug shell" />
        </SettingRow>
        <SettingRow label="Logs">
          <Button size="sm" variant="ghost">
            Download logs
          </Button>
        </SettingRow>
      </SettingDisclosure>
      <StorageLockDemo />
      <DebugConsoleDemo />
    </>
  );
}

function About() {
  return (
    <AboutPage
      credits={STACK_CREDITS.slice(0, 4)}
      madeWith={STACK_CREDITS.slice(4)}
      device={[
        { label: 'Version', value: '0.1.0' },
        { label: 'Audio', value: 'Available' },
        { label: 'MIDI', value: 'Bluetooth and USB' },
        { label: 'TONE3000 engine', value: 'Installed' },
      ]}
    />
  );
}

function Essentials() {
  return (
    <>
      <SoundCheck
        plain
        title="Before you play"
        caption="What needs a look is first"
        checks={[
          {
            ok: false,
            title: 'Lead boost is 4 dB louder than your other presets',
            fix: 'Even out all sets every preset to the same loudness.',
            action: 'Even out all',
          },
          {
            ok: false,
            title: 'System storage is unlocked',
            fix: 'Lock it before the gig so a power cut cannot damage it.',
            action: 'Lock storage',
          },
          {
            ok: true,
            title: 'Output: stereo, master −6 dB, Venue EQ "Friday gig"',
            fix: 'Peak boost +3 dB, with 5 dB to spare.',
            action: 'Open levels',
          },
          {
            ok: true,
            title: 'Audio: 128 × 3 at 48 kHz, 8.0 ms round trip',
            fix: 'No dropouts in the last hour on the Hotone Jogg.',
            action: 'Audio',
          },
          {
            ok: true,
            title: 'Foot controller: MIDI Captain, 10 switches',
            fix: 'Scenes layout; every switch was checked on 14 Nov.',
            action: 'MIDI',
          },
          {
            ok: true,
            title: 'Set list: Friday set, 6 songs',
            fix: 'Every preset, capture and backing track is on the device.',
            action: 'Open set list',
          },
          {
            ok: true,
            title: 'Reachable on the hotspot Oxidal-7F2A',
            fix: 'It turns on by itself when no saved Wi-Fi is in range.',
            action: 'Network',
          },
        ]}
      />
      <SettingGroup title="Setup">
        <SettingRow
          label="Setup guide"
          caption="Step through audio, guitar, controller and network again."
        >
          <Button size="sm" variant="outline">
            Open setup guide
          </Button>
        </SettingRow>
      </SettingGroup>
    </>
  );
}

const PAGES: Record<string, () => React.JSX.Element> = {
  essentials: Essentials,
  audio: Audio,
  connections: NetworkSettingsDemo,
  accounts: Accounts,
  midi: Midi,
  nam: NamEngineDemo,
  effects: BuiltInEffectsDemo,
  plugins: () => <PluginPacksDemo />,
  display: Display,
  device: Device,
  maintenance: Maintenance,
  about: About,
};

export function Settings({ section: initial = 'audio' }: { section?: string }) {
  const [section, setSection] = useState(initial);
  const Page = PAGES[section] ?? Audio;
  return (
    <>
      <PageHeading eyebrow="Settings" title="Settings" className="md:hidden" />
      <SettingsPage
        sections={SETTINGS_SECTIONS}
        current={section}
        onSelect={setSection}
        className="pt-4"
      >
        <Page />
      </SettingsPage>
    </>
  );
}
