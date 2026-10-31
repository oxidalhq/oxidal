import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SceneMidi } from './SceneMidi';
import { midiDevices } from './api';
import type { RigAudioState } from './api';
vi.mock('./api', () => ({
  midiDevices: vi.fn(async () => ({
    available: true,
    inputs: [{ id: 'hw:Controller,0,0', name: 'Controller' }],
    warnings: [],
  })),
  midiMap: vi.fn(async () => ({
    revision: 'midi-map',
    input: 'hw:Controller,0,0',
    channel: 2,
    entries: [],
  })),
  libraryCatalog: vi.fn(async () => ({
    revision: 'catalog',
    items: [
      {
        kind: 'rig',
        id: 'a'.repeat(64),
        origin: 'mine',
        archived: false,
      },
    ],
  })),
}));
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function (
    this: HTMLDialogElement,
  ) {
    this.setAttribute('open', '');
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute('open');
  });
});
afterEach(cleanup);
function state(): RigAudioState {
  const input = {
    endpoint: 'test',
    direction: 'capture' as const,
    sample_rate: 48000,
    channels: 2,
    format: 's16' as const,
    period_frames: 128,
    periods: 3,
  };
  return {
    session: 'owner',
    revision: 1,
    phase: 'running',
    start_on_boot: false,
    recovery_error: null,
    telemetry: null,
    processed_frames: 64,
    device_owned: true,
    error: null,
    save: null,
    configured: {
      revision: 'a'.repeat(64),
      prepared: [],
      recall: null,
      stream: {
        input,
        output: { ...input, direction: 'playback' },
        input_map: [0, 1],
        output_map: [0, 1],
      },
      midi: {
        input: 'hw:Controller,0,0',
        channel: 2,
        bindings: [],
        branch_bindings: [],
        parameter_bindings: [
          {
            target: { kind: 'lv2', node: 'fx', symbol: 'gain' },
            controller: 20,
            mode: 'absolute',
          },
        ],
      },
    },
    control: {
      session: 'control',
      revision: 1,
      source_revision: 'a'.repeat(64),
      modified: false,
      buffer_bytes: 256,
      latency_frames: 0,
      controls: [
        {
          target: { kind: 'lv2', node: 'fx', symbol: 'gain' },
          label: 'Gain',
          value: 0.5,
          minimum: 0,
          maximum: 1,
          integer: false,
          toggle: false,
          logarithmic: false,
          display: '0.5',
        },
      ],
      midi: {
        connected: true,
        events: 10,
        last: { kind: 'control', channel: 2, controller: 30, value: 100 },
        error: null,
      },
    },
  };
}
async function open() {
  fireEvent.click(screen.getByRole('button', { name: /MIDI controls/ }));
  await waitFor(() =>
    expect(screen.getByLabelText('Parameter CC 1')).toHaveValue(20),
  );
}
it('learns only a fresh CC on the selected channel and keeps the first result until Apply', async () => {
  const current = state();
  const command = vi.fn(async () => {});
  const view = render(
    <SceneMidi state={current} disabled={false} onCommand={command} />,
  );
  await open();
  fireEvent.click(screen.getByRole('button', { name: 'Learn CC 1' }));
  view.rerender(
    <SceneMidi state={{ ...current }} disabled={false} onCommand={command} />,
  );
  expect(screen.getByLabelText('Parameter CC 1')).toHaveValue(20); // old message cannot learn
  current.control!.midi = {
    connected: true,
    events: 11,
    last: { kind: 'program', channel: 2, program: 5 },
    error: null,
  };
  view.rerender(
    <SceneMidi state={{ ...current }} disabled={false} onCommand={command} />,
  );
  current.control!.midi = {
    connected: true,
    events: 12,
    last: { kind: 'control', channel: 1, controller: 31, value: 0 },
    error: null,
  };
  view.rerender(
    <SceneMidi state={{ ...current }} disabled={false} onCommand={command} />,
  );
  expect(screen.getByLabelText('Parameter CC 1')).toHaveValue(20);
  current.control!.midi = {
    connected: true,
    events: 13,
    last: { kind: 'control', channel: 2, controller: 42, value: 0 },
    error: null,
  };
  view.rerender(
    <SceneMidi state={{ ...current }} disabled={false} onCommand={command} />,
  );
  expect(screen.getByLabelText('Parameter CC 1')).toHaveValue(42);
  current.control!.midi = {
    connected: true,
    events: 14,
    last: { kind: 'control', channel: 2, controller: 33, value: 127 },
    error: null,
  };
  view.rerender(
    <SceneMidi state={{ ...current }} disabled={false} onCommand={command} />,
  );
  expect(screen.getByLabelText('Parameter CC 1')).toHaveValue(42);
  expect(command).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Apply MIDI' }));
  expect(command).toHaveBeenCalledWith(
    expect.objectContaining({
      kind: 'midi',
      settings: expect.objectContaining({
        parameter_bindings: [
          {
            target: { kind: 'lv2', node: 'fx', symbol: 'gain' },
            controller: 42,
            mode: 'absolute',
          },
        ],
      }),
    }),
  );
});
it('cancels learning and never learns from an unavailable controller', async () => {
  const current = state();
  const command = vi.fn(async () => {});
  const view = render(
    <SceneMidi state={current} disabled={false} onCommand={command} />,
  );
  await open();
  fireEvent.click(screen.getByRole('button', { name: 'Learn CC 1' }));
  fireEvent.click(screen.getByRole('button', { name: 'Cancel learn' }));
  current.control!.midi = {
    connected: true,
    events: 11,
    last: { kind: 'control', channel: 2, controller: 32, value: 0 },
    error: null,
  };
  view.rerender(
    <SceneMidi state={{ ...current }} disabled={false} onCommand={command} />,
  );
  expect(screen.getByLabelText('Parameter CC 1')).toHaveValue(20);
  current.control!.midi.connected = false;
  view.rerender(
    <SceneMidi state={{ ...current }} disabled={false} onCommand={command} />,
  );
  expect(screen.getByRole('button', { name: 'Learn CC 1' })).toBeDisabled();
});

it('resets unsubmitted mappings and cancels learning without changing the controller', async () => {
  const current = state();
  const command = vi.fn(async () => {});
  render(<SceneMidi state={current} disabled={false} onCommand={command} />);
  await open();
  fireEvent.change(screen.getByLabelText('Parameter CC 1'), {
    target: { value: '43' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Learn CC 1' }));
  fireEvent.click(screen.getByRole('button', { name: 'Reset edits' }));
  expect(screen.getByLabelText('Parameter CC 1')).toHaveValue(20);
  expect(
    screen.queryByRole('button', { name: 'Cancel learn' }),
  ).not.toBeInTheDocument();
  expect(command).not.toHaveBeenCalled();
});

it('learns Program Change for a scene and CC for an independent switch', async () => {
  const current = state();
  current.configured!.midi!.bindings = [
    { scene: 'clean', program: 0, controller: null },
  ];
  current.configured!.midi!.branch_bindings = [
    { branch: 'boost', controller: 21, mode: 'toggle' },
  ];
  current.control!.scenes = {
    fade_ms: 10,
    scenes: [{ id: 'clean', name: 'Clean', gains: [] }],
    branches: [],
  };
  current.control!.branches = [
    { id: 'boost', name: 'Boost', enabled: false, partial: false },
  ];
  const view = render(
    <SceneMidi state={current} disabled={false} onCommand={vi.fn()} />,
  );
  await open();
  fireEvent.click(screen.getByRole('button', { name: 'Learn message' }));
  current.control!.midi = {
    connected: true,
    events: 11,
    last: { kind: 'program', channel: 2, program: 7 },
    error: null,
  };
  view.rerender(
    <SceneMidi state={{ ...current }} disabled={false} onCommand={vi.fn()} />,
  );
  await waitFor(() =>
    expect(screen.getByLabelText('MIDI number 1')).toHaveValue(8),
  );

  fireEvent.click(screen.getByRole('button', { name: 'Learn CC' }));
  current.control!.midi = {
    connected: true,
    events: 12,
    last: { kind: 'control', channel: 2, controller: 42, value: 127 },
    error: null,
  };
  view.rerender(
    <SceneMidi state={{ ...current }} disabled={false} onCommand={vi.fn()} />,
  );
  await waitFor(() =>
    expect(screen.getByLabelText('Branch Boost CC')).toHaveValue(42),
  );
});

it('flags duplicate numbers before Apply', async () => {
  const current = state();
  current.configured!.midi!.parameter_bindings!.push({
    target: { kind: 'native', node: 'native', parameter: 'toneBass' },
    controller: 20,
    mode: 'absolute',
  });
  render(<SceneMidi state={current} disabled={false} onCommand={vi.fn()} />);
  await open();
  expect(screen.getByRole('alert')).toHaveTextContent(
    'CC 20 is assigned to Control 1 and Control 2',
  );
  expect(screen.getByRole('button', { name: 'Apply MIDI' })).toBeDisabled();
});

it('shows the global set-list program and local-scene precedence', async () => {
  render(<SceneMidi state={state()} disabled={false} onCommand={vi.fn()} />);
  await open();
  fireEvent.click(await screen.findByText('Preset recall · Program 1'));
  expect(
    await screen.findByText(/Program 1.*Mine set-list position/),
  ).toBeVisible();
  expect(
    screen.getByText(/A Program assigned to a scene below wins/),
  ).toBeVisible();
});

it('retains the draft and reports a rejected controller update', async () => {
  let reject!: (reason: Error) => void;
  const command = vi.fn(
    () =>
      new Promise<void>((_, fail) => {
        reject = fail;
      }),
  );
  render(<SceneMidi state={state()} disabled={false} onCommand={command} />);
  await open();
  fireEvent.change(screen.getByLabelText('MIDI channel'), {
    target: { value: '3' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Apply MIDI' }));
  expect(screen.getByRole('button', { name: 'Apply MIDI' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }));
  expect(screen.getByRole('dialog')).toBeVisible();
  reject(new Error('Controller update failed'));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Controller update failed',
  );
  expect(screen.getByLabelText('MIDI channel')).toHaveValue('3');
  expect(screen.getByRole('button', { name: 'Apply MIDI' })).toBeEnabled();
  expect(command).toHaveBeenCalledTimes(1);
});

it('keeps optional MIDI unconfigured when no controller exists', async () => {
  vi.mocked(midiDevices).mockResolvedValueOnce({
    available: true,
    inputs: [],
    warnings: [],
  });
  const current = state();
  current.configured!.midi = null;
  current.control!.midi = {
    connected: false,
    events: 0,
    last: null,
    error: null,
  };
  const command = vi.fn();
  render(<SceneMidi state={current} disabled={false} onCommand={command} />);
  fireEvent.click(
    screen.getByRole('button', { name: /MIDI controls.*Not configured/ }),
  );
  expect(await screen.findByText(/No MIDI controller connected/)).toBeVisible();
  expect(screen.queryByText(/Waiting for controller/)).toBeNull();
  expect(screen.queryByLabelText('MIDI channel')).toBeNull();
  expect(command).not.toHaveBeenCalled();
});
