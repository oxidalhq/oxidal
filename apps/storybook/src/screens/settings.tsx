import { useState } from 'react';
import { ArrowsClockwise } from '@phosphor-icons/react';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { CollapsibleSection } from '../components/ui/collapsible';
import { NumberField } from '../components/ui/number-field';
import { Segment, SegmentedControl } from '../components/ui/segmented';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import { Switch } from '../components/ui/switch';
import { Caption, Readout, Title } from '../components/ui/text';
import { PageHeading } from '../patterns/app-shell';
import { Credits } from '../patterns/credits';
import { STACK_CREDITS } from '../patterns/credits.data';
import {
  SettingGroup,
  SettingRow,
  SettingsPage,
} from '../patterns/settings-page';
import { SETTINGS_SECTIONS } from './settings.sections';
import { AudioChangeDemo } from '../patterns/audio-change.demo';
import { Tone3000AccountDemo } from '../patterns/tone3000.demo';
import { NetworkSettingsDemo } from '../patterns/network-settings.demo';
import {
  BootPlaybackDemo,
  DebugConsoleDemo,
  StorageLockDemo,
} from '../patterns/device-flows.demo';
import {
  ControllerSetupDemo,
  ExtraControllersDemo,
} from '../patterns/controller-setup.demo';
import {
  BuiltInEffectsDemo,
  NamEngineDemo,
  PluginPacksDemo,
} from '../patterns/engine-settings.demo';
import { DEFAULT_MAP } from '../lib/midi';
import { MidiBar, MidiProvider } from '../widgets/midi';
import { PretendController, WebMidiButton } from '../widgets/midi-controller';
import { MidiMap } from '../widgets/midi-map';
import { SoundCheck } from '../patterns/guitar-tools';

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
  const [status, setStatus] = useState('simple');
  return (
    <>
      <SettingGroup title="Look">
        <SettingRow
          label="Display mode"
          caption="Night for the stage, Sunlight outdoors, E-paper on BOOX."
          stacked
        >
          <SegmentedControl
            value={mode}
            onValueChange={setMode}
            aria-label="Display mode"
            className="w-full"
          >
            <Segment value="default">Default</Segment>
            <Segment value="stage">Night</Segment>
            <Segment value="sunlight">Sunlight</Segment>
            <Segment value="epaper">E-paper</Segment>
          </SegmentedControl>
        </SettingRow>
      </SettingGroup>
      <SettingGroup title="Device status">
        <SettingRow
          label="Status at the top"
          caption={
            status === 'simple'
              ? 'One word: All good, Busy, Dropouts or Running hot. Tap it for the numbers.'
              : 'The full strip: processing, CPU, memory, temperature, dropouts and clips.'
          }
          stacked
        >
          <SegmentedControl
            value={status}
            onValueChange={setStatus}
            aria-label="Status at the top"
            className="w-full"
          >
            <Segment value="simple">Simple</Segment>
            <Segment value="detailed">Detailed</Segment>
          </SegmentedControl>
        </SettingRow>
      </SettingGroup>
      <SettingGroup title="Screen">
        <SettingRow
          id="awake"
          label="Keep screen awake"
          caption="While this page is open."
        >
          <Switch id="awake" defaultChecked />
        </SettingRow>
        <SettingRow label="Fullscreen">
          <Button size="sm" variant="outline">
            Enter fullscreen
          </Button>
        </SettingRow>
      </SettingGroup>
    </>
  );
}

function Device() {
  const [threshold, setThreshold] = useState(80);
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
      <SettingGroup title="Power">
        <SettingRow label="Reboot">
          <Button size="sm" variant="outline">
            Reboot…
          </Button>
        </SettingRow>
        <SettingRow
          label="Shut down"
          caption="Wait for the light before unplugging."
        >
          <Button size="sm" variant="destructive">
            Shut down…
          </Button>
        </SettingRow>
      </SettingGroup>
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
          caption="Presets, set lists and settings as one file."
        >
          <Button size="sm" variant="outline">
            Download backup
          </Button>
          <Button size="sm" variant="ghost">
            Restore…
          </Button>
        </SettingRow>
      </SettingGroup>
      <CollapsibleSection title="Advanced">
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
      </CollapsibleSection>
      <StorageLockDemo />
      <DebugConsoleDemo />
    </>
  );
}

function About() {
  return (
    <div className="grid gap-6">
      <div className="grid justify-items-center gap-3 rounded-lg bg-enclosure px-6 py-8 text-center text-enclosure-foreground">
        <img
          src="/brand/wordmark-white.svg"
          alt="Oxidal"
          className="h-10 w-auto"
        />
        <span className="small-caps text-sm font-medium text-enclosure-foreground/80">
          Multi-effects amp modeler · guitar and bass
        </span>
        <p className="m-0 max-w-md text-md text-enclosure-foreground/85">
          Turn a Raspberry Pi 5 and your audio interface into a complete guitar
          and bass rig, played from this browser.
        </p>
        <Credits credits={STACK_CREDITS.slice(0, 4)} dark />
      </div>
      <div className="grid gap-2">
        <Title as="h3" size="sm">
          This device
        </Title>
        {[
          ['Version', '0.1.0'],
          ['Audio', 'Available'],
          ['MIDI', 'Bluetooth and USB'],
          ['TONE3000 engine', 'Installed'],
        ].map(([k, v]) => (
          <SettingRow key={k} label={k}>
            <Readout size="sm">{v}</Readout>
          </SettingRow>
        ))}
      </div>
      <div className="grid gap-2">
        <Title as="h3" size="sm">
          Made with
        </Title>
        <Credits credits={STACK_CREDITS.slice(4)} className="justify-start" />
        <Caption>
          Open source under the Apache License 2.0; some optional native
          components use separately licensed dependencies. The Oxidal name and
          logo are not covered by the licence. Third-party licences are listed
          in THIRD_PARTY.md.
        </Caption>
      </div>
    </div>
  );
}

/** Before you play: the state of the things that matter at a gig, each with one action. */
function Essentials() {
  return (
    <SoundCheck
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
