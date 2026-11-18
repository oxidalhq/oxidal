import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';
import { CONTROLLERS } from './controllers';
import { Footswitches, type StageState } from './footswitches';
import { StemMixer, type StemControls, type StemRole } from './stem-strip';
import { TapTempo } from './tap-tempo';
import {
  ChangeList,
  CompareToggle,
  VersionPicker,
  type PresetVersion,
} from './versions';
import { SceneChange, type SceneChangeSettings } from './scene-change';

/**
 * More rig parts on their own: versions and the change list, tap tempo,
 * the stem mixer, the foot controller and the scene change
 * settings. Each is checked to keep its size while its state changes.
 */
const meta: Meta = {
  title: 'Widgets/Rig parts 2',
  parameters: { layout: 'padded' },
};
export default meta;

/** Layout size: a press animation (a transform) does not count as moving anything. */
const size = (el: Element) => {
  const box = el as HTMLElement;
  return [box.offsetWidth, box.offsetHeight];
};

const VERSIONS: PresetVersion[] = [
  {
    id: 'v1',
    name: 'Default',
    note: 'Saved at home · 12 Nov',
    isDefault: true,
  },
  { id: 'v2', name: 'Friday gig', note: 'Saved at the venue · 14 Nov' },
];

function Versions() {
  const [current, setCurrent] = useState('v1');
  const [changes, setChanges] = useState(2);
  const [compare, setCompare] = useState<'edited' | 'saved'>('edited');
  return (
    <div className="grid gap-3">
      <VersionPicker
        presetName="Rhythm section"
        versions={VERSIONS}
        current={current}
        changes={changes}
        onSelect={setCurrent}
        onSave={() => setChanges(0)}
        onSaveAs={() => setChanges(0)}
        onMakeDefault={() => {}}
        onDiscard={() => setChanges(0)}
      />
      <CompareToggle value={compare} onChange={setCompare} />
      <ChangeList
        changes={[
          {
            kind: 'value',
            block: 'ts9',
            blockLabel: 'TS9',
            control: 'drive',
            label: 'Drive',
            from: 4,
            to: 6,
          },
        ]}
      />
    </div>
  );
}

export const VersionsAndChanges: StoryObj = {
  name: 'Versions, compare and change list',
  render: () => <Versions />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('radio', { name: /Saved/ }));
    await expect(canvas.getByRole('radio', { name: /Saved/ })).toBeChecked();
  },
};

function Tap() {
  const [bpm, setBpm] = useState(118);
  return (
    <div className="grid justify-items-start gap-2">
      <TapTempo bpm={bpm} onBpm={setBpm} trackBpm={118} />
    </div>
  );
}

export const TapTempoStory: StoryObj = {
  name: 'Tap tempo',
  render: () => <Tap />,
  play: async ({ canvasElement }) => {
    const root =
      canvasElement.querySelector('[data-slot=tap-tempo]') ??
      canvasElement.firstElementChild!;
    const start = size(root);
    const buttons = within(canvasElement).getAllByRole('button');
    for (let i = 0; i < 3; i++) await userEvent.click(buttons[0]!);
    await expect(size(root)[1]).toBe(start[1]);
  },
};

const ROLES: StemRole[] = [
  'vocals',
  'drums',
  'bass',
  'guitar',
  'piano',
  'other',
];

function Stems() {
  const [stems, setStems] = useState<Partial<Record<StemRole, StemControls>>>(
    Object.fromEntries(
      ROLES.map((r) => [r, { level: 0, muted: false, solo: false }]),
    ),
  );
  return (
    <StemMixer
      stems={stems}
      onChange={(role, next) => setStems((s) => ({ ...s, [role]: next }))}
      className="h-56"
    />
  );
}

export const StemMixerStory: StoryObj = {
  name: 'Stem mixer',
  render: () => <Stems />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const mixer =
      canvasElement.querySelector('[data-slot=stem-mixer]') ??
      canvasElement.firstElementChild!;
    const start = size(mixer);
    await userEvent.click(canvas.getAllByRole('button', { name: /Mute/ })[0]!);
    await expect(size(mixer)).toEqual(start);
  },
};

const STAGE: StageState = {
  scene: 'a',
  scenes: [
    { id: 'a', name: 'Verse' },
    { id: 'b', name: 'Chorus' },
    { id: 'c', name: 'Lead' },
    { id: 'd', name: 'Swells' },
  ],
  blocks: {
    ts9: { label: 'TS9', on: false },
    echo: { label: 'Echo', on: true },
  },
  boost: false,
  tuner: false,
  playing: false,
  loop: false,
  bpm: 118,
};

function Pedal() {
  const [state, setState] = useState(STAGE);
  return (
    <div className="grid gap-4">
      {CONTROLLERS.map((profile) => (
        <Footswitches
          key={profile.id}
          profile={profile}
          state={state}
          onAction={(a) =>
            setState((s) =>
              a.kind === 'scene'
                ? { ...s, scene: a.scene }
                : a.kind === 'play'
                  ? { ...s, playing: !s.playing }
                  : s,
            )
          }
        />
      ))}
    </div>
  );
}

export const FootswitchesStory: StoryObj = {
  name: 'Foot controllers',
  render: () => <Pedal />,
  play: async ({ canvasElement }) => {
    const tiles = [
      ...canvasElement.querySelectorAll('[data-slot=footswitches] button'),
    ];
    const before = tiles.map(size);
    await userEvent.click(tiles[1]!);
    await expect(tiles.map(size)).toEqual(before);
    // Let the press flash (180 ms) and its colour transition finish.
    await new Promise((done) => setTimeout(done, 500));
  },
};

function Change() {
  const [value, setValue] = useState<SceneChangeSettings>({
    mode: 'trails',
    fadeMs: 30,
    presetTrails: true,
  });
  return <SceneChange value={value} onChange={setValue} />;
}

export const SceneChangeStory: StoryObj = {
  name: 'Scene change settings',
  render: () => <Change />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const root = canvasElement.querySelector('[data-slot=scene-change]')!;
    const start = size(root)[0];
    await userEvent.click(canvas.getByRole('radio', { name: 'Blend' }));
    await expect(size(root)[0]).toBe(start);
  },
};
