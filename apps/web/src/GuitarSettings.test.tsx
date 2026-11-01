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
const { GuitarPicker, GuitarSettings } = await import('./GuitarSettings');

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
  saved = { guitars: [], reference: null, active: null };
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

it('mirrors the daemon: the active guitar trim, and its gate above trimmed noise', () => {
  const profiles: GuitarProfiles = {
    guitars: [
      { id: 'jiva', name: 'Jiva', trim_db: 0, peak_dbfs: -8 },
      {
        id: 'st',
        name: 'Steinberger',
        trim_db: 4,
        peak_dbfs: -14,
        noise_dbfs: -70,
        gate: true,
      },
    ],
    reference: 'jiva',
    active: 'st',
  };
  expect(trimFor(profiles)).toBe(4);
  expect(trimFor({ ...profiles, active: null })).toBe(0);
  expect(gateFor(profiles)).toBe(-60);
  expect(gateFor({ ...profiles, active: 'jiva' })).toBeNull();
  expect(
    gateFor({
      ...profiles,
      guitars: profiles.guitars.map((g) => ({ ...g, gate: false })),
    }),
  ).toBeNull();
});

it('shows measured strum and noise levels on each profile row', async () => {
  saved = {
    guitars: [
      { id: 'jiva', name: 'Jiva', trim_db: 0, peak_dbfs: null },
      {
        id: 'st',
        name: 'Steinberger',
        trim_db: 0,
        peak_dbfs: -21.9,
        noise_dbfs: -35.6,
        gate: false,
      },
    ],
    reference: 'st',
    active: 'st',
  };

  render(<GuitarSettings />);

  expect(
    await screen.findByText('Strum not measured. Noise not measured.'),
  ).toBeVisible();
  expect(
    screen.getByText('Measured strum −21.9 dBFS. Noise −35.6 dBFS · gate off.'),
  ).toBeVisible();
});

it('sets a trim by hand in 0.5 dB steps and resets it', async () => {
  saved = {
    guitars: [{ id: 'st', name: 'Steinberger', trim_db: 0, peak_dbfs: null }],
    reference: null,
    active: 'st',
  };
  render(<GuitarSettings />);
  await act(async () => {});
  fireEvent.click(screen.getByRole('button', { name: 'Trim' }));
  const dialog = within(screen.getByRole('dialog'));
  for (let i = 0; i < 8; i++) {
    fireEvent.click(dialog.getByRole('button', { name: 'Trim up 0.5 dB' }));
    await act(async () => {});
  }
  expect(saved.guitars[0]!.trim_db).toBe(4);
  expect(dialog.getByText('+4.0 dB')).toBeInTheDocument();
  fireEvent.click(dialog.getByRole('button', { name: 'Reset to 0 dB' }));
  await act(async () => {});
  expect(saved.guitars[0]!.trim_db).toBe(0);
});

it('matches a measured strum to the first guitar and gates muted-string noise', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'performance'] });
  saved = {
    guitars: [
      { id: 'jiva', name: 'Jiva', trim_db: 0, peak_dbfs: -8 },
      { id: 'st', name: 'Steinberger', trim_db: 0, peak_dbfs: null },
    ],
    reference: 'jiva',
    active: 'st',
  };
  let peak = -12.2;
  vi.mocked(monitoring).mockImplementation(
    async () =>
      ({ sequence: 1, audio: { input: [{ peak_dbfs: peak }] } }) as never,
  );
  const wait = async () => {
    for (let i = 0; i < 8; i++)
      await act(async () => vi.advanceTimersByTimeAsync(1000));
  };
  try {
    render(<GuitarSettings />);
    await act(async () => {});
    fireEvent.click(screen.getAllByRole('button', { name: 'Trim' })[1]!);
    fireEvent.click(screen.getByRole('button', { name: 'Measure strum' }));
    expect(screen.getByText('Strum hard…')).toBeInTheDocument();
    await wait();
    // −8 reference, −12.2 here: +4.2 rounds to +4.0.
    expect(saved.guitars[1]).toMatchObject({ trim_db: 4, peak_dbfs: -12.2 });
    expect(
      screen.getByText(/Matched to Jiva: trim \+4\.0 dB/),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Gate' })[1]!);
    peak = -71.2;
    fireEvent.click(screen.getByRole('button', { name: 'Measure noise' }));
    await wait();
    expect(saved.guitars[1]).toMatchObject({ noise_dbfs: -71.2, gate: true });
    // −71.2 noise, +4 trim, +6 margin.
    expect(
      within(screen.getByRole('dialog')).getByText(/opens at -61 dBFS/),
    ).toBeInTheDocument();
    peak = -12;
    fireEvent.click(screen.getByRole('button', { name: 'Measure noise' }));
    await wait();
    expect(screen.getByText(/louder than hiss/)).toBeInTheDocument();
    expect(saved.guitars[1]!.noise_dbfs).toBe(-71.2);
    fireEvent.click(screen.getByRole('button', { name: 'Gate on' }));
    await act(async () => {});
    expect(saved.guitars[1]!.gate).toBe(false);
  } finally {
    vi.useRealTimers();
  }
});

it('adds, switches and renames guitars', async () => {
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
  expect(saved.guitars.map((g) => [g.name, g.trim_db])).toEqual([
    ['Ibanez Jiva', 0],
    ['Steinberger', 0],
  ]);
  expect(saved.active).toBe(saved.guitars[0]!.id);
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

it('shows the playing guitar beside Level and switches it from a dialog', async () => {
  saved = {
    guitars: [
      { id: 'jiva', name: 'Jiva', trim_db: 0, peak_dbfs: -8 },
      { id: 'st', name: 'Steinberger', trim_db: 4, peak_dbfs: -14 },
    ],
    reference: 'jiva',
    active: 'jiva',
  };
  render(<GuitarPicker />);
  fireEvent.click(await screen.findByRole('button', { name: 'Guitar: Jiva' }));
  fireEvent.click(screen.getByRole('button', { name: /Steinberger/ }));
  await act(async () => {});
  expect(saved.active).toBe('st');
  expect(
    await screen.findByRole('button', { name: 'Guitar: Steinberger' }),
  ).toBeInTheDocument();
});

it('offers no picker with fewer than two guitars', async () => {
  saved = {
    guitars: [{ id: 'jiva', name: 'Jiva', trim_db: 0, peak_dbfs: -8 }],
    reference: 'jiva',
    active: 'jiva',
  };
  render(<GuitarPicker />);
  await act(async () => {});
  expect(screen.queryByRole('button', { name: /Guitar:/ })).toBeNull();
});
