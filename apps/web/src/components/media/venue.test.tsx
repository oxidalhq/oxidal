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
  keepVenuePreview,
  protectState,
  venueCommand,
  VenueConflict,
  type VenueSettings,
  type VenueState,
  venueState,
} from '../../api';
import { DeviceError } from '../../lib/friendlyError';
import { leaveScreen } from '../../lib/leaveGuard';
import { withBand } from '../../lib/venueEq';
import { publishVenue } from '../../lib/venueFeed';
import { VenueEq, VenueProvider } from './VenueEq';

vi.mock('../../api', async (original) => ({
  ...(await original<typeof import('../../api')>()),
  keepVenuePreview: vi.fn(),
  protectState: vi.fn(),
  venueCommand: vi.fn(),
  venueState: vi.fn(),
}));

function flat(): VenueSettings {
  const band = (enabled: boolean, freqHz: number, q: number) => ({
    enabled,
    freqHz,
    gainDb: 0,
    q,
    steep: false,
  });
  return {
    bands: [
      band(false, 80, 0.707),
      band(true, 120, 0.707),
      band(true, 250, 1),
      band(true, 1000, 1),
      band(true, 3500, 1),
      band(true, 8000, 0.707),
      band(false, 12000, 0.707),
    ],
    trimDb: 0,
  };
}
const room = withBand(withBand(flat(), 0, { enabled: true, freqHz: 100 }), 2, {
  gainDb: -3,
  freqHz: 220,
  q: 1.4,
});
function state(change: Partial<VenueState> = {}): VenueState {
  return {
    revision: 3,
    destination: 'main',
    active: 'user-room',
    bypass: false,
    notice: null,
    preview: null,
    profiles: [
      {
        id: 'builtin-flat',
        name: 'Flat',
        notes: 'No correction',
        builtin: true,
        eq: flat(),
      },
      {
        id: 'builtin-small-pa',
        name: 'Small PA',
        notes: '',
        builtin: true,
        eq: withBand(flat(), 5, { gainDb: -2 }),
      },
      {
        id: 'user-room',
        name: 'Rehearsal room',
        notes: 'Boomy corner',
        builtin: false,
        eq: room,
      },
    ],
    ...change,
  };
}
const editing = (eq: VenueSettings, change: Partial<VenueState> = {}) =>
  state({
    revision: 4,
    preview: { base: 'user-room', eq, compareSaved: false },
    ...change,
  });

beforeEach(() => {
  vi.mocked(protectState).mockResolvedValue({ on: false });
  vi.mocked(keepVenuePreview).mockResolvedValue();
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

async function shown(initial: VenueState) {
  vi.mocked(venueState).mockResolvedValue(initial);
  render(<VenueEq connected />);
  await screen.findByRole('combobox', { name: 'Venue profile' });
  return screen.findByRole('region', { name: 'Venue EQ' });
}

it('shows the active profile, its notes and a headroom check', async () => {
  const panel = await shown(state());
  expect(panel).toHaveTextContent(
    'Applies to: Main outputs (and headphones on this interface).',
  );
  expect(panel).toHaveTextContent('Boomy corner');
  expect(panel).toHaveTextContent(
    "Doesn't change presets, recordings or reamp results.",
  );
  expect(
    within(panel).getByRole('combobox', { name: 'Venue profile' }),
  ).toHaveTextContent('Rehearsal room');
  expect(within(panel).getByText(/Peak boost 0\.0 dB/)).toBeInTheDocument();
  expect(within(panel).queryByText('Edited · unsaved')).toBeNull();
  expect(within(panel).getByRole('button', { name: 'Save' })).toBeDisabled();
  expect(within(panel).getByRole('button', { name: 'Revert' })).toBeDisabled();
  expect(
    within(panel).getByRole('button', { name: 'Compare to saved' }),
  ).toBeDisabled();
  // Low mid is selected first: its fields show.
  expect(
    within(panel).getByRole('button', { name: /^LM.*Low mid$/, pressed: true }),
  ).toBeVisible();
  expect(
    within(panel).getByRole('slider', { name: 'Low mid gain' }),
  ).toHaveAttribute('aria-valuenow', '-3');
  expect(within(panel).getByLabelText('Q value')).toHaveTextContent('1.40');
});

it('labels built-ins as starting points', async () => {
  const panel = await shown(state({ active: 'builtin-small-pa' }));
  expect(panel).toHaveTextContent(
    '“Small PA” is a starting point to tune by ear, not a measured correction. Saving makes your own copy.',
  );
  // A built-in can be duplicated but not renamed or deleted.
  fireEvent.click(
    within(panel).getByRole('button', { name: 'Profile actions' }),
  );
  const menu = screen.getByRole('menu', { name: 'Profile actions' });
  expect(
    within(menu)
      .getAllByRole('menuitem')
      .map((item) => item.textContent),
  ).toEqual(['Duplicate']);
});

it('previews a step at once and shows Edited with Save and Revert', async () => {
  const panel = await shown(state());
  const raised = withBand(room, 2, { gainDb: -2.5, enabled: true });
  vi.mocked(venueCommand).mockResolvedValueOnce(editing(raised));
  fireEvent.click(within(panel).getByRole('button', { name: 'Raise Gain' }));
  await waitFor(() => expect(venueCommand).toHaveBeenCalledTimes(1));
  expect(vi.mocked(venueCommand).mock.calls[0]![0]).toEqual({
    expectedRevision: 3,
    command: { kind: 'preview', eq: raised },
  });
  expect(await within(panel).findByText('Edited · unsaved')).toBeVisible();
  expect(
    within(panel).getByRole('slider', { name: 'Low mid gain' }),
  ).toHaveAttribute('aria-valuenow', '-2.5');
  expect(within(panel).getByRole('button', { name: 'Save' })).toBeEnabled();
  expect(
    within(panel).getByText('Solid: what you hear · dashed: saved'),
  ).toBeVisible();

  // Compare is a one-tap toggle against the newest revision.
  vi.mocked(venueCommand).mockResolvedValueOnce(
    editing(raised, {
      revision: 5,
      preview: { base: 'user-room', eq: raised, compareSaved: true },
    }),
  );
  fireEvent.click(
    within(panel).getByRole('button', { name: 'Compare to saved' }),
  );
  await waitFor(() =>
    expect(
      within(panel).getByRole('button', { name: 'Compare to saved' }),
    ).toHaveAttribute('aria-pressed', 'true'),
  );
  expect(vi.mocked(venueCommand).mock.calls[1]![0]).toEqual({
    expectedRevision: 4,
    command: { kind: 'compare_saved', saved: true },
  });
  expect(
    within(panel).getByText('Comparing: you hear the saved profile'),
  ).toBeVisible();

  vi.mocked(venueCommand).mockResolvedValueOnce(state({ revision: 6 }));
  fireEvent.click(within(panel).getByRole('button', { name: 'Revert' }));
  await waitFor(() =>
    expect(within(panel).queryByText('Edited · unsaved')).toBeNull(),
  );
  expect(vi.mocked(venueCommand).mock.calls[2]![0].command).toEqual({
    kind: 'revert',
  });
});

it('turns pass filters on and off and picks their slope', async () => {
  const panel = await shown(state());
  fireEvent.click(
    within(panel).getByRole('button', { name: /^LP.*off.*Low-pass$/ }),
  );
  expect(within(panel).getByRole('group', { name: 'Slope' })).toBeVisible();
  vi.mocked(venueCommand).mockImplementation(async (request) =>
    editing((request.command as { eq: VenueSettings }).eq),
  );
  fireEvent.click(within(panel).getByRole('button', { name: 'Low-pass on' }));
  await waitFor(() => expect(venueCommand).toHaveBeenCalledTimes(1));
  const eq = (
    vi.mocked(venueCommand).mock.calls[0]![0].command as { eq: VenueSettings }
  ).eq;
  expect(eq.bands[6]).toMatchObject({ enabled: true, freqHz: 12000 });
  fireEvent.click(
    await within(panel).findByRole('button', { name: '24 dB per octave' }),
  );
  await waitFor(() => expect(venueCommand).toHaveBeenCalledTimes(2));
  const steep = (
    vi.mocked(venueCommand).mock.calls[1]![0].command as { eq: VenueSettings }
  ).eq;
  expect(steep.bands[6]!.steep).toBe(true);
});

it('warns about clipping and offers the trim that compensates', async () => {
  const loud = withBand(
    withBand(room, 2, { gainDb: 12, freqHz: 400, q: 0.5 }),
    3,
    {
      gainDb: 6,
      freqHz: 800,
      q: 0.5,
    },
  );
  const panel = await shown(editing(loud));
  const warning = within(panel).getByText(/risk of clipping/);
  expect(warning.textContent).toMatch(
    /^Adds up to \+1\d\.\d dB; risk of clipping\.$/,
  );
  const fix = within(panel).getByRole('button', { name: /^Set trim to −/ });
  vi.mocked(venueCommand).mockResolvedValueOnce(editing(loud));
  fireEvent.click(fix);
  await waitFor(() => expect(venueCommand).toHaveBeenCalledTimes(1));
  const sent = vi.mocked(venueCommand).mock.calls[0]![0].command as {
    kind: string;
    eq: VenueSettings;
  };
  expect(sent.kind).toBe('preview');
  expect(fix.textContent).toContain(
    String(Math.abs(sent.eq.trimDb).toFixed(1)),
  );
});

it('shows the other client’s change after a revision conflict', async () => {
  const panel = await shown(state());
  vi.mocked(venueCommand).mockRejectedValueOnce(
    new VenueConflict(state({ revision: 9, active: 'builtin-small-pa' })),
  );
  fireEvent.click(within(panel).getByRole('button', { name: 'Bypass: Off' }));
  expect(await within(panel).findByRole('alert')).toHaveTextContent(
    'Someone else changed the venue EQ. You are seeing their change now.',
  );
  expect(
    within(panel).getByRole('combobox', { name: 'Venue profile' }),
  ).toHaveTextContent('Small PA');
  // The next command uses the revision the conflict returned.
  vi.mocked(venueCommand).mockResolvedValueOnce(
    state({ revision: 10, active: 'builtin-small-pa', bypass: true }),
  );
  fireEvent.click(within(panel).getByRole('button', { name: 'Bypass: Off' }));
  await waitFor(() => expect(venueCommand).toHaveBeenCalledTimes(2));
  expect(vi.mocked(venueCommand).mock.calls[1]![0].expectedRevision).toBe(9);
  expect(
    await within(panel).findByRole('button', { name: 'Bypass: On' }),
  ).toHaveAttribute('aria-pressed', 'true');
  expect(
    within(panel).getByText('Bypassed: you hear the outputs flat'),
  ).toBeVisible();
});

it('follows venue events from the stream and ignores older ones', async () => {
  const panel = await shown(state());
  act(() => publishVenue(state({ revision: 7, active: 'builtin-flat' })));
  expect(
    within(panel).getByRole('combobox', { name: 'Venue profile' }),
  ).toHaveTextContent('Flat');
  act(() => publishVenue(state({ revision: 6, active: 'user-room' })));
  expect(
    within(panel).getByRole('combobox', { name: 'Venue profile' }),
  ).toHaveTextContent('Flat');
});

it('locks every control under Protect and explains why', async () => {
  vi.mocked(protectState).mockResolvedValue({ on: true });
  const panel = await shown(state());
  expect(
    await within(panel).findByText(
      'Protect is on. Venue EQ is locked: no edits, bypass or profile changes.',
    ),
  ).toBeVisible();
  for (const name of [
    'Bypass: Off',
    'Save as…',
    'Raise Gain',
    'Lower Frequency',
  ])
    expect(within(panel).getByRole('button', { name })).toBeDisabled();
  expect(
    within(panel).getByRole('combobox', { name: 'Venue profile' }),
  ).toBeDisabled();
  expect(
    within(panel).queryByRole('button', { name: 'Profile actions' }),
  ).toBeNull();
});

it('treats a 423 refusal as Protect', async () => {
  const panel = await shown(state());
  vi.mocked(venueCommand).mockRejectedValueOnce(
    new DeviceError('Protect is on', 'locked', 423),
  );
  fireEvent.click(within(panel).getByRole('button', { name: 'Bypass: Off' }));
  expect(
    await within(panel).findByText(
      'Protect is on. Venue EQ is locked: no edits, bypass or profile changes.',
    ),
  ).toBeVisible();
  expect(
    within(panel).getByRole('button', { name: 'Bypass: Off' }),
  ).toBeDisabled();
});

it('shows a discarded edit once and lets it be dismissed', async () => {
  const panel = await shown(
    state({ notice: 'Your unsaved venue edit was discarded' }),
  );
  const note = within(panel).getByText(/discarded/);
  expect(note).toHaveTextContent(
    'Your unsaved venue edit was discarded. You\'re hearing the saved "Rehearsal room".',
  );
  fireEvent.click(within(panel).getByRole('button', { name: 'Dismiss' }));
  expect(within(panel).queryByText(/discarded/)).toBeNull();
});

it('asks before leaving with an unsaved edit and reverts on the way out', async () => {
  const leave = vi.fn();
  // Nothing to keep: navigation goes straight through.
  await shown(state());
  leaveScreen(leave);
  expect(leave).toHaveBeenCalledTimes(1);
  cleanup();

  const edited = withBand(room, 3, { gainDb: 2 });
  await shown(editing(edited));
  act(() => leaveScreen(leave));
  const dialog = await screen.findByRole('dialog', {
    name: 'Unsaved venue edit',
  });
  expect(dialog).toHaveTextContent(
    "“Rehearsal room” has changes you haven't saved. You're hearing them now.",
  );
  fireEvent.click(within(dialog).getByRole('button', { name: 'Keep editing' }));
  expect(leave).toHaveBeenCalledTimes(1);
  act(() => leaveScreen(leave));
  vi.mocked(venueCommand).mockResolvedValueOnce(state({ revision: 5 }));
  fireEvent.click(
    within(await screen.findByRole('dialog')).getByRole('button', {
      name: 'Revert and leave',
    }),
  );
  await waitFor(() => expect(leave).toHaveBeenCalledTimes(2));
  expect(vi.mocked(venueCommand).mock.calls[0]![0]).toEqual({
    expectedRevision: 4,
    command: { kind: 'revert' },
  });
});

it('saves as a new profile with a name and notes', async () => {
  const panel = await shown(editing(withBand(room, 3, { gainDb: 2 })));
  fireEvent.click(within(panel).getByRole('button', { name: 'Save as…' }));
  const dialog = await screen.findByRole('dialog', {
    name: 'Save venue profile as',
  });
  const name = within(dialog).getByRole('textbox', { name: 'Name' });
  expect(name).toHaveValue('Rehearsal room 2');
  fireEvent.change(name, { target: { value: 'Blue Note stage' } });
  vi.mocked(venueCommand).mockRejectedValueOnce(
    new DeviceError('Profile names are 1–60 characters', 'invalid', 422),
  );
  fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
  expect(await within(dialog).findByRole('alert')).toHaveTextContent(
    'Profile names are 1–60 characters.',
  );
  vi.mocked(venueCommand).mockResolvedValueOnce(state({ revision: 6 }));
  fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(vi.mocked(venueCommand).mock.calls[1]![0].command).toEqual({
    kind: 'save_as',
    name: 'Blue Note stage',
    notes: 'Boomy corner',
  });
});

it('keeps an unsaved edit alive every minute while open', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    await shown(editing(withBand(room, 3, { gainDb: 2 })));
    await act(() => vi.advanceTimersByTimeAsync(61_000));
    expect(keepVenuePreview).toHaveBeenCalledTimes(1);
  } finally {
    vi.useRealTimers();
  }
});

it('shares one venue read and one confirmed change between Settings and the dock', async () => {
  vi.mocked(venueState).mockResolvedValue(state());
  vi.mocked(venueCommand).mockResolvedValue(
    state({ revision: 4, bypass: true }),
  );
  render(
    <VenueProvider connected>
      <VenueEq connected />
      <VenueEq connected />
    </VenueProvider>,
  );
  const buttons = await screen.findAllByRole('button', { name: 'Bypass: Off' });
  expect(buttons).toHaveLength(2);
  expect(venueState).toHaveBeenCalledTimes(1);
  expect(venueCommand).not.toHaveBeenCalled();
  fireEvent.click(buttons[1]!);
  await waitFor(() =>
    expect(screen.getAllByRole('button', { name: 'Bypass: On' })).toHaveLength(
      2,
    ),
  );
  expect(venueCommand).toHaveBeenCalledTimes(1);
});
