import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { MixedRig } from './MixedRig';
import { rigAudioState, rigAudioCommand, rigDocument } from './api';
vi.mock('./api', () => ({
  rigAudioState: vi.fn(),
  rigAudioCommand: vi.fn(),
  rigDocument: vi.fn(),
}));
// The picker has its own tests; here it only needs to render.
vi.mock('./RigPresetSelector', () => ({ RigPresetSelector: () => null }));
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
  cleanup();
  vi.resetAllMocks();
  Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal');
  Reflect.deleteProperty(HTMLDialogElement.prototype, 'close');
});
function setup() {
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
      extensions: {},
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
