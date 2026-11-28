import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import {
  installedLv2,
  libraryCatalog,
  type Lv2Plugin,
  publishRig,
  rigAudioCommand,
  rigAudioState,
  type RigControl,
  rigDocument,
  rigLibrary,
  sceneDraft,
  type SharedSceneDraft,
} from './api';
import { MixedRig } from './MixedRig';
import { setPerform } from './performState';
import { playScenes } from './presetChoices';
import { chainLanes } from './rigChain';
import { lv2Effect } from './rigDraft';
import { buildRoute } from './rigRoute';
// Mute/Protect have their own tests; the Rig header only places them.
// Phone layout is switched per test; most tests use the wide layout.
let narrow = false;
vi.mock('./lib/useNarrow', () => ({ useNarrow: () => narrow }));
vi.mock('./features/stage/StageControls', () => ({
  StageControls: () => null,
}));
vi.mock('./api', () => ({
  rigAudioState: vi.fn(),
  rigAudioCommand: vi.fn(),
  rigDocument: vi.fn(),
  publishRig: vi.fn(),
  installedLv2: vi.fn(),
  rigLibrary: vi.fn(),
  libraryCatalog: vi.fn(),
  sceneBlends: vi.fn(async () => null),
  sceneDraft: vi.fn(async () => null),
}));
vi.mock('./presetChoices', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./presetChoices')>()),
  playScenes: vi.fn(),
}));
// The picker has its own tests; here it only needs to render.
vi.mock('./RigPresetSelector', () => ({ RigPresetSelector: () => null }));
vi.mock('./GuitarSettings', () => ({
  GuitarPicker: () => null,
  GuitarLane: () => null,
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
  // These tests cover the phone-size block sheet; the wide screen's block box has its own tests.
  window.matchMedia = ((query: string) => ({
    matches: query.includes('max-width: 47.99rem'),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
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
/** The block box's full control list: every control, models and the plugin panel. */
async function openAllControls() {
  fireEvent.click(await screen.findByRole('button', { name: /^All controls/ }));
  const more = (await screen.findByText('More for this block')).closest(
    'details',
  )!;
  more.open = true;
}
/** Close the sheet or dialog on top so the chain can be pressed again. */
function closeTop() {
  const dialogs = screen.queryAllByRole('dialog');
  const top = dialogs.at(-1);
  if (top) fireEvent.keyDown(top, { key: 'Escape' });
}
/** The block box's routing: split, paths, move and remove. */
async function openRouting() {
  fireEvent.click(await screen.findByRole('button', { name: 'Routing…' }));
}

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
it('keeps gapless-ready presets on the chain bar, distinct from scenes', async () => {
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
  const loaded = await screen.findByRole('button', { name: /2 loaded/ });
  fireEvent.click(loaded);
  const list = within(
    await screen.findByRole('dialog', { name: 'Loaded presets' }),
  );
  expect(list.getByText(/These are presets, not scenes/)).toBeVisible();
  expect(list.getByRole('button', { name: /Other rig/ })).toBeEnabled();
});

it('shares exact block scene drafts and retains the local draft after a stale write', async () => {
  let device: SharedSceneDraft = { revision: 0, draft: null };
  vi.mocked(sceneDraft).mockImplementation(async (update) => {
    if (update) {
      if (update.expected_revision !== device.revision)
        throw new Error('Stale');
      device = { revision: device.revision + 1, draft: update.draft };
    }
    return device;
  });
  const state = setup('mine', [], true);
  state.control!.scenes = {
    fade_ms: 15,
    branches: [],
    scenes: [
      { id: 'clean', name: 'Clean', gains: [] },
      { id: 'lead', name: 'Lead', gains: [] },
    ],
  };
  await waitFor(() => expect(vi.mocked(sceneDraft)).toHaveBeenCalled());
  const editScenes = await sceneOption('Edit scenes');
  await waitFor(() => expect(editScenes).toBeEnabled());
  fireEvent.click(editScenes);
  const grid = screen.getByRole('dialog', { name: 'Edit scenes' });
  const clean = within(grid).getByRole('button', { name: / in Clean$/ });
  fireEvent.click(clean);
  await waitFor(() =>
    expect(device.draft?.bypass?.clean).toEqual([{ node: 'amp', value: true }]),
  );
  expect(clean).toHaveAttribute('aria-pressed', 'false');
  expect(
    within(grid).getByRole('button', { name: / in Lead$/ }),
  ).toHaveAttribute('aria-pressed', 'true');
  expect(vi.mocked(rigAudioCommand)).not.toHaveBeenCalled();
  device = { ...device, revision: device.revision + 1 };
  fireEvent.click(within(grid).getByRole('button', { name: / in Lead$/ }));
  await waitFor(() =>
    expect(
      within(grid).getByRole('button', { name: 'Save scenes' }),
    ).toBeDisabled(),
  );
  expect(
    within(grid).getByRole('button', { name: / in Lead$/ }),
  ).toHaveAttribute('aria-pressed', 'false');
  expect(device.draft?.bypass?.lead).toBeUndefined();
  fireEvent.click(within(grid).getByRole('button', { name: 'Close' }));
  fireEvent.click(screen.getByRole('button', { name: 'Share my draft' }));
  await waitFor(() =>
    expect(device.draft?.bypass?.lead).toEqual([{ node: 'amp', value: true }]),
  );
});

it('edits exact inner block scene states from saved defaults without using current power or sending legacy audio writes', async () => {
  let device: SharedSceneDraft = { revision: 0, draft: null };
  vi.mocked(sceneDraft).mockImplementation(async (update) => {
    if (update) device = { revision: device.revision + 1, draft: update.draft };
    return device;
  });
  const state = setup('mine', [], true);
  state.control!.native_bypass_defaults = [
    { node: 'amp', block: 'pedal', value: true },
  ];
  state.control!.controls.push({
    target: { kind: 'native', node: 'amp', parameter: 'block:pedal:enabled' },
    label: 'Pedal power',
    display: 'On',
    value: 1,
    minimum: 0,
    maximum: 1,
    toggle: true,
    integer: true,
    logarithmic: false,
  });
  state.control!.scenes = {
    fade_ms: 15,
    branches: [],
    scenes: [
      { id: 'clean', name: 'Clean', gains: [] },
      { id: 'lead', name: 'Lead', gains: [] },
    ],
  };
  const edit = await sceneOption('Edit scenes');
  await waitFor(() => expect(edit).toBeEnabled());
  fireEvent.click(edit);
  const grid = screen.getByRole('dialog', { name: 'Edit scenes' });
  const clean = within(grid).getByRole('button', {
    name: /Pedal power in Clean$/,
  });
  expect(clean).toHaveAttribute('aria-pressed', 'false');
  fireEvent.click(clean);
  await waitFor(() =>
    expect(device.draft?.native_bypass?.clean).toEqual([
      { node: 'amp', block: 'pedal', value: false },
    ]),
  );
  expect(
    within(grid).getByRole('button', { name: /Pedal power in Lead$/ }),
  ).toHaveAttribute('aria-pressed', 'false');
  expect(within(grid).getByRole('button', { name: 'Clean' })).toBeDisabled();
  expect(rigAudioCommand).not.toHaveBeenCalled();
});

it('offers native capture scene settings only from verified saved defaults', async () => {
  let device: SharedSceneDraft = { revision: 0, draft: null };
  vi.mocked(sceneDraft).mockImplementation(async (update) => {
    if (update) device = { revision: device.revision + 1, draft: update.draft };
    return device;
  });
  const state = setup('mine', [], true);
  const target = { node: 'amp', parameter: 'block:capture:inputGain' };
  state.control!.capture_defaults = [{ ...target, value: 0.5 }];
  state.control!.controls.push({
    target: { kind: 'native', ...target },
    label: 'Capture input gain',
    display: '+4.8 dB',
    value: 0.6,
    minimum: 0,
    maximum: 1,
    toggle: false,
    integer: false,
    logarithmic: false,
  });
  state.control!.scenes = {
    fade_ms: 15,
    branches: [],
    scenes: [
      { id: 'clean', name: 'Clean', gains: [] },
      { id: 'lead', name: 'Lead', gains: [] },
    ],
  };
  state.control!.scene = 'clean';
  fireEvent.click(await sceneOption(/^Scene settings/));
  const settings = await screen.findByRole('group', {
    name: 'Capture settings in scenes',
  });
  fireEvent.click(within(settings).getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'Done' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Update scene' }));
  await waitFor(() =>
    expect(device.draft?.native_controls?.clean).toEqual([
      { ...target, value: 0.6 },
    ]),
  );
  expect(device.draft?.native_controls?.lead).toBeUndefined();
  expect(vi.mocked(rigAudioCommand)).not.toHaveBeenCalled();
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

  await screen.findByRole('button', {
    name: /^TONE3000 TONE3000 · Preset$/i,
  });
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
  await openAllControls();
  await screen.findByRole('button', { name: /^Adjust\s*Output/ });
  expect(
    screen.queryByRole('button', { name: /^Adjust\s*Pitch/ }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Pitch' }));
  expect(
    screen.getByRole('button', { name: /^Adjust\s*Pitch/ }),
  ).toHaveTextContent('-12 st');
  expect(
    screen.queryByRole('button', { name: /^Adjust\s*Output/ }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Stereo' }));
  expect(
    screen.getByRole('button', { name: /^Adjust\s*Alignment offset/ }),
  ).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Gate' }));
  const toggle = screen.getByRole('button', { name: /^Adjust\s*Gate enabled/ });
  expect(toggle).toHaveAttribute('aria-pressed', 'false');
  // A toggle switches at once: no adjustment dialog opens over the sheet.
  const sheets = screen.queryAllByRole('dialog').length;
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
  expect(screen.queryAllByRole('dialog')).toHaveLength(sheets);
});

/** The scene tools sit behind the scene row's ⋯ (C2): open it first. */
async function sceneOption(name: string | RegExp) {
  const options = await screen.findByRole('button', { name: 'Scene options' });
  await waitFor(() => expect(options).toBeEnabled());
  fireEvent.click(options);
  return screen.findByRole('button', { name });
}

/** Save a copy: in More while nothing has changed (the chain bar's Save waits for a change). */
async function openSaveCopy() {
  const more = await screen.findByRole('button', {
    name: 'More preset actions',
  });
  await waitFor(() => expect(more).toBeEnabled());
  fireEvent.click(more);
  const open = await screen.findByRole('button', { name: /^Save a copy/ });
  await waitFor(() => expect(open).toBeEnabled());
  fireEvent.click(open);
}

it('keeps hybrid save beside the chain and saves only a confirmed opening', async () => {
  const state = setup();
  await screen.findByRole('button', { name: 'More preset actions' });
  expect(
    screen.queryByRole('textbox', { name: 'Preset name' }),
  ).not.toBeInTheDocument();
  await openSaveCopy();
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
  await openSaveCopy();
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
  await openAllControls();
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
  await openAllControls();
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

  // The selected tab names the scene; no second line repeats it.
  expect(await screen.findAllByText('Held foreground')).toHaveLength(1);
  // The scene's path levels are in Scene settings, behind the scene row's ⋯.
  fireEvent.click(await sceneOption(/^Scene settings/));
  expect(
    screen.getByText(/Block controls are shared by every scene/),
  ).toBeVisible();
  expect(screen.getByText('Live · 40%')).toBeVisible();
  expect(screen.getByText('Held layer · 100%')).toBeVisible();
});

it('keeps a custom branch mix attached to its scene and offers Update scene', async () => {
  // The device's shared copy of the draft (7.7).
  let device: SharedSceneDraft = { revision: 0, draft: null };
  vi.mocked(sceneDraft).mockImplementation(async (update) => {
    if (update && JSON.stringify(update.draft) !== JSON.stringify(device.draft))
      device = { revision: device.revision + 1, draft: update.draft };
    return device;
  });
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
  // A reload of this tab keeps the unsaved update for the same audio session.
  expect(
    JSON.parse(sessionStorage.getItem('oxidal.mixed.scene-draft')!).gains,
  ).toHaveProperty('scene-2');
  // Another browser sees it too: a new tab with nothing stored reads the
  // draft the device holds.
  await waitFor(() => expect(device.draft?.gains).toHaveProperty('scene-2'));
  cleanup();
  sessionStorage.removeItem('oxidal.mixed.scene-draft');
  render(
    <MixedRig
      connected
      onPlaying={() => {}}
      onPresent={() => {}}
      otherPlaying={false}
    />,
  );
  expect(
    await screen.findByText('1 scene updated · not saved yet.'),
  ).toBeVisible();
  expect(publishRig).not.toHaveBeenCalled();
  // The chain bar's Save waits until the scene updates are saved or discarded.
  expect(
    within(screen.getByRole('toolbar', { name: 'Chain tools' })).getByRole(
      'button',
      { name: 'Save' },
    ),
  ).toBeDisabled();
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Save preset' })).toBeEnabled(),
  );
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
      name: /Oxidal Hold \(Stereo\) on$/,
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
  fireEvent.click(screen.getByRole('button', { name: /back to Rig/i }));
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
  await openAllControls();
  fireEvent.click(await screen.findByRole('button', { name: 'Gate' }));
  fireEvent.click(
    screen.getByRole('button', { name: /^Adjust\s*Gate enabled/ }),
  );
  expect(await screen.findByText('Editing a copy of Test rig')).toBeVisible();
  expect(rigAudioCommand).toHaveBeenNthCalledWith(2, edited, {
    kind: 'save',
    name: 'Test rig',
  });
  expect(playScenes).toHaveBeenCalledWith(copy);
  // The copy notice sits under the open All controls sheet: close it first.
  closeTop();
  fireEvent.click(screen.getByRole('button', { name: 'Keep copy' }));
  expect(
    screen.queryByText('Editing a copy of Test rig'),
  ).not.toBeInTheDocument();
});

/** Two parallel effects, Clean and Dirt, sounding with a path level each side. */
function twoPaths(
  controlPorts: Lv2Plugin['ports'] = [],
  liveControls: RigControl[] = [],
) {
  const audioPorts = ['in_l', 'out_l', 'in_r', 'out_r'].map(
    (symbol, index): Lv2Plugin['ports'][number] => ({
      index,
      symbol,
      audio: true,
      control: false,
      atom: false,
      input: symbol.startsWith('in'),
      output: symbol.startsWith('out'),
      integer: false,
      toggled: false,
      logarithmic: false,
      latency: false,
      minimum: null,
      maximum: null,
      default: null,
    }),
  );
  const plugin: Lv2Plugin = {
    name: 'Verb',
    uri: 'urn:example:verb',
    unsupported: null,
    ports: [
      ...audioPorts,
      ...controlPorts.map((port, index) => ({
        ...port,
        index: audioPorts.length + index,
      })),
    ],
  };
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
        ...liveControls,
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
  return {
    manifest,
    state: state as Awaited<ReturnType<typeof rigAudioState>>,
  };
}
it('copies a path into a third path through the routing tree (7.26)', async () => {
  const { manifest } = twoPaths();
  fireEvent.click(
    await screen.findByRole('button', {
      name: /^dirt (?:pedal|lv2)(?: Off)?$/i,
    }),
  );
  await openRouting();
  const routing = await screen.findByRole('group', {
    name: 'Routing for dirt',
  });
  expect(
    within(routing).getByRole('button', { name: 'Remove path' }),
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
  // Pan and polarity write the two sides separately (7.26).
  const merges = () =>
    vi
      .mocked(rigAudioCommand)
      .mock.calls.flatMap(([, action]) =>
        action.kind === 'control' && action.command.target.kind === 'merge'
          ? [[action.command.target.node, action.command.value]]
          : [],
      );
  vi.mocked(rigAudioCommand).mockClear();
  const pan = screen.getByLabelText('Path 2 pan');
  fireEvent.change(pan, { target: { value: '-1' } });
  fireEvent.pointerUp(pan);
  await waitFor(() =>
    expect(merges()).toEqual([
      ['merge-left', 0.5],
      ['merge-right', 0],
    ]),
  );
  vi.mocked(rigAudioCommand).mockClear();
  fireEvent.click(screen.getByLabelText('Invert path 2 polarity'));
  await waitFor(() =>
    expect(merges()).toEqual([
      ['merge-left', -0.5],
      ['merge-right', 0],
    ]),
  );
  fireEvent.click(within(routing).getByRole('button', { name: 'Copy path' }));
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
  // The split itself opens a dialog with every path's level and actions (7.28).
  closeTop();
  const open = await screen.findByRole('button', {
    name: /Split .*2 paths: path levels/,
  });
  fireEvent.click(open);
  const dialog = await screen.findByRole('dialog', { name: 'Split · 2 paths' });
  expect(
    within(dialog).getByRole('button', { name: 'Copy path 1' }),
  ).toBeVisible();
  expect(
    within(dialog).getByRole('button', { name: 'Remove path 2' }),
  ).toBeVisible();
  expect(
    within(dialog).getByRole('button', { name: '+ Add dry path' }),
  ).toBeVisible();
  // Phones draw the same canvas, scrolling sideways: a + in each gap of a
  // path offers Add effect or Split here for that place.
  narrow = true;
  fireEvent.click(within(dialog).getByRole('button', { name: 'Close dialog' }));
  const chain = await screen.findByRole('group', { name: 'Signal chain' });
  fireEvent.click(
    within(chain).getByRole('button', {
      name: 'Add or split on path 2 at position 2',
    }),
  );
  expect(
    await screen.findByRole('dialog', { name: 'Add or split here' }),
  ).toBeVisible();
  narrow = false;
});

it('puts the first side back when the second side of a pan fails', async () => {
  const { state } = twoPaths();
  const merges = () =>
    vi
      .mocked(rigAudioCommand)
      .mock.calls.flatMap(([, action]) =>
        action.kind === 'control' && action.command.target.kind === 'merge'
          ? [[action.command.target.node, action.command.value]]
          : [],
      );
  fireEvent.click(
    await screen.findByRole('button', {
      name: /^dirt (?:pedal|lv2)(?: Off)?$/i,
    }),
  );
  await openRouting();
  const level = await screen.findByLabelText('Path 2 level');
  vi.mocked(rigAudioCommand).mockClear();
  vi.mocked(rigAudioCommand).mockImplementation(async (_, action) => {
    if (
      action.kind === 'control' &&
      action.command.target.kind === 'merge' &&
      action.command.target.node === 'merge-right'
    )
      throw new Error('worker refused');
    return state;
  });
  fireEvent.change(level, { target: { value: '0.5' } });
  fireEvent.pointerUp(level);
  // Left is set, right is refused, so left goes back to what it was.
  await waitFor(() =>
    expect(merges()).toEqual([
      ['merge-left', 0.5],
      ['merge-right', 0.5],
      ['merge-left', 1],
    ]),
  );
  expect(await screen.findByText(/the path is back as it was/)).toBeVisible();
});

it('recalls a scene with every drafted level and effect setting, not only the first', async () => {
  // Update scene drafted two levels and one effect setting for Stage mix.
  sessionStorage.setItem(
    'oxidal.mixed.scene-draft',
    JSON.stringify({
      session: 'audio',
      gains: {
        'scene-2': [
          { node: 'mix', port: 0, value: 0.5 },
          { node: 'mix', port: 1, value: 0.25 },
        ],
      },
      controls: { 'scene-2': [{ node: 'fx', symbol: 'gain', value: 3 }] },
    }),
  );
  const state = setup('mine', [], true);
  const gains = [
    { node: 'mix', port: 0, value: 1 },
    { node: 'mix', port: 1, value: 1 },
  ];
  state.control!.scenes = {
    fade_ms: 15,
    scenes: [
      { id: 'scene-1', name: 'Clean', gains },
      { id: 'scene-2', name: 'Stage mix', gains },
    ],
    branches: [{ id: 'amp', name: 'Amp', gains: [gains[0]!] }],
  };
  state.control!.scene = 'scene-1';
  const control = (target: object) => ({
    target,
    label: 'Level',
    display: '',
    toggle: false,
    value: 1,
    minimum: 0,
    maximum: 4,
    integer: false,
    logarithmic: false,
  });
  state.control!.controls.push(
    control({ kind: 'merge', node: 'mix', port: 0 }) as never,
    control({ kind: 'merge', node: 'mix', port: 1 }) as never,
    control({ kind: 'lv2', node: 'fx', symbol: 'gain' }) as never,
  );
  // Like the engine: once a level differs from the saved scene, no scene is named.
  let live = state;
  vi.mocked(rigAudioCommand).mockImplementation(async (_, action) => {
    live = structuredClone(live);
    if (action.kind === 'scene') live.control!.scene = action.command.scene;
    if (action.kind === 'control') {
      live.control!.scene = null;
      live.control!.controls.find(
        (c) =>
          JSON.stringify(c.target) === JSON.stringify(action.command.target),
      )!.value = action.command.value;
    }
    vi.mocked(rigAudioState).mockResolvedValue(live);
    return live;
  });
  const pad = await screen.findByRole('button', { name: 'Scene 2: Stage mix' });
  await waitFor(() => expect(pad).toBeEnabled());
  fireEvent.click(pad);
  await waitFor(() =>
    expect(
      vi
        .mocked(rigAudioCommand)
        .mock.calls.map(([, action]) =>
          action.kind === 'control'
            ? [action.command.target, action.command.value]
            : action.kind,
        ),
    ).toEqual([
      'scene',
      [{ kind: 'merge', node: 'mix', port: 0 }, 0.5],
      [{ kind: 'merge', node: 'mix', port: 1 }, 0.25],
      [{ kind: 'lv2', node: 'fx', symbol: 'gain' }, 3],
    ]),
  );
});

it('opens the shared LV2 panel and keeps a live adjustment on the selected node and port', async () => {
  const port = (
    symbol: string,
    extra: Partial<Lv2Plugin['ports'][number]> = {},
  ): Lv2Plugin['ports'][number] => ({
    index: 0,
    symbol,
    control: true,
    input: true,
    audio: false,
    output: false,
    integer: false,
    toggled: false,
    logarithmic: false,
    latency: false,
    minimum: 0,
    maximum: 4,
    default: 1,
    ...extra,
  });
  const control = (
    node: string,
    symbol: string,
    value: number,
  ): RigControl => ({
    target: { kind: 'lv2', node, symbol },
    label: symbol,
    value,
    display: String(value),
    minimum: 0,
    maximum: 4,
    integer: false,
    logarithmic: false,
    toggle: false,
  });
  const { state } = twoPaths(
    [
      port('wet_mix', { name: 'Wet level', unit: 'dB', display_priority: 5 }),
      port('hidden', { not_on_gui: true }),
      port('mode', {
        enumeration: true,
        scale_points: [
          { value: 0, label: 'Soft' },
          { value: 1, label: 'Bright' },
        ],
      }),
      port('catalog_only', { name: 'Catalog only' }),
    ],
    [
      control('clean', 'wet_mix', 1),
      control('dirt', 'wet_mix', 2),
      control('dirt', 'hidden', 1),
      control('dirt', 'mode', 0),
    ],
  );
  let live = state;
  vi.mocked(rigAudioCommand).mockImplementation(async (_state, action) => {
    if (action.kind === 'control') {
      const control = live.control!;
      live = {
        ...live,
        control: {
          ...control,
          revision: control.revision + 1,
          controls: control.controls.map((c) =>
            JSON.stringify(c.target) === JSON.stringify(action.command.target)
              ? {
                  ...c,
                  value: action.command.value,
                  display: String(action.command.value),
                }
              : c,
          ),
        },
      };
    }
    if (action.kind === 'restore_plugin_defaults') {
      const control = live.control!;
      live = {
        ...live,
        control: {
          ...control,
          revision: control.revision + 1,
          modified: true,
          controls: control.controls.map((c) =>
            c.target.kind === 'lv2' &&
            c.target.node === action.command.node &&
            c.target.symbol !== 'hidden'
              ? { ...c, value: 1, display: '1' }
              : c,
          ),
        },
      };
    }
    return live;
  });
  fireEvent.click(
    await screen.findByRole('button', {
      name: /^dirt (?:pedal|lv2)(?: Off)?$/i,
    }),
  );
  await openAllControls();
  const panel = await screen.findByRole('region', { name: 'Verb controls' });
  const adjust = within(panel).getByRole('button', {
    name: 'Adjust Wet level',
  });
  expect(adjust).toHaveTextContent('2 dB');
  expect(
    within(panel).queryByRole('button', { name: 'Adjust Hidden' }),
  ).toBeNull();
  expect(within(panel).queryByText('Catalog only')).toBeNull();
  expect(rigAudioCommand).not.toHaveBeenCalled();

  fireEvent.click(adjust);
  const dialog = screen.getByRole('dialog', { name: 'Wet level' });
  fireEvent.click(
    within(dialog).getByRole('button', { name: 'Increase Wet level' }),
  );
  await waitFor(() => expect(rigAudioCommand).toHaveBeenCalledTimes(1));
  expect(rigAudioCommand).toHaveBeenLastCalledWith(expect.anything(), {
    kind: 'control',
    command: {
      session: 'audio',
      expected_revision: 3,
      target: { kind: 'lv2', node: 'dirt', symbol: 'wet_mix' },
      value: 2.004,
    },
  });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  await waitFor(() => expect(dialog).not.toBeInTheDocument());
  expect(rigAudioCommand).toHaveBeenLastCalledWith(expect.anything(), {
    kind: 'control',
    command: {
      session: 'audio',
      expected_revision: 4,
      target: { kind: 'lv2', node: 'dirt', symbol: 'wet_mix' },
      value: 2,
    },
  });

  fireEvent.click(within(panel).getByRole('radio', { name: 'Bright' }));
  await waitFor(() =>
    expect(within(panel).getByRole('radio', { name: 'Bright' })).toBeChecked(),
  );
  expect(rigAudioCommand).toHaveBeenLastCalledWith(expect.anything(), {
    kind: 'control',
    command: {
      session: 'audio',
      expected_revision: 5,
      target: { kind: 'lv2', node: 'dirt', symbol: 'mode' },
      value: 1,
    },
  });
  fireEvent.click(within(panel).getByRole('switch', { name: 'dirt on' }));
  await waitFor(() =>
    expect(
      within(panel).getByRole('switch', { name: 'dirt on' }),
    ).not.toBeChecked(),
  );
  expect(rigAudioCommand).toHaveBeenLastCalledWith(expect.anything(), {
    kind: 'control',
    command: {
      session: 'audio',
      expected_revision: 6,
      target: { kind: 'bypass', node: 'dirt' },
      value: 1,
    },
  });

  fireEvent.click(
    within(panel).getByRole('button', { name: 'Restore factory defaults' }),
  );
  await waitFor(() =>
    expect(
      within(panel).getByRole('button', { name: 'Adjust Wet level' }),
    ).toHaveTextContent('1 dB'),
  );
  expect(rigAudioCommand).toHaveBeenLastCalledWith(expect.anything(), {
    kind: 'restore_plugin_defaults',
    command: { session: 'audio', expected_revision: 7, node: 'dirt' },
  });
  expect(
    live.control!.controls.find(
      (c) =>
        c.target.kind === 'lv2' &&
        c.target.node === 'dirt' &&
        c.target.symbol === 'hidden',
    )?.value,
  ).toBe(1);

  closeTop();
  fireEvent.click(await screen.findByRole('button', { name: 'clean lv2' }));
  await openAllControls();
  const other = await screen.findByRole('region', { name: 'Verb controls' });
  expect(
    within(other).getByRole('button', { name: 'Adjust Wet level' }),
  ).toHaveTextContent('1 dB');
  expect(within(other).getByRole('switch', { name: 'clean on' })).toBeChecked();
});

it('shows live symbol controls when discovery is unavailable', async () => {
  twoPaths(
    [],
    [
      {
        target: { kind: 'lv2', node: 'dirt', symbol: 'wet_mix' },
        label: 'wet_mix',
        value: 0.625,
        display: '0.625',
        minimum: 0,
        maximum: 1,
        integer: false,
        logarithmic: false,
        toggle: false,
      },
    ],
  );
  vi.mocked(installedLv2).mockRejectedValue(new Error('Catalog unavailable'));
  fireEvent.click(
    await screen.findByRole('button', {
      name: /^dirt (?:pedal|lv2)(?: Off)?$/i,
    }),
  );
  await openAllControls();
  const panel = await screen.findByRole('region', { name: 'dirt controls' });
  expect(
    within(panel).getByRole('button', { name: 'Adjust Wet mix' }),
  ).toHaveTextContent('0.625');
  expect(within(panel).queryByText(/factory defaults/)).toBeNull();
  expect(rigAudioCommand).not.toHaveBeenCalled();
});

it('keeps live edits after saving an independent copy and reloads only on explicit Discard', async () => {
  const state = setup();
  state.control!.modified = true;
  state.save = {
    copy_id: 'independent-copy',
    source_session: state.control!.session,
    source_control_revision: state.control!.revision,
    running: false,
    saved_revision: 'c'.repeat(64),
    error: null,
  };
  const menu = await screen.findByRole('button', {
    name: 'More preset actions',
  });
  await waitFor(() => expect(menu).toBeEnabled());
  const open = async () => {
    fireEvent.click(menu);
    fireEvent.click(
      await screen.findByRole('button', { name: /Discard live edits/ }),
    );
    return screen.findByRole('dialog', { name: 'Discard live edits?' });
  };
  const cancel = await open();
  fireEvent.click(within(cancel).getByRole('button', { name: 'Keep editing' }));
  expect(rigAudioCommand).not.toHaveBeenCalled();
  const confirm = await open();
  fireEvent.click(
    within(confirm).getByRole('button', { name: 'Discard edits and reload' }),
  );
  await waitFor(() =>
    expect(rigAudioCommand).toHaveBeenCalledExactlyOnceWith(state, {
      kind: 'discard_changes',
    }),
  );
});

it('keeps a delayed bypass reply on the original block after selecting another block', async () => {
  const { state } = twoPaths();
  const command = vi.mocked(rigAudioCommand);
  let reply!: (value: typeof state) => void;
  command.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        reply = resolve;
      }),
  );

  fireEvent.click(await screen.findByRole('button', { name: 'dirt lv2' }));
  fireEvent.click(await screen.findByRole('switch', { name: 'dirt on' }));
  await waitFor(() => expect(command).toHaveBeenCalledTimes(1));
  expect(command.mock.calls[0]?.[1]).toMatchObject({
    kind: 'control',
    command: { target: { kind: 'bypass', node: 'dirt' }, value: 1 },
  });
  fireEvent.click(screen.getByRole('button', { name: 'clean lv2' }));
  expect(await screen.findByRole('switch', { name: 'clean on' })).toBeChecked();

  const control = state.control!;
  const next = {
    ...state,
    control: {
      ...control,
      revision: control.revision + 1,
      controls: control.controls.map((item) =>
        item.target.kind === 'bypass' && item.target.node === 'dirt'
          ? { ...item, value: 1 }
          : item,
      ),
    },
  };
  vi.mocked(rigAudioState).mockResolvedValue(next);
  await act(async () => reply(next));
  expect(screen.getByRole('switch', { name: 'clean on' })).toBeChecked();
  fireEvent.click(screen.getByRole('button', { name: /^dirt lv2(?: Off)?$/i }));
  expect(
    await screen.findByRole('switch', { name: 'dirt on' }),
  ).not.toBeChecked();
  expect(command).toHaveBeenCalledTimes(1);
});

it('on a wide screen shows the selected block as one box and opens every control in a sheet', async () => {
  // A wide screen: the phone query does not match.
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  const control = (
    node: string,
    symbol: string,
    value: number,
  ): RigControl => ({
    target: { kind: 'lv2', node, symbol },
    label: symbol,
    value,
    display: String(value),
    minimum: 0,
    maximum: 4,
    integer: false,
    logarithmic: false,
    toggle: false,
  });
  twoPaths(
    [
      {
        index: 0,
        symbol: 'wet_mix',
        name: 'Wet level',
        control: true,
        input: true,
        audio: false,
        output: false,
        integer: false,
        toggled: false,
        logarithmic: false,
        latency: false,
        minimum: 0,
        maximum: 4,
        default: 1,
      },
    ],
    [control('clean', 'wet_mix', 1), control('dirt', 'wet_mix', 2)],
  );
  fireEvent.click(
    await screen.findByRole('button', {
      name: /^dirt (?:pedal|lv2)(?: Off)?$/i,
    }),
  );
  const box = await screen.findByRole('region', { name: 'dirt controls' });
  expect(within(box).getByText(/Block on/)).toBeVisible();
  const all = within(box).getByRole('button', { name: /^All controls/ });
  fireEvent.click(all);
  const sheet = await screen.findByRole('dialog', { name: 'dirt' });
  expect(within(sheet).getByRole('button', { name: 'Done' })).toBeVisible();
  fireEvent.click(within(sheet).getByRole('button', { name: 'Done' }));
  await waitFor(() =>
    expect(screen.queryByRole('dialog', { name: 'dirt' })).toBeNull(),
  );
});

it('lists what changed since saved, undoes one line and hears the saved sound', async () => {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  const wet = (node: string, value: number): RigControl => ({
    target: { kind: 'lv2', node, symbol: 'wet_mix' },
    label: 'wet_mix',
    value,
    display: `${value} dB`,
    minimum: 0,
    maximum: 4,
    integer: false,
    logarithmic: false,
    toggle: false,
  });
  const { state } = twoPaths(
    [
      {
        index: 0,
        symbol: 'wet_mix',
        name: 'Wet level',
        control: true,
        input: true,
        audio: false,
        output: false,
        integer: false,
        toggled: false,
        logarithmic: false,
        latency: false,
        minimum: 0,
        maximum: 4,
        default: 1,
      },
    ],
    [wet('clean', 1), { ...wet('dirt', 2), saved: 1 }],
  );
  state.control!.modified = true;
  vi.mocked(rigAudioCommand).mockImplementation(async () => state);
  const bar = await screen.findByRole('toolbar', { name: 'Chain tools' });
  fireEvent.click(await within(bar).findByRole('button', { name: '1 change' }));
  const list = await screen.findByRole('list', { name: 'Changes list' });
  expect(list).toHaveTextContent(/dirt · Wet mix 1 dB → 2 dB/);
  fireEvent.click(
    within(list).getByRole('button', { name: /^Undo: dirt · Wet mix/ }),
  );
  await waitFor(() =>
    expect(rigAudioCommand).toHaveBeenCalledWith(expect.anything(), {
      kind: 'control',
      command: expect.objectContaining({
        target: { kind: 'lv2', node: 'dirt', symbol: 'wet_mix' },
        value: 1,
      }),
    }),
  );
});

it('switches to the saved sound and back to the edits', async () => {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  const wet = (node: string, value: number): RigControl => ({
    target: { kind: 'lv2', node, symbol: 'wet_mix' },
    label: 'wet_mix',
    value,
    display: `${value} dB`,
    minimum: 0,
    maximum: 4,
    integer: false,
    logarithmic: false,
    toggle: false,
  });
  const { state } = twoPaths(
    [
      {
        index: 0,
        symbol: 'wet_mix',
        name: 'Wet level',
        control: true,
        input: true,
        audio: false,
        output: false,
        integer: false,
        toggled: false,
        logarithmic: false,
        latency: false,
        minimum: 0,
        maximum: 4,
        default: 1,
      },
    ],
    [wet('clean', 1), { ...wet('dirt', 2), saved: 1 }],
  );
  state.control!.modified = true;
  let live = state;
  vi.mocked(rigAudioCommand).mockImplementation(async (_state, action) => {
    if (action.kind === 'control') {
      const control = live.control!;
      live = {
        ...live,
        control: {
          ...control,
          revision: control.revision + 1,
          controls: control.controls.map((c) =>
            JSON.stringify(c.target) === JSON.stringify(action.command.target)
              ? {
                  ...c,
                  value: action.command.value,
                  display: `${action.command.value} dB`,
                  // The device reports the saved value only while it differs.
                  saved:
                    action.command.value === 1 ? undefined : (c.saved ?? 1),
                }
              : c,
          ),
        },
      };
    }
    return live;
  });
  const bar = await screen.findByRole('toolbar', { name: 'Chain tools' });
  fireEvent.click(await within(bar).findByRole('radio', { name: 'Saved' }));
  await waitFor(() =>
    expect(rigAudioCommand).toHaveBeenLastCalledWith(expect.anything(), {
      kind: 'control',
      command: expect.objectContaining({
        target: { kind: 'lv2', node: 'dirt', symbol: 'wet_mix' },
        value: 1,
      }),
    }),
  );
  expect(await screen.findByText(/hearing the saved sound/)).toBeVisible();
  fireEvent.click(within(bar).getByRole('radio', { name: 'Edited' }));
  await waitFor(() =>
    expect(rigAudioCommand).toHaveBeenLastCalledWith(expect.anything(), {
      kind: 'control',
      command: expect.objectContaining({
        target: { kind: 'lv2', node: 'dirt', symbol: 'wet_mix' },
        value: 2,
      }),
    }),
  );
});

it('lists nothing when the device reports no saved values that differ', async () => {
  const { state } = twoPaths(
    [
      {
        index: 0,
        symbol: 'wet_mix',
        name: 'Wet level',
        control: true,
        input: true,
        audio: false,
        output: false,
        integer: false,
        toggled: false,
        logarithmic: false,
        latency: false,
        minimum: 0,
        maximum: 4,
        default: 1,
      },
    ],
    [
      {
        target: { kind: 'lv2', node: 'dirt', symbol: 'wet_mix' },
        label: 'wet_mix',
        value: 2,
        display: '2 dB',
        minimum: 0,
        maximum: 4,
        integer: false,
        logarithmic: false,
        toggle: false,
      },
    ],
  );
  state.control!.modified = true;
  state.control!.scenes = {
    fade_ms: 15,
    branches: [],
    scenes: [
      {
        id: 'lead',
        name: 'Lead',
        gains: [],
        controls: [{ node: 'dirt', symbol: 'wet_mix', value: 2 }],
      },
    ],
  };
  state.control!.scene = 'lead';
  expect(
    await screen.findByRole('button', { name: 'Scene 1: Lead' }),
  ).toBeVisible();
  expect(screen.queryByRole('button', { name: /^\d+ changes?$/ })).toBeNull();
});
