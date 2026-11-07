import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { MixedRig } from './MixedRig';
import { setPerform } from './performState';
import { playScenes } from './presetChoices';
import {
  installedLv2,
  libraryCatalog,
  publishRig,
  rigAudioState,
  rigAudioCommand,
  rigDocument,
  rigLibrary,
} from './api';
import { lv2Effect } from './rigDraft';
import { buildRoute } from './rigRoute';
import { chainLanes } from './rigChain';
vi.mock('./api', () => ({
  rigAudioState: vi.fn(),
  rigAudioCommand: vi.fn(),
  rigDocument: vi.fn(),
  publishRig: vi.fn(),
  installedLv2: vi.fn(),
  rigLibrary: vi.fn(),
  libraryCatalog: vi.fn(),
  sceneBlends: vi.fn(async () => null),
}));
vi.mock('./presetChoices', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./presetChoices')>()),
  playScenes: vi.fn(),
}));
// The picker has its own tests; here it only needs to render.
vi.mock('./RigPresetSelector', () => ({ RigPresetSelector: () => null }));
vi.mock('./GuitarSettings', () => ({
  GuitarPicker: () => null,
  GuitarSwitch: () => null,
}));
vi.mock('./ModelPicker', () => ({
  ModelPicker: ({ name }: { name: string }) => (
    <div data-testid="model-picker">{name}</div>
  ),
}));
vi.mock('./AssetArtwork', () => ({
  ArtworkDeck: ({ id }: { id: string }) => (
    <div data-testid="model-artwork">{id}</div>
  ),
}));
vi.mock('./LiveEq', () => ({ LiveEq: () => null }));
vi.mock('./SceneMidi', () => ({ SceneMidi: () => null }));
beforeEach(() => {
  sessionStorage.clear();
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: {
      configurable: true,
      value: function (this: HTMLDialogElement) {
        this.open = true;
      },
    },
    close: {
      configurable: true,
      value: function (this: HTMLDialogElement) {
        this.open = false;
      },
    },
  });
});
afterEach(() => {
  setPerform({ on: false, mode: 'play' });
  cleanup();
  sessionStorage.clear();
  vi.resetAllMocks();
  Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal');
  Reflect.deleteProperty(HTMLDialogElement.prototype, 'close');
});
function setup(
  origin: 'mine' | 'oxidal_example' = 'mine',
  prepared: Array<{
    revision: string;
    name: string;
    modified: boolean;
    error: string | null;
    rendering?: boolean;
    tail?: boolean;
  }> = [],
  withScenes = false,
  withRoutingNodes = false,
) {
  const controls = [
    ['outputLevel', 'Output', '0 dB', false],
    ['gateEnabled', 'Gate enabled', 'Off', true],
    ['pitchSemitones', 'Pitch', '-12 st', false],
    ['alignOffset', 'Alignment offset', '0 ms', false],
  ].map(([parameter, label, display, toggle]) => ({
    target: { kind: 'native', node: 'amp', parameter },
    label,
    display,
    toggle,
    value: 0,
    minimum: 0,
    maximum: 1,
    integer: false,
    logarithmic: false,
  }));
  const state = {
    phase: 'running',
    session: 'daemon',
    revision: 2,
    configured: { revision: 'rig' },
    control: {
      session: 'audio',
      revision: 3,
      controls,
      eq: [],
      slots: [{ node: 'amp', slots: [] }],
      prepared,
    },
  } as unknown as Awaited<ReturnType<typeof rigAudioState>>;
  vi.mocked(rigAudioState).mockResolvedValue(state);
  vi.mocked(rigAudioCommand).mockResolvedValue(state);
  vi.mocked(rigDocument).mockResolvedValue({
    revision: 'rig',
    manifest: {
      name: 'Test rig',
      extensions: {
        ...(origin === 'mine' && !withRoutingNodes
          ? {}
          : {
              'urn:oxidal:authoring': {
                ...(origin === 'mine' ? {} : { origin }),
                ...(withRoutingNodes
                  ? {
                      labels: {
                        'merge-left': 'Merge · L',
                        'merge-right': 'Merge · R',
                      },
                    }
                  : {}),
              },
            }),
        ...(withScenes
          ? {
              'urn:oxidal:scenes:1': {
                fade_ms: 15,
                branches: [{ id: 'amp', name: 'Amp', gains: [] }],
                scenes: [],
              },
            }
          : {}),
      },
      tone3000: { instances: [{ id: 'native' }] },
      oxidal: {
        lv2: [],
        graph: {
          nodes: [
            { id: 'amp', kind: 'tone3000', instance: 'native' },
            ...(withRoutingNodes
              ? [
                  { id: 'split-left', kind: 'split' },
                  { id: 'merge-left', kind: 'merge', inputGains: [1, 1] },
                  { id: 'merge-right', kind: 'merge', inputGains: [1, 1] },
                  { id: 'lane-gain', kind: 'gain', inputGains: [1] },
                ]
              : []),
          ],
        },
      },
    },
  } as unknown as Awaited<ReturnType<typeof rigDocument>>);
  render(
    <MixedRig
      connected
      onPlaying={() => {}}
      onPresent={() => {}}
      otherPlaying={false}
    />,
  );
  return state;
}
it('keeps gapless-ready presets distinct from scenes in a compact disclosure', async () => {
  setup('mine', [
    {
      revision: 'other',
      name: 'Other rig',
      modified: false,
      error: null,
      rendering: false,
      tail: false,
    },
  ]);
  const summary = await screen.findByText('Ready to switch');
  expect(summary.closest('details')).not.toHaveAttribute('open');
  expect(screen.getByText('2 presets')).toBeVisible();
  fireEvent.click(summary);
  expect(
    screen.getByText(/Loaded presets can switch without reopening audio/),
  ).toBeVisible();
  expect(screen.getByRole('group', { name: 'Ready presets' })).toBeVisible();
});
it('reports native engines separately from actual blocks and A2 quality', async () => {
  const state = setup();
  state.control!.authoring = [
    {
      node: 'amp',
      status: {
        layout: {
          left: [{ block_id: 'full' }, { insert: true }],
          right: [{ block_id: 'scaled' }],
        },
        settings: [
          { target: 'block:full:slimSize', value: 1 },
          { target: 'block:scaled:slimSize', value: 0.5 },
          { target: 'osEnabled', value: 1 },
          { target: 'osFactor', display: '8x' },
        ],
      },
    },
  ] as unknown as NonNullable<typeof state.control>['authoring'];

  expect(await screen.findByText('1 NAM block')).toBeVisible();
  expect(screen.getByText('2 chain blocks')).toBeVisible();
  expect(
    screen.getByText('A2 size · 1 Full · 0 Lite · 1 scaled'),
  ).toBeVisible();
  expect(screen.getByText('Oversampling · 8x')).toBeVisible();
});

it('keeps internal split, merge and gain routing out of the player', async () => {
  setup('mine', [], false, true);

  await screen.findByRole('button', { name: 'TONE3000' });
  expect(screen.queryByText('Merge · L')).not.toBeInTheDocument();
  expect(screen.queryByText('Merge · R')).not.toBeInTheDocument();
  expect(screen.queryByText('Input 1')).not.toBeInTheDocument();
});
it('keeps Perform mounted behind a clear loader while a preset switches', async () => {
  setPerform({ on: true, mode: 'presets' });
  const state = setup();
  state.phase = 'starting';

  expect(await screen.findByText('Switching preset…')).toBeVisible();
  expect(
    screen.getByText('Perform stays open while the next chain is prepared.'),
  ).toBeVisible();
  expect(
    screen.queryByRole('region', { name: 'Sounding mixed rig' }),
  ).not.toBeInTheDocument();
});
it('hides the old Rig chain behind a loader while a preset prepares', async () => {
  const state = setup();
  state.phase = 'starting';

  const rig = await screen.findByRole('region', { name: 'Sounding mixed rig' });
  expect(rig).toHaveAttribute('data-loading', 'true');
  expect(screen.getByText('Preparing preset…')).toBeVisible();
  expect(
    screen.getByText('The chain will appear when its audio state is ready.'),
  ).toBeVisible();
});
it('groups native controls in hybrid rigs and toggles booleans without a slider', async () => {
  const state = setup();
  await screen.findByRole('button', { name: 'Adjust Output' });
  expect(
    screen.queryByRole('button', { name: 'Adjust Pitch' }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Pitch' }));
  expect(
    screen.getByRole('button', { name: 'Adjust Pitch' }),
  ).toHaveTextContent('-12 st');
  expect(
    screen.queryByRole('button', { name: 'Adjust Output' }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Stereo' }));
  expect(
    screen.getByRole('button', { name: 'Adjust Alignment offset' }),
  ).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Gate' }));
  const toggle = screen.getByRole('button', { name: 'Adjust Gate enabled' });
  expect(toggle).toHaveAttribute('aria-pressed', 'false');
  fireEvent.click(toggle);
  await waitFor(() =>
    expect(rigAudioCommand).toHaveBeenCalledWith(state, {
      kind: 'control',
      command: {
        session: 'audio',
        expected_revision: 3,
        target: { kind: 'native', node: 'amp', parameter: 'gateEnabled' },
        value: 1,
      },
    }),
  );
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it('keeps hybrid save beside the chain and saves only a confirmed opening', async () => {
  const state = setup();
  const open = await screen.findByRole('button', { name: 'Save copy' });
  await waitFor(() => expect(open).toBeEnabled());
  expect(
    screen.queryByRole('textbox', { name: 'Preset name' }),
  ).not.toBeInTheDocument();
  fireEvent.click(open);
  expect(screen.getByRole('textbox', { name: 'Preset name' })).toHaveValue(
    'Test rig',
  );
  fireEvent.change(screen.getByRole('textbox'), {
    target: { value: 'My stage sound' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() =>
    expect(rigAudioCommand).toHaveBeenCalledWith(state, {
      kind: 'save',
      name: 'My stage sound',
    }),
  );
  await waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
  );
  expect(screen.queryByText('Saved for offline use')).not.toBeInTheDocument();
});
it('rejects saving a different hybrid revision while its name dialog is open', async () => {
  const state = setup();
  const open = await screen.findByRole('button', { name: 'Save copy' });
  await waitFor(() => expect(open).toBeEnabled());
  fireEvent.click(open);
  vi.mocked(rigAudioState).mockResolvedValue({
    ...state,
    control: { ...state.control!, revision: 4 },
  });
  await screen.findByText('The rig changed. Close and reopen Save copy.');
  expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  expect(rigAudioCommand).not.toHaveBeenCalled();
});

it('offers both hybrid insertion lanes and carries the chosen position to the picker', async () => {
  const state = setup();
  state.control!.slots = [
    {
      node: 'amp',
      slots: [
        { target: 'left-insert', position: { lane: 0, index: 0 } },
        { target: 'right-insert', position: { lane: 1, index: 2 } },
      ],
    },
  ] as NonNullable<typeof state.control>['slots'];
  fireEvent.click(await screen.findByRole('button', { name: 'Add block' }));
  fireEvent.click(screen.getByRole('button', { name: 'Add NAM' }));
  expect(
    screen.getByRole('button', { name: 'Left chain · position 1' }),
  ).toBeEnabled();
  fireEvent.click(
    screen.getByRole('button', { name: 'Right chain · position 3' }),
  );
  expect(screen.getByTestId('model-picker')).toHaveTextContent(
    'Right chain · position 3',
  );
  expect(rigAudioCommand).not.toHaveBeenCalled();
});

it('shows artwork for the selected hybrid assignment rather than another block', async () => {
  const state = setup();
  state.control!.eq = [
    { node: 'amp', blocks: [{ block_id: 'a' }, { block_id: 'b' }] },
  ] as NonNullable<typeof state.control>['eq'];
  state.control!.models = [
    {
      node: 'amp',
      assignments: [
        { target: 'a', asset: 'asset-a' },
        { target: 'b', asset: 'asset-b' },
      ],
    },
  ] as NonNullable<typeof state.control>['models'];
  fireEvent.click(
    await screen.findByRole('button', { name: 'Select model 1' }),
  );
  expect(screen.getByTestId('model-artwork')).toHaveTextContent('asset-a');
  fireEvent.click(screen.getByRole('button', { name: 'Select model 2' }));
  expect(screen.getByTestId('model-artwork')).toHaveTextContent('asset-b');
});

it('keeps gain-snapshot scenes usable when they share one native chain', async () => {
  const state = setup();
  state.control!.scenes = {
    fade_ms: 15,
    scenes: [
      { id: 'scene-1', name: 'Dry', gains: [] },
      { id: 'scene-2', name: 'Interlock', gains: [] },
    ],
  };
  state.control!.scene = 'scene-2';

  const active = await screen.findByRole('button', {
    name: 'Scene 2: Interlock',
  });
  expect(active).toHaveAttribute('aria-pressed', 'true');
  expect(screen.queryByText('Scene branches')).not.toBeInTheDocument();
});

it('explains the sounding scene as a branch mix rather than another chain', async () => {
  const state = setup();
  state.control!.scenes = {
    fade_ms: 15,
    scenes: [
      {
        id: 'scene-1',
        name: 'Held foreground',
        gains: [
          { node: 'live-send', port: 0, value: 0.4 },
          { node: 'hold-send', port: 0, value: 1 },
        ],
      },
    ],
    branches: [
      {
        id: 'live',
        name: 'Live',
        gains: [{ node: 'live-send', port: 0, value: 1 }],
      },
      {
        id: 'held',
        name: 'Held layer',
        gains: [{ node: 'hold-send', port: 0, value: 1 }],
      },
    ],
  };
  state.control!.scene = 'scene-1';

  expect(await screen.findByText('Current scene ·')).toBeVisible();
  expect(screen.getAllByText('Held foreground')).toHaveLength(2);
  expect(screen.getByText('Live 40% · Held layer 100%')).toBeVisible();
  fireEvent.click(screen.getByText('Current scene ·'));
  expect(
    screen.getByText(/Block controls are shared by every scene/),
  ).toBeVisible();
  expect(screen.getByText('Live · 40%')).toBeVisible();
  expect(screen.getByText('Held layer · 100%')).toBeVisible();
});

it('keeps a custom branch mix attached to its scene and offers Update scene', async () => {
  const state = setup('mine', [], true);
  state.control!.scenes = {
    fade_ms: 15,
    scenes: [
      {
        id: 'scene-1',
        name: 'Clean',
        gains: [{ node: 'mix', port: 0, value: 1 }],
      },
      {
        id: 'scene-2',
        name: 'Stage mix',
        gains: [{ node: 'mix', port: 0, value: 1 }],
      },
    ],
    branches: [
      {
        id: 'amp',
        name: 'Amp',
        gains: [{ node: 'mix', port: 0, value: 1 }],
      },
    ],
  };
  state.control!.scene = 'scene-1';
  state.control!.branches = [
    { id: 'amp', name: 'Amp', enabled: true, partial: false },
  ];
  state.control!.controls.push({
    target: { kind: 'merge', node: 'mix', port: 0 },
    label: 'Amp level',
    display: '100%',
    toggle: false,
    value: 1,
    minimum: 0,
    maximum: 1,
    integer: false,
    logarithmic: false,
  });
  const changed = structuredClone(state);
  changed.control!.scene = null;
  changed.control!.branches![0]!.enabled = false;
  changed.control!.controls.find(
    (control) => control.target.kind === 'merge',
  )!.value = 0;
  vi.mocked(rigAudioCommand).mockResolvedValue(changed);

  const pad = await screen.findByRole('button', { name: 'Scene 2: Stage mix' });
  await waitFor(() => expect(pad).toBeEnabled());
  expect(pad).toHaveAttribute('aria-pressed', 'false');
  vi.mocked(rigAudioState).mockResolvedValue(changed);
  fireEvent.click(pad);

  await waitFor(() => expect(rigAudioCommand).toHaveBeenCalled());
  expect(await screen.findByText(/^Editing scene/)).toBeVisible();
  expect(screen.getByText('Modified mix')).toBeVisible();
  const update = screen.getByRole('button', { name: 'Update scene' });
  expect(update).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Discard changes' })).toBeEnabled();
  // Save while the heard mix differs from its scene asks what to keep (V37).
  fireEvent.click(screen.getByRole('button', { name: 'Save preset' }));
  const review = await screen.findByRole('dialog', {
    name: 'Save this preset?',
  });
  expect(
    within(review).getByRole('button', { name: 'Update Stage mix and save' }),
  ).toBeEnabled();
  expect(
    within(review).getByRole('button', { name: 'Save without this mix' }),
  ).toBeDisabled();
  fireEvent.click(within(review).getByRole('button', { name: 'Cancel' }));
  expect(
    screen.queryByRole('dialog', { name: 'Save this preset?' }),
  ).toBeNull();
  vi.mocked(publishRig).mockClear();
  fireEvent.click(update);
  // Update scene changes the draft only; nothing is published until Save.
  expect(
    await screen.findByText('1 scene updated · not saved yet.'),
  ).toBeVisible();
  expect(screen.getByText('Updated · not saved')).toBeVisible();
  expect(publishRig).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Save copy' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Save preset' })).toBeEnabled();
  fireEvent.click(
    screen.getByRole('button', { name: 'Discard scene updates' }),
  );
  await waitFor(() =>
    expect(screen.queryByText(/not saved yet/)).not.toBeInTheDocument(),
  );
  expect(publishRig).not.toHaveBeenCalled();
  // Save as new scene keeps the heard mix as a new draft scene (7.7).
  fireEvent.click(screen.getByRole('button', { name: 'Save as new scene…' }));
  const naming = await screen.findByRole('dialog', {
    name: 'Save as new scene',
  });
  expect(
    within(naming).getByRole('button', { name: 'Add scene' }),
  ).toBeDisabled();
  fireEvent.change(within(naming).getByLabelText('Scene name'), {
    target: { value: 'Amp off' },
  });
  fireEvent.click(within(naming).getByRole('button', { name: 'Add scene' }));
  expect(await screen.findByText(/New: Amp off\./)).toBeVisible();
  expect(publishRig).not.toHaveBeenCalled();
});

it('performs a preset with effects: a Hold tile engages the hold, other tiles switch in and out', async () => {
  const toggle = (node: string, kind: string, symbol?: string) => ({
    target: symbol ? { kind, node, symbol } : { kind, node },
    label: symbol ?? 'Bypass',
    display: '',
    toggle: true,
    value: 0,
    minimum: 0,
    maximum: 1,
    integer: false,
    logarithmic: false,
  });
  const state = {
    phase: 'running',
    session: 'daemon',
    revision: 2,
    configured: { revision: 'rig' },
    control: {
      session: 'audio',
      revision: 3,
      controls: [toggle('hold', 'lv2', 'hold'), toggle('hold', 'bypass')],
      eq: [],
      slots: [],
    },
  } as unknown as Awaited<ReturnType<typeof rigAudioState>>;
  vi.mocked(rigAudioState).mockResolvedValue(state);
  vi.mocked(rigAudioCommand).mockResolvedValue(state);
  const edge = (
    from: string,
    fromPort: number,
    to: string,
    toPort: number,
  ) => ({
    from: { node: from, port: fromPort },
    to: { node: to, port: toPort },
  });
  vi.mocked(rigDocument).mockResolvedValue({
    revision: 'rig',
    manifest: {
      name: 'Hold rig',
      extensions: {
        'urn:oxidal:authoring': { labels: { hold: 'Oxidal Hold (Stereo)' } },
      },
      tone3000: { instances: [{ id: 'native' }] },
      oxidal: {
        lv2: [{ id: 'hold', pluginUri: 'urn:oxidal:plugin:hold#stereo' }],
        graph: {
          nodes: [
            { id: 'in', kind: 'input' },
            { id: 'amp', kind: 'tone3000', instance: 'native' },
            { id: 'hold', kind: 'lv2', instance: 'hold' },
            { id: 'out', kind: 'output' },
          ],
          edges: [
            edge('in', 0, 'amp', 0),
            edge('in', 1, 'amp', 1),
            edge('amp', 0, 'hold', 0),
            edge('amp', 1, 'hold', 1),
            edge('hold', 0, 'out', 0),
            edge('hold', 1, 'out', 1),
          ],
        },
      },
    },
  } as unknown as Awaited<ReturnType<typeof rigDocument>>);
  render(
    <MixedRig
      connected
      onPlaying={() => {}}
      onPresent={() => {}}
      otherPlaying={false}
    />,
  );
  const perform = await screen.findByRole('button', { name: 'Perform view' });
  await waitFor(() => expect(perform).toBeEnabled());
  act(() => setPerform({ on: true }));
  const tile = await screen.findByRole(
    'button',
    {
      name: 'Oxidal Hold (Stereo) on',
    },
    { timeout: 3000 },
  );
  expect(tile).toHaveAttribute('aria-pressed', 'false');
  fireEvent.click(tile);
  await waitFor(() =>
    expect(rigAudioCommand).toHaveBeenCalledWith(state, {
      kind: 'control',
      command: {
        session: 'audio',
        expected_revision: 3,
        target: { kind: 'lv2', node: 'hold', symbol: 'hold' },
        value: 1,
      },
    }),
  );
  // Back to the rig view.
  fireEvent.click(screen.getByRole('button', { name: 'Back to Rig' }));
  expect(
    await screen.findByRole('button', { name: 'Perform view' }),
  ).toBeVisible();
});

it('copies a read-only example on its first confirmed control edit', async () => {
  const state = setup('oxidal_example');
  const edited = {
    ...state,
    revision: 3,
    control: { ...state.control!, revision: 4, modified: true },
  };
  const copy = 'c'.repeat(64);
  const saved = {
    ...edited,
    revision: 4,
    save: {
      source_session: 'audio',
      source_control_revision: 4,
      running: false,
      saved_revision: copy,
      error: null,
    },
  };
  const copied = {
    ...saved,
    revision: 5,
    configured: { revision: copy },
    control: { ...state.control!, source_revision: copy, modified: false },
  };
  vi.mocked(rigAudioCommand)
    .mockResolvedValueOnce(edited)
    .mockResolvedValueOnce(saved);
  vi.mocked(rigAudioState).mockResolvedValue(
    copied as Awaited<ReturnType<typeof rigAudioState>>,
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Gate' }));
  fireEvent.click(screen.getByRole('button', { name: 'Adjust Gate enabled' }));
  expect(await screen.findByText('Editing a copy of Test rig')).toBeVisible();
  expect(rigAudioCommand).toHaveBeenNthCalledWith(2, edited, {
    kind: 'save',
    name: 'Test rig',
  });
  expect(playScenes).toHaveBeenCalledWith(copy);
  fireEvent.click(screen.getByRole('button', { name: 'Keep copy' }));
  expect(
    screen.queryByText('Editing a copy of Test rig'),
  ).not.toBeInTheDocument();
});

it('copies a branch into a third parallel path through the routing tree (7.26)', async () => {
  const plugin = {
    name: 'Verb',
    uri: 'urn:example:verb',
    unsupported: null,
    ports: [
      ['in_l', true, true],
      ['out_l', true, false],
      ['in_r', true, true],
      ['out_r', true, false],
    ].map(([symbol, audio, input], index) => ({
      index,
      symbol,
      audio,
      control: false,
      atom: false,
      input,
      output: !input,
      integer: false,
      toggled: false,
      logarithmic: false,
      latency: false,
      minimum: null,
      maximum: null,
      default: null,
    })),
  } as never;
  const effect = (id: string) => ({ ...lv2Effect(plugin), id, name: id });
  const built = buildRoute(
    'preset',
    'Two paths',
    [
      {
        kind: 'split',
        split: 'split',
        merge: 'merge',
        gains: [1, 1],
        branches: [[effect('clean')], [effect('dirt')]],
      },
    ],
    'prof',
  );
  const manifest = JSON.parse(built.manifest_json);
  const state = {
    phase: 'running',
    session: 'daemon',
    revision: 2,
    configured: { revision: 'rig', stream: { input: { sample_rate: 48000 } } },
    control: {
      session: 'audio',
      revision: 3,
      modified: false,
      eq: [],
      controls: [
        ...['left', 'right'].map((side) => ({
          target: { kind: 'merge', node: `merge-${side}`, port: 1 },
          label: 'Level',
          display: '100%',
          toggle: false,
          value: 1,
          minimum: 0,
          maximum: 4,
          integer: false,
          logarithmic: false,
        })),
        ...['clean', 'dirt'].map((node) => ({
          target: { kind: 'bypass', node },
          label: 'Bypass',
          display: '',
          toggle: true,
          value: 0,
          minimum: 0,
          maximum: 1,
          integer: false,
          logarithmic: false,
        })),
      ],
    },
  } as never;
  vi.mocked(rigAudioState).mockResolvedValue(state);
  vi.mocked(rigAudioCommand).mockResolvedValue(state);
  vi.mocked(rigDocument).mockResolvedValue({
    revision: 'rig',
    manifest,
  } as never);
  vi.mocked(installedLv2).mockResolvedValue([plugin]);
  vi.mocked(rigLibrary).mockResolvedValue({
    presets: [],
    native_profile: 'prof',
  } as never);
  vi.mocked(libraryCatalog).mockResolvedValue({
    items: [{ kind: 'rig', id: 'rig', origin: 'mine', name: 'Two paths' }],
  } as never);
  vi.mocked(publishRig).mockReset();
  vi.mocked(publishRig).mockResolvedValue({ revision: 'next' } as never);
  render(
    <MixedRig
      connected
      onPlaying={() => {}}
      onPresent={() => {}}
      otherPlaying={false}
    />,
  );
  fireEvent.click(await screen.findByRole('button', { name: 'dirt' }));
  const routing = await screen.findByRole('group', {
    name: 'Routing for dirt',
  });
  expect(
    within(routing).getByRole('button', { name: 'Remove branch' }),
  ).toBeVisible();
  // The selected path's level is set live on both channels when released.
  const level = screen.getByLabelText('Path 2 level');
  fireEvent.change(level, { target: { value: '0.5' } });
  fireEvent.pointerUp(level);
  await waitFor(() =>
    expect(
      vi
        .mocked(rigAudioCommand)
        .mock.calls.filter(
          ([, action]) =>
            action.kind === 'control' &&
            action.command.target.kind === 'merge' &&
            action.command.value === 0.5,
        )
        .map(([, action]) =>
          action.kind === 'control' && action.command.target.kind === 'merge'
            ? action.command.target.node
            : '',
        ),
    ).toEqual(['merge-left', 'merge-right']),
  );
  fireEvent.click(within(routing).getByRole('button', { name: 'Copy branch' }));
  await waitFor(() => expect(publishRig).toHaveBeenCalled());
  const request = vi.mocked(publishRig).mock.calls[0]![0];
  const next = JSON.parse(request.manifest_json);
  // Same identity and split node ids; the copy is a third path.
  expect(next.id).toBe(manifest.id);
  expect(chainLanes(next.oxidal.graph)).toEqual([
    ['clean'],
    ['dirt'],
    [expect.stringMatching(/^effect-/)],
  ]);
  expect(
    next.oxidal.graph.nodes.find((n: { id: string }) => n.id === 'merge-left')
      .inputGains,
  ).toEqual([1, 1, 1]);
});
