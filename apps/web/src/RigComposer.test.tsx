import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { RigComposer } from './RigComposer';
import { rigAudioCommand, type RigAudioState } from './api';
import type { DraftEffect } from './rigDraft';
const input = {
  endpoint: 'test',
  direction: 'capture',
  sample_rate: 48000,
  channels: 2,
  format: 's16',
  period_frames: 128,
  periods: 3,
};
const stream = {
  input,
  output: { ...input, direction: 'playback' },
  input_map: [0, 1],
  output_map: [0, 1],
};
let current: RigAudioState;
vi.mock('./api', () => ({
  rigNativeSources: vi.fn(async () => []),
  installedLv2: vi.fn(async () => []),
  rigLibrary: vi.fn(async () => ({ native_profile: 'test' })),
  rigAudioState: vi.fn(async () => current),
  rigAudioCommand: vi.fn(),
  publishRig: vi.fn(async () => ({ revision: 'a'.repeat(64) })),
  playbackState: vi.fn(async () => ({
    device_owned: false,
    configured: { stream },
  })),
  graphAudioState: vi.fn(async () => ({
    device_owned: false,
    configured: null,
  })),
}));
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
  current = {
    session: 'owner',
    revision: 1,
    phase: 'stopped',
    start_on_boot: false,
    recovery_error: null,
    configured: null,
    control: null,
    telemetry: null,
    processed_frames: 0,
    device_owned: false,
    error: null,
    save: null,
  };
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal');
  Reflect.deleteProperty(HTMLDialogElement.prototype, 'close');
});
it('uses one signal canvas and selected-block inspector for chain and scenes', async () => {
  const user = userEvent.setup();
  const effects: DraftEffect[] = [
    {
      id: 'tone',
      kind: 'native',
      name: 'Clean tone',
      preset: {
        name: 'Clean tone',
        sha256: 'a'.repeat(64),
        size_bytes: 1024,
      } as never,
      source: { kind: 'owned', id: 'clean' } as never,
    },
    {
      id: 'delay',
      kind: 'lv2',
      name: 'Tape delay',
      plugin: {
        uri: 'urn:test:delay',
        name: 'Tape delay',
        ports: [
          { audio: true, input: true },
          { audio: true, output: true },
        ],
      } as never,
      mono: 'sum',
      controls: {},
    },
  ];
  const { container } = render(
    <RigComposer
      connected
      initial={effects}
      initialName="Canvas draft"
      onOpenRig={() => {}}
      onBack={() => {}}
    />,
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Close' }));
  expect(screen.getByRole('tab', { name: 'Chain' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  expect(screen.getByRole('heading', { name: 'Clean tone' })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Tape delay' }));
  expect(screen.getByRole('heading', { name: 'Tape delay' })).toBeVisible();
  expect(screen.getByText('Effect', { selector: '.ui-badge' })).toBeVisible();
  fireEvent.click(
    screen.getByRole('button', { name: 'Move Tape delay earlier' }),
  );
  expect(
    container.querySelector('.rig-tile:first-child .rig-tile-label'),
  ).toHaveTextContent('Tape delay');
  await user.click(screen.getByRole('tab', { name: 'Scenes' }));
  expect(screen.getByLabelText('Scene tails')).toHaveValue('preserve');
  fireEvent.click(screen.getByRole('button', { name: 'Clean tone' }));
  expect(screen.getByLabelText('Scene 1 name')).toHaveValue('Clean tone');
  expect(screen.getByText('Shared after scenes')).toBeVisible();
});
it('retains the draft when cancel races with native readiness', async () => {
  const open = vi.fn();
  let releaseStop: () => void = () => {};
  const pendingStop = new Promise<void>((resolve) => {
    releaseStop = resolve;
  });
  vi.mocked(rigAudioCommand).mockImplementation(async (_state, action) => {
    if (action.kind === 'start') {
      current = {
        ...current,
        phase: 'starting',
        configured: action.settings,
        device_owned: true,
      };
    } else if (action.kind === 'stop') {
      // The child becomes ready while the user's accepted Stop is still awaiting reply.
      current = { ...current, phase: 'running' };
      await pendingStop;
      current = { ...current, phase: 'stopped', device_owned: false };
    }
    return current;
  });
  render(
    <RigComposer
      connected
      initial={[]}
      initialName="Retained draft"
      onOpenRig={open}
      onBack={() => {}}
    />,
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Close' }));
  fireEvent.click(screen.getByRole('button', { name: 'Play draft' }));
  fireEvent.click(
    await screen.findByRole('button', {
      name: 'Cancel preparation',
    }),
  );
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 350));
  });
  expect(open).not.toHaveBeenCalled();
  await act(async () => {
    releaseStop();
    await pendingStop;
  });
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Play draft' })).toBeEnabled(),
  );
  expect(screen.getByLabelText('Preset name')).toHaveValue('Retained draft');
  expect(open).not.toHaveBeenCalled();
});
