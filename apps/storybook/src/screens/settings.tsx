import { useState } from 'react';
import { ArrowsClockwise } from '@phosphor-icons/react';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Checkbox } from '../components/ui/checkbox';
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
import { DEFAULT_MAP } from '../lib/midi';
import { MidiBar, MidiProvider } from '../widgets/midi';
import { PretendController, WebMidiButton } from '../widgets/midi-controller';
import { MidiMap } from '../widgets/midi-map';

function Audio() {
  const [buffer, setBuffer] = useState('96x3');
  const [boot, setBoot] = useState(true);
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
        <SettingRow id="rate" label="Sample rate">
          <Readout size="sm">48 kHz</Readout>
        </SettingRow>
        <SettingRow
          label="Buffer"
          caption="Frames × periods. 96 × 3 is 6 ms; smaller may crackle on heavy presets."
          stacked
        >
          <SegmentedControl
            value={buffer}
            onValueChange={setBuffer}
            aria-label="Buffer"
          >
            <Segment value="48x2">48 × 2</Segment>
            <Segment value="96x3">96 × 3</Segment>
            <Segment value="128x3">128 × 3</Segment>
            <Segment value="256x3">256 × 3</Segment>
          </SegmentedControl>
          <Button size="sm" variant="outline">
            Buffer finder…
          </Button>
        </SettingRow>
      </SettingGroup>
      <SettingGroup title="Playback">
        <SettingRow
          id="boot"
          label="Play on boot"
          caption="Starts the last preset when the device powers up."
        >
          <Switch id="boot" checked={boot} onCheckedChange={setBoot} />
        </SettingRow>
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

function Network() {
  return (
    <>
      <SettingGroup title="Wi-Fi">
        <SettingRow label="Home" caption="Connected · 192.168.1.169">
          <Badge tone="live">Connected</Badge>
        </SettingRow>
        <SettingRow label="Rehearsal room" caption="Saved">
          <Button size="sm" variant="ghost">
            Join
          </Button>
        </SettingRow>
        <SettingRow label="Add a network">
          <Button size="sm" variant="outline">
            Scan…
          </Button>
        </SettingRow>
      </SettingGroup>
      <SettingGroup title="Hotspot">
        <SettingRow
          id="hotspot"
          label="Hotspot when no Wi-Fi"
          caption="Oxidal-7F2A · the phone joins it at the gig."
        >
          <Switch id="hotspot" defaultChecked />
        </SettingRow>
        <SettingRow label="Hotspot password">
          <Button size="sm" variant="ghost">
            Show
          </Button>
        </SettingRow>
      </SettingGroup>
    </>
  );
}

function Accounts() {
  return (
    <SettingGroup title="TONE3000">
      <SettingRow
        label="Signed in as rix"
        caption="Keeps tones you choose and shows their creators and licences."
      >
        <Button size="sm" variant="outline">
          Sign out
        </Button>
      </SettingRow>
      <SettingRow
        id="auto"
        label="Keep auditioned tones"
        caption="Saves a copy of any tone you audition for ten seconds or more."
      >
        <Switch id="auto" />
      </SettingRow>
    </SettingGroup>
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

function Effects() {
  return (
    <>
      <SettingGroup title="Oxidal effects">
        {[
          'Bloom reverb',
          'Echo delay',
          'Motion',
          'Sustain',
          'Hold',
          'Swell',
          'Pitch',
        ].map((e, i) => (
          <SettingRow
            key={e}
            label={e}
            caption={
              i < 4
                ? 'Safe Rust · built in'
                : i === 6
                  ? 'Port of the TONE3000 pitch engine'
                  : 'Native plugin'
            }
          >
            <Checkbox defaultChecked aria-label={e} />
          </SettingRow>
        ))}
      </SettingGroup>
      <SettingGroup title="LV2 plugins">
        <SettingRow
          label="Qualified set"
          caption="31 plugins · drives, fuzzes, compressors, filters, delays, reverbs"
        >
          <Button size="sm" variant="outline">
            Manage…
          </Button>
        </SettingRow>
      </SettingGroup>
    </>
  );
}

function Display() {
  const [mode, setMode] = useState('default');
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

const PAGES: Record<string, () => React.JSX.Element> = {
  audio: Audio,
  connections: Network,
  accounts: Accounts,
  midi: Midi,
  effects: Effects,
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
