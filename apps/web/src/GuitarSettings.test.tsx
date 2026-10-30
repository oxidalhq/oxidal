import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { guitarProfiles, monitoring, type GuitarProfiles } from './api';
import { gateFor, trimFor } from './useGuitars';
vi.unmock('./GuitarSettings');
vi.mock('./api', () => ({ guitarProfiles: vi.fn(), monitoring: vi.fn() }));
const { GuitarSettings } = await import('./GuitarSettings');

// jsdom has no modal dialog.
HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
  this.open = true;
};
HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
  this.open = false;
};
class Events extends EventTarget {
  close() {}
}
let saved: GuitarProfiles;
beforeEach(() => {
  vi.stubGlobal('EventSource', Events);
  saved = { guitars: [], reference: null, active: null, character: 0 };
  vi.mocked(guitarProfiles).mockImplementation(async (update) => {
    if (update) saved = update;
    return saved;
  });
  vi.mocked(monitoring).mockResolvedValue({
    sequence: 1,
    audio: null,
  } as never);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('mirrors the daemon trim: gap to the reference, scaled by character', () => {
  const profiles: GuitarProfiles = {
    guitars: [
      { id: 'jiva', name: 'Jiva', peak_dbfs: -8 },
      { id: 'st', name: 'Steinberger', peak_dbfs: -14.3 },
    ],
    reference: 'jiva',
    active: 'st',
    character: 0,
  };
  expect(trimFor(profiles)).toBe(6.5);
  expect(trimFor({ ...profiles, character: 0.5 })).toBe(3);
  expect(trimFor({ ...profiles, active: 'jiva' })).toBe(0);
  expect(trimFor({ ...profiles, reference: null })).toBe(0);
});

it('mirrors the daemon gate: trimmed noise plus 6 dB, only when on', () => {
  const profiles: GuitarProfiles = {
    guitars: [
      { id: 'jiva', name: 'Jiva', peak_dbfs: -8 },
      {
        id: 'st',
        name: 'Steinberger',
        peak_dbfs: -14,
        noise_dbfs: -70,
        gate: true,
      },
    ],
    reference: 'jiva',
    active: 'st',
    character: 0,
  };
  expect(gateFor(profiles)).toBe(-58);
  expect(gateFor({ ...profiles, active: 'jiva' })).toBeNull();
  expect(
    gateFor({
      ...profiles,
      guitars: profiles.guitars.map((g) => ({ ...g, gate: false })),
    }),
  ).toBeNull();
});

it('measures muted-string noise, turns the gate on and refuses playing', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'performance'] });
  saved = {
    guitars: [{ id: 'st', name: 'Steinberger', peak_dbfs: -14 }],
    reference: 'st',
    active: 'st',
    character: 0,
  };
  let peak = -71.2;
  vi.mocked(monitoring).mockImplementation(
    async () =>
      ({
        sequence: 1,
        audio: { input: [{ peak_dbfs: peak }] },
      }) as never,
  );
  try {
    render(<GuitarSettings />);
    await act(async () => {});
    expect(screen.getByRole('button', { name: 'Gate' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Measure noise' }));
    expect(screen.getByText('Strings muted…')).toBeInTheDocument();
    for (let i = 0; i < 8; i++)
      await act(async () => vi.advanceTimersByTimeAsync(1000));
    expect(saved.guitars[0]).toMatchObject({ noise_dbfs: -71.2, gate: true });
    expect(screen.getByRole('button', { name: 'Gate' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByText(/gate -65 dBFS/)).toBeInTheDocument();
    peak = -12;
    fireEvent.click(screen.getByRole('button', { name: 'Measure noise' }));
    for (let i = 0; i < 8; i++)
      await act(async () => vi.advanceTimersByTimeAsync(1000));
    expect(screen.getByText(/louder than hiss/)).toBeInTheDocument();
    expect(saved.guitars[0]!.noise_dbfs).toBe(-71.2);
    fireEvent.click(screen.getByRole('button', { name: 'Gate' }));
    await act(async () => {});
    expect(saved.guitars[0]!.gate).toBe(false);
  } finally {
    vi.useRealTimers();
  }
});

it('adds a guitar, makes it the one playing, and switches between guitars', async () => {
  render(<GuitarSettings />);
  await act(async () => {});
  for (const name of ['Ibanez Jiva', 'Steinberger']) {
    fireEvent.click(screen.getByRole('button', { name: 'Add guitar' }));
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: name },
    });
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Add guitar',
      }),
    );
    await act(async () => {});
  }
  expect(saved.guitars.map((g) => g.name)).toEqual([
    'Ibanez Jiva',
    'Steinberger',
  ]);
  expect(saved.active).toBe(saved.guitars[0]!.id);
  expect(screen.getAllByText('Not measured')).toHaveLength(2);
  fireEvent.click(screen.getAllByRole('button', { name: 'Play this' })[0]!);
  await act(async () => {});
  expect(saved.active).toBe(saved.guitars[1]!.id);
  fireEvent.click(screen.getAllByRole('button', { name: 'Rename' })[1]!);
  fireEvent.change(screen.getByLabelText('Name'), {
    target: { value: 'Steinberger Spirit' },
  });
  fireEvent.click(
    within(screen.getByRole('dialog')).getByRole('button', { name: 'Rename' }),
  );
  await act(async () => {});
  expect(saved.guitars[1]!.name).toBe('Steinberger Spirit');
});
