import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, userEvent, waitFor, within } from 'storybook/test';

import { NoticeTray } from '../components/ui/notice-tray';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetHeader,
} from '../components/ui/sheet';
import { Caption } from '../components/ui/text';
import { DEFAULT_MAP } from '../lib/midi';
import { MidiBar, MidiProvider } from '../widgets/midi';
import { PretendController, WebMidiButton } from '../widgets/midi-controller';
import { MidiMap } from '../widgets/midi-map';
import { SCENES, SERIAL_ROUTE } from './rig.fixtures';
import { RigSurface } from './rig-surface';
import { useRigDemo } from './use-rig.demo';

/**
 * MIDI Learn on every control. Turn on the MIDI view: every control you can
 * map is outlined with its mapping; tap one, then move a knob or press a
 * switch on your controller (or on the pretend controller here, or a real
 * one through "Use a MIDI device" in Chrome). Right-click any control on a
 * laptop to learn it without the view. "Whole map" lists everything, with
 * clashes.
 */
const meta: Meta = {
  title: 'Patterns/MIDI Learn',
  parameters: { layout: 'fullscreen' },
};
export default meta;

function Rig() {
  const rig = useRigDemo(SERIAL_ROUTE);
  return (
    <RigSurface
      presetName="Rhythm section"
      playing
      route={rig.route}
      saved={rig.saved}
      onRoute={rig.onRoute}
      versions={rig.versions}
      currentVersion={rig.current}
      onVersion={rig.onVersion}
      onSaveVersion={rig.onSaveVersion}
      onSaveVersionAs={rig.onSaveVersionAs}
      onMakeDefault={rig.onMakeDefault}
      scenes={SCENES}
      activeScene={rig.scene}
      onScene={rig.onScene}
      sceneChanged={rig.sceneChanged}
      onAudition={rig.onAudition}
    />
  );
}

function Demo() {
  const [map, setMap] = useState(false);
  return (
    <MidiProvider initial={DEFAULT_MAP}>
      <div className="grid gap-4 py-3 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="grid min-w-0 content-start gap-2">
          <MidiBar onOpenMap={() => setMap(true)} className="mx-page" />
          <Rig />
        </div>
        <aside className="mx-page grid content-start gap-3 lg:mx-0 lg:mr-page">
          <PretendController />
          <WebMidiButton />
          <Caption className="text-xs">
            The default map (D-9) is loaded: scenes on CC 16–23, Previous and
            Next on 24 and 25, Tuner 26, Tap 27, Boost 28, Protect 29, block
            on/off from CC 48.
          </Caption>
        </aside>
      </div>
      <Sheet open={map} onOpenChange={setMap}>
        <SheetContent onOpenChange={setMap} className="md:w-[min(36rem,100vw)]">
          <SheetHeader
            title="MIDI map"
            description="Everything you can control from your foot controller."
          />
          <SheetBody>
            <MidiMap />
          </SheetBody>
        </SheetContent>
      </Sheet>
      <NoticeTray />
    </MidiProvider>
  );
}

export const Learn: StoryObj = {
  name: 'Learn, map and play',
  render: () => <Demo />,
};

/** Show scenes, learn Scene 3 from switch C, then press C to play it. */
Learn.play = async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  const page = within(canvasElement.ownerDocument.body);
  await userEvent.click(canvas.getByRole('button', { name: /Scenes/ }));
  await userEvent.click(canvas.getByRole('button', { name: /MIDI view/ }));
  await userEvent.click(
    canvas.getByRole('button', { name: /MIDI for Scene 3 · Lead \(CC 18/ }),
  );
  await expect(canvas.getByText(/Move a knob or press a switch/)).toBeVisible();
  await userEvent.click(canvas.getByRole('button', { name: /^C CC 22/ }));
  await waitFor(() =>
    expect(
      canvas.getByRole('button', {
        name: /MIDI for Scene 3 · Lead \(CC 22 · ch 1\)/,
      }),
    ).toBeVisible(),
  );
  // CC 22 is Scene 7 in the default map: the notice says so and offers to move it.
  await expect(
    await page.findByText(
      /Scene 3 · Lead is on CC 22 · ch 1, which also does Scene 7/,
    ),
  ).toBeVisible();
  await userEvent.click(page.getByRole('button', { name: 'Use it only here' }));
  await userEvent.click(canvas.getByRole('button', { name: /MIDI view/ }));
  await userEvent.click(canvas.getByRole('button', { name: /^C CC 22/ }));
  await waitFor(() =>
    expect(canvas.getByRole('button', { name: /^Scene 3/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    ),
  );
};

function MapOnly() {
  return (
    <MidiProvider
      initial={[
        ...DEFAULT_MAP.filter((m) => m.target !== 'stage:tuner'),
        {
          target: 'stage:tuner',
          address: { kind: 'cc', channel: 1, number: 18 },
          mode: 'toggle',
        },
      ]}
    >
      <div className="max-w-2xl p-page">
        <MidiMap />
      </div>
    </MidiProvider>
  );
}

export const MapWithClash: StoryObj = {
  name: 'Whole map, with a clash',
  render: () => <MapOnly />,
};
