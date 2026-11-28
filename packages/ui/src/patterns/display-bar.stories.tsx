import { FloppyDisk, Lightning } from '@phosphor-icons/react';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { Button } from '../components/ui/button';
import type {
  ResourceReadings,
  ResourceState,
} from '../widgets/resource-strip';
import { AppShell, PlayingPreset } from './app-shell';
import { RigHeading } from './rig-heading';

/**
 * The top bar on a wide screen: the main menu behind one button, what is
 * playing, tempo, input and output peaks, processing load and health. The
 * Rig draws its own preset picker and buttons into the bar. Open the menu
 * and the health reading to see them; narrow the viewport below 768 px for
 * the phone masthead and bottom bar, which are unchanged.
 */
const meta: Meta = {
  title: 'Patterns/Display bar',
  parameters: { layout: 'fullscreen' },
};
export default meta;
type Story = StoryObj;

const OK: ResourceReadings = {
  dsp: { p95: 0.2, peak: 0.51 },
  cpu: 31,
  ram: { used: 512, total: 8192 },
  xruns: 0,
  clips: 0,
  temperature: 60,
};
const LEVELS = {
  input: [-18, -20] as [number, number],
  output: [-6, -2] as [number, number],
};

function Bar({
  readings = OK,
  state = 'live',
  destination = 'rig',
  playing = true,
  hot = false,
}: {
  readings?: ResourceReadings;
  state?: ResourceState;
  destination?: 'rig' | 'library';
  playing?: boolean;
  hot?: boolean;
}) {
  return (
    <AppShell
      destination={destination}
      onNavigate={() => undefined}
      nowPlaying={
        <PlayingPreset name={playing ? 'Oxidal · Harmonic Tremolo' : null} />
      }
      readings={readings}
      resourceState={state}
      bar="display"
      tempo={playing ? { bpm: 112, source: 'the preset' } : null}
      levels={
        playing
          ? hot
            ? { input: [-9, -10], output: [-1, -0.5] }
            : LEVELS
          : null
      }
    >
      {destination === 'rig' ? (
        <RigHeading playing={playing} identity={<PresetName />}>
          <Button size="sm">
            <Lightning /> Perform
          </Button>
          <Button size="sm" variant="outline">
            <FloppyDisk /> Save
          </Button>
          <Button size="sm" variant="ghost">
            Tuner
          </Button>
          <Button size="sm" variant="ghost">
            More
          </Button>
        </RigHeading>
      ) : (
        <p className="p-6 text-sm text-muted-foreground">
          Library. Screens without their own header actions show the bar with
          the menu, what is playing and health.
        </p>
      )}
      <p className="p-6 text-sm text-muted-foreground">
        The page content starts directly under the bar. There is no separate
        heading row and no strip of meters.
      </p>
    </AppShell>
  );
}

function PresetName() {
  return (
    <button className="flex items-center gap-1 rounded-md px-2 py-1 font-serif text-lg font-semibold hover:bg-accent">
      Harmonic Tremolo ▾
    </button>
  );
}

/** Playing: tempo, peaks, DSP and CPU, and the Rig's own buttons in the bar. */
export const Playing: Story = { render: () => <Bar /> };

/** Heavy load and clipping: health turns to a warning and the peaks turn orange. */
export const RunningHot: Story = {
  render: () => (
    <Bar
      hot
      readings={{
        ...OK,
        dsp: { p95: 0.78, peak: 0.95 },
        cpu: 88,
        xruns: 3,
        clips: 12,
        temperature: 82,
      }}
    />
  ),
};

/** Audio stopped: tempo, peaks and numbers are left out; health says why. */
export const AudioStopped: Story = {
  render: () => <Bar state="stopped" playing={false} readings={{}} />,
};

/** The screen lost the device. */
export const Disconnected: Story = {
  render: () => <Bar state="disconnected" playing={false} readings={{}} />,
};

/** Another screen: the same bar without a screen's own buttons. */
export const OtherScreen: Story = {
  render: () => <Bar destination="library" />,
};
