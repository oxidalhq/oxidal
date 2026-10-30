import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { EngineSettings } from './EngineSettings';
import {
  nativeDefaults,
  playbackCommand,
  playbackState,
  type AudioState,
  type NativeDefaults,
} from './api';
vi.mock('./api', () => ({
  nativeDefaults: vi.fn(),
  playbackCommand: vi.fn(),
  playbackState: vi.fn(),
}));
// jsdom has no modal dialog.
HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
  this.open = true;
};
HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
  this.open = false;
};
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
const running = {
  session: 's',
  revision: 4,
  phase: 'running',
  authoring: {
    settings: [
      {
        target: 'osEnabled',
        label: 'Oversampling',
        display: 'On',
        value: 1,
        toggle: true,
      },
      {
        target: 'block:a:slimSize',
        label: 'NAM size · left · Amp',
        display: 'Lite',
        value: 0,
      },
    ],
    setting_steps: { osEnabled: 1 },
  },
} as unknown as AudioState;

it('lists unit engine settings with device defaults and applies through the running session', async () => {
  vi.mocked(playbackState).mockResolvedValue(running);
  vi.mocked(nativeDefaults).mockResolvedValue({
    revision: 1,
    settings: { nam_size: 0, multi_core: false, parameters: { osEnabled: 0 } },
  } as unknown as NativeDefaults);
  vi.mocked(playbackCommand).mockResolvedValue({ ...running, revision: 5 });
  render(<EngineSettings connected />);
  const group = await screen.findByRole('group', {
    name: 'Prepared DSP settings',
  });
  expect(group).toHaveTextContent('Oversampling');
  // Block model size stays with the block in Rig, not here.
  expect(group).not.toHaveTextContent('NAM size');
  await waitFor(() => expect(group).toHaveTextContent('Device default: Off.'));
  fireEvent.click(screen.getByRole('button', { name: 'Oversampling · On' }));
  fireEvent.click(screen.getByRole('switch', { name: 'Oversampling' }));
  fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
  await waitFor(() =>
    expect(playbackCommand).toHaveBeenCalledWith(running, {
      kind: 'authoring',
      action: { kind: 'parameter', parameter: 'osEnabled', value: 0 },
    }),
  );
});

it('explains that a native rig must be running', async () => {
  vi.mocked(playbackState).mockResolvedValue({
    ...running,
    phase: 'stopped',
  } as AudioState);
  vi.mocked(nativeDefaults).mockRejectedValue(new Error('offline'));
  render(<EngineSettings connected />);
  expect(
    await screen.findByText(
      /Play a TONE3000 preset to change the running engine/,
    ),
  ).toBeInTheDocument();
});
