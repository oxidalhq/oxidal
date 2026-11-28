import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import {
  keepReady,
  libraryCatalog,
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
  libraryCatalog: vi.fn(async (update?: { action?: { kind: string } }) => ({
    revision: 'c',
    starter_offered: true,
    ...(update?.action?.kind === 'duplicate'
      ? { created: { kind: 'rig', id: 'f'.repeat(64) } }
      : {}),
    items: [
      {
        kind: 'rig',
        id: 'a'.repeat(64),
        name: 'My lead',
        source_name: 'My lead',
        archived: false,
        origin: 'mine',
        in_set_list: update?.action?.kind !== 'set_list',
      },
      {
        kind: 'rig',
        id: 'f'.repeat(64),
        name: 'My lead copy',
        source_name: 'My lead copy',
        archived: false,
        origin: 'mine',
        in_set_list: false,
      },
    ],
  })),
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
  // Playing + one confirmed alternative; the failed one is not Ready. The
  // count is Keep ready's title, and shows in full when it is open.
  await waitFor(() =>
    expect(screen.getByRole('button', { name: /^Keep ready/ })).toHaveAttribute(
      'title',
      '2 of 5 presets ready',
    ),
  );
  expect(screen.getAllByText('Ready')).toHaveLength(1);
  expect(screen.getAllByText('Not ready yet')).toHaveLength(2);
  expect(screen.getByText('Unsaved')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: /^Keep ready/ }));
  expect(screen.getByText('2 of 5 presets ready')).toBeVisible();
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

it('shows one action menu for a Mine row and the empty state when nothing is saved', async () => {
  vi.mocked(rigLibrary).mockResolvedValue({
    presets: [
      {
        revision: revisions[0]!,
        name: 'My lead',
        origin: 'mine',
        scenes: ['Clean'],
        topology: 'scenes',
        native_instances: 0,
        lv2_instances: 0,
      },
    ],
    next: null,
  } as never);
  const manage = vi.fn();
  const view = render(
    <SavedRigs
      connected
      onOpenRig={() => {}}
      onEdit={() => {}}
      onManage={manage}
    />,
  );
  await userEvent.click(
    await screen.findByRole('button', { name: 'More for My lead' }),
  );
  expect(
    screen.getAllByRole('menuitem').map((item) => item.textContent),
  ).toEqual([
    'Edit',
    'Duplicate',
    'Remove from set list',
    'MIDI',
    'Rename',
    'Delete…',
  ]);
  fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));
  expect(manage).toHaveBeenCalledWith('rename', {
    kind: 'rig',
    id: revisions[0],
    name: 'My lead',
  });
  view.unmount();
  vi.mocked(rigLibrary).mockResolvedValue({ presets: [], next: null } as never);
  render(
    <SavedRigs connected onOpenRig={() => {}} empty={<p>No presets yet</p>} />,
  );
  expect(await screen.findByText('No presets yet')).toBeVisible();
});

it('Duplicate makes "Name copy" in Mine, outside the set list, and opens it stopped', async () => {
  vi.mocked(rigLibrary).mockResolvedValue({
    presets: [
      {
        revision: revisions[0]!,
        name: 'My lead',
        origin: 'mine',
        scenes: ['Clean'],
        topology: 'scenes',
        native_instances: 0,
        lv2_instances: 0,
      },
    ],
    next: null,
  } as never);
  const edit = vi.fn();
  render(<SavedRigs connected onOpenRig={() => {}} onEdit={edit} />);
  await userEvent.click(
    await screen.findByRole('button', { name: 'More for My lead' }),
  );
  await waitFor(() =>
    expect(
      screen.getByRole('menuitem', { name: 'Remove from set list' }),
    ).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole('menuitem', { name: 'Duplicate' }));
  expect(
    await screen.findByText(
      '"My lead copy" is in Mine. It is not in the set list.',
    ),
  ).toBeInTheDocument();
  expect(libraryCatalog).toHaveBeenCalledWith({
    expected_revision: 'c',
    entry_kind: 'rig',
    id: revisions[0],
    action: { kind: 'duplicate' },
  });
  expect(edit).toHaveBeenCalledWith('f'.repeat(64), 'My lead copy');
  expect(rigAudioCommand).not.toHaveBeenCalled();
});

it('shows set list position on Mine rows and lets extra rows join the set list', async () => {
  vi.mocked(rigLibrary).mockResolvedValue({
    presets: [
      {
        revision: revisions[0]!,
        name: 'My lead',
        origin: 'mine',
        scenes: ['Clean'],
        topology: 'scenes',
        native_instances: 0,
        lv2_instances: 0,
      },
      {
        revision: revisions[1]!,
        name: 'My rhythm',
        origin: 'mine',
        scenes: ['Clean'],
        topology: 'scenes',
        native_instances: 0,
        lv2_instances: 0,
      },
    ],
    next: null,
  } as never);
  render(
    <SavedRigs
      connected
      onOpenRig={() => {}}
      owned={[
        {
          id: 'chain-1',
          name: 'Chain',
          caption: 'TONE3000 chain',
          actions: () => [],
          onDetails: () => {},
          render: (setList) => (
            <li>
              <span>
                {setList.badge('chain-1')?.text ??
                  (setList.isMember('chain-1') === false
                    ? 'Outside the set list'
                    : 'unknown')}
              </span>
              <button
                type="button"
                onClick={() => setList.toggle('chain-1', 'Chain', true)}
              >
                Join
              </button>
            </li>
          ),
        },
      ]}
    />,
  );
  expect(await screen.findByText(/In set list #1/)).toBeInTheDocument();
  // Only members carry a chip: the rhythm row has none, and the extra row
  // knows it is outside the set list.
  expect(screen.getAllByText(/In set list #/)).toHaveLength(1);
  expect(screen.getByText('Outside the set list')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Join' }));
  await waitFor(() =>
    expect(libraryCatalog).toHaveBeenCalledWith(
      expect.objectContaining({
        entry_kind: 'owned',
        id: 'chain-1',
        action: { kind: 'set_list', member: true },
      }),
    ),
  );
});

it('returns focus to Mine search after clearing a query', async () => {
  render(
    <SavedRigs
      connected
      onOpenRig={() => {}}
      origin="oxidal_example"
      title="Presets"
    />,
  );
  await screen.findByText('Factory 1');
  const search = screen.getByRole('searchbox', { name: 'Search presets' });
  fireEvent.change(search, { target: { value: 'no-such-sound' } });
  expect(screen.getByText(/Nothing matches/)).toBeVisible();
  const clear = screen.getByRole('button', { name: 'Clear preset search' });
  clear.focus();
  fireEvent.click(clear);
  expect(search).toHaveFocus();
  expect(screen.getByText('Factory 1')).toBeVisible();
});

it('sorts the full paged Library by device addition date and leaves older undated rows last', async () => {
  const row = (revision: string, name: string) => ({
    revision,
    name,
    origin: 'mine',
    scenes: [],
    topology: 'serial',
    native_instances: 0,
    lv2_instances: 0,
  });
  vi.mocked(rigLibrary)
    .mockResolvedValueOnce({
      presets: [row(revisions[0]!, 'A unknown'), row(revisions[1]!, 'B older')],
      next: 'second',
    } as never)
    .mockResolvedValueOnce({
      presets: [row(revisions[2]!, 'C newest')],
      next: null,
    } as never);
  vi.mocked(libraryCatalog).mockResolvedValueOnce({
    revision: 'catalog',
    items: [],
    added_at: { [`rig:${revisions[1]}`]: 10, [`rig:${revisions[2]}`]: 20 },
  } as never);
  render(<SavedRigs connected onOpenRig={() => {}} />);
  await screen.findByText('A unknown');
  await userEvent.click(screen.getByRole('button', { name: /Library order/ }));
  await userEvent.click(
    screen.getByRole('menuitemcheckbox', { name: 'Newest' }),
  );
  const newest = await screen.findByText('C newest');
  const older = screen.getByText('B older');
  const unknown = screen.getByText('A unknown');
  expect(
    newest.compareDocumentPosition(older) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(
    older.compareDocumentPosition(unknown) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(rigAudioCommand).not.toHaveBeenCalled();
});

it('on a wide screen shows the chosen preset beside the list with the menu actions and its chain', async () => {
  // Pretend the window is 1440 px wide: only the 80rem query matches.
  vi.stubGlobal(
    'matchMedia',
    (query: string) =>
      ({
        matches: query === '(min-width: 80rem)',
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }) as unknown as MediaQueryList,
  );
  vi.mocked(rigLibrary).mockResolvedValue({
    presets: [
      {
        revision: revisions[0]!,
        name: 'My lead',
        origin: 'mine',
        scenes: ['Clean', 'Lead'],
        topology: 'scenes',
        native_instances: 2,
        lv2_instances: 0,
        blocks: [{ kind: 'tone3000' }, { kind: 'tone3000' }],
      },
      {
        revision: revisions[1]!,
        name: 'My rhythm',
        origin: 'mine',
        scenes: [],
        topology: 'serial',
        native_instances: 1,
        lv2_instances: 0,
      },
    ],
    next: null,
  } as never);
  const details = vi.fn();
  const manage = vi.fn();
  try {
    render(
      <SavedRigs
        connected
        onOpenRig={() => {}}
        onDetails={details}
        onManage={manage}
        onEdit={() => {}}
      />,
    );
    const panel = await screen.findByRole('complementary', {
      name: 'Preset details',
    });
    // The first row is shown at first; its chain strip and set list chip draw.
    expect(
      await screen.findByRole('heading', { name: 'My lead' }),
    ).toBeVisible();
    expect(await screen.findByText('In set list #1')).toBeVisible();
    expect(panel).toHaveTextContent('Clean, Lead');
    expect(panel.querySelectorAll('[data-slot=led]')).toHaveLength(2);
    // Rows leave their ⋯ out: the panel carries the same actions.
    expect(
      screen.queryByRole('button', { name: 'More for My lead' }),
    ).toBeNull();
    for (const name of [
      'Remove from set list',
      'Duplicate',
      'Rename',
      'MIDI',
      'Details…',
      'Edit',
      'Delete…',
    ])
      expect(
        screen.getByRole('button', { name: new RegExp(`^${name}`) }),
      ).toBeVisible();
    // Choosing the other row's body shows it; nothing plays.
    fireEvent.click(
      screen.getByRole('button', { name: /^Details:\s*My rhythm/ }),
    );
    expect(
      await screen.findByRole('heading', { name: 'My rhythm' }),
    ).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: /^Delete…/ }));
    expect(manage).toHaveBeenCalledWith('delete', {
      kind: 'rig',
      id: revisions[1],
      name: 'My rhythm',
    });
    fireEvent.click(screen.getByRole('button', { name: /^Details…/ }));
    expect(details).toHaveBeenCalledWith(revisions[1], 'My rhythm');
    expect(rigAudioCommand).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
  }
});
