import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  keepReady,
  rigAudioCommand,
  rigAudioState,
  rigLibrary,
  setKeepReady,
} from './api';
import { DeviceError } from './lib/friendlyError';
import { SavedRigs } from './SavedRigs';

vi.mock('./api', () => ({
  rigAudioState: vi.fn(),
  rigAudioCommand: vi.fn(),
  rigLibrary: vi.fn(),
  keepReady: vi.fn(),
  setKeepReady: vi.fn(),
}));

const revisions = ['a', 'b', 'c', 'd', 'e'].map((letter) => letter.repeat(64));

beforeEach(() => {
  localStorage.clear();
  vi.mocked(rigAudioState).mockResolvedValue({ phase: 'stopped' } as never);
  vi.mocked(keepReady).mockResolvedValue({ revisions: [] });
  vi.mocked(setKeepReady).mockImplementation(async (revisions) => ({
    revisions,
  }));
  vi.mocked(rigLibrary).mockResolvedValue({
    presets: revisions.map((revision, index) => ({
      revision,
      name: `Factory ${index + 1}`,
      origin: 'oxidal_example',
      scenes: ['Clean', 'Lead'],
      topology: 'scenes',
      native_instances: 1,
      lv2_instances: 1,
    })),
    next: null,
  } as never);
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.resetAllMocks();
});

it('offers a bounded custom gapless bank for factory rigs', async () => {
  render(
    <SavedRigs
      connected
      onOpenRig={() => {}}
      origin="oxidal_example"
      title="Oxidal examples"
    />,
  );
  await waitFor(() => expect(screen.getByText('Factory 1')).toBeVisible());
  fireEvent.click(screen.getByRole('button', { name: 'Keep ready' }));
  expect(
    screen.getByText(/Choose up to 4 more presets to keep ready/),
  ).toBeVisible();
  for (let index = 1; index <= 4; index += 1) {
    fireEvent.click(screen.getByLabelText(`Keep Factory ${index} ready`));
  }
  expect(screen.getByLabelText('Keep Factory 5 ready')).toBeDisabled();
  // The choice is stored on the device, not in this browser (7.7).
  await waitFor(() =>
    expect(setKeepReady).toHaveBeenLastCalledWith(revisions.slice(0, 4)),
  );
  expect(localStorage.getItem('oxidal.prepared-rigs')).toBeNull();
});

it("imports this browser's earlier Keep ready choice once when the device has none", async () => {
  localStorage.setItem(
    'oxidal.prepared-rigs',
    JSON.stringify(revisions.slice(0, 2)),
  );
  render(
    <SavedRigs
      connected
      onOpenRig={() => {}}
      origin="oxidal_example"
      title="Oxidal examples"
    />,
  );
  await waitFor(() =>
    expect(setKeepReady).toHaveBeenCalledWith(revisions.slice(0, 2)),
  );
  expect(localStorage.getItem('oxidal.prepared-rigs')).toBeNull();
});

it('reports only worker-confirmed Ready and restarts to prepare after confirmation', async () => {
  const running = {
    phase: 'running',
    configured: { revision: revisions[0], stream: {}, prepared: [] },
    control: {
      modified: true,
      prepared: [
        { revision: revisions[1], name: 'Factory 2', modified: false },
        {
          revision: revisions[2],
          name: 'Factory 3',
          modified: false,
          error: 'Not enough memory',
        },
      ],
    },
  };
  vi.mocked(rigAudioState).mockResolvedValue(running as never);
  vi.mocked(keepReady).mockResolvedValue({
    revisions: [revisions[1]!, revisions[2]!, revisions[3]!],
  });
  vi.mocked(rigAudioCommand).mockResolvedValue(running as never);
  render(
    <SavedRigs
      connected
      onOpenRig={() => {}}
      origin="oxidal_example"
      title="Oxidal examples"
    />,
  );
  // Playing + one confirmed alternative; the failed one is not Ready.
  expect(await screen.findByText('2 of 5 presets ready')).toBeVisible();
  expect(screen.getAllByText(/Selected · not ready yet/)).toHaveLength(2);
  fireEvent.click(screen.getByRole('button', { name: /^Keep ready/ }));
  fireEvent.click(
    screen.getByRole('button', { name: 'Prepare & restart audio…' }),
  );
  expect(screen.getByText(/Unsaved edits to the playing preset/)).toBeVisible();
  expect(rigAudioCommand).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Prepare & restart' }));
  await waitFor(() => expect(rigAudioCommand).toHaveBeenCalled());
  const action = vi.mocked(rigAudioCommand).mock.calls[0]![1] as {
    kind: string;
    settings: { revision: string; prepared: { revision: string }[] };
  };
  expect(action.kind).toBe('start');
  expect(action.settings.revision).toBe(revisions[0]);
  expect(action.settings.prepared.map((p) => p.revision)).toEqual(
    revisions.slice(1, 4),
  );
});

it('offers Try again when playing fails because the device is busy', async () => {
  render(
    <SavedRigs
      connected
      onOpenRig={() => {}}
      origin="oxidal_example"
      title="Oxidal"
    />,
  );
  await waitFor(() => expect(screen.getByText('Factory 1')).toBeVisible());
  vi.mocked(rigAudioState).mockRejectedValue(
    new DeviceError(
      'Preset library operation already in progress',
      'busy',
      409,
    ),
  );
  const calls = vi.mocked(rigAudioState).mock.calls.length;
  fireEvent.click(screen.getAllByRole('button', { name: /^Play/ })[0]!);
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Could not play this preset. Another change is still running on the device.',
  );
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  await waitFor(() =>
    expect(vi.mocked(rigAudioState).mock.calls.length).toBeGreaterThan(
      calls + 1,
    ),
  );
});
