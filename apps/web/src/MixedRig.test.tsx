import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { MixedRig } from './MixedRig';
import { setPerform } from './performState';
import { playScenes } from './presetChoices';
import { rigAudioState, rigAudioCommand, rigDocument } from './api';
vi.mock('./api', () => ({
  rigAudioState: vi.fn(),
  rigAudioCommand: vi.fn(),
  rigDocument: vi.fn(),
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
function setup(origin: 'mine' | 'oxidal_example' = 'mine') {
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
    },
  } as unknown as Awaited<ReturnType<typeof rigAudioState>>;
  vi.mocked(rigAudioState).mockResolvedValue(state);
  vi.mocked(rigAudioCommand).mockResolvedValue(state);
  vi.mocked(rigDocument).mockResolvedValue({
    revision: 'rig',
    manifest: {
      name: 'Test rig',
      extensions:
        origin === 'mine' ? {} : { 'urn:oxidal:authoring': { origin } },
      tone3000: { instances: [{ id: 'native' }] },
      oxidal: {
        lv2: [],
        graph: { nodes: [{ id: 'amp', kind: 'tone3000', instance: 'native' }] },
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
  fireEvent.click(await screen.findByRole('button', { name: 'Perform view' }));
  const tile = await screen.findByRole('button', {
    name: 'Oxidal Hold (Stereo) on',
  });
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
