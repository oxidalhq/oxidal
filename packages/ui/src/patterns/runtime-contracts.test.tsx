import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { blocksOf } from '../lib/route';
import { diffRoutes } from '../lib/route-diff';
import { PracticePanel, type PracticeState } from '../widgets/practice';
import { VenueEq } from '../widgets/venue-eq';
import { VENUE_PROFILES } from '../widgets/venue-eq.data';
import { AppShell } from './app-shell';
import { SERIAL_ROUTE } from './rig.fixtures';
import { RigSurface } from './rig-surface';
import { StemWorkspace } from './stem-workspace';

beforeEach(() =>
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  ),
);
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('sends home navigation through the owner instead of bypassing its leave guard', () => {
  const navigate = vi.fn();
  render(
    <AppShell destination="library" onNavigate={navigate} readings={{}}>
      <p>Library draft</p>
    </AppShell>,
  );
  const home = screen.getByRole('link', { name: 'Oxidal home' });
  expect(fireEvent.click(home)).toBe(false);
  expect(navigate).toHaveBeenCalledExactlyOnceWith('rig');
  navigate.mockClear();
  expect(fireEvent.click(home, { ctrlKey: true })).toBe(true);
  expect(navigate).not.toHaveBeenCalled();
});

it('opening, remounting and receiving practice readback never reset playback', async () => {
  const change = vi.fn();
  const value: PracticeState = {
    position: 18,
    loop: { a: 10, b: 30 },
    looping: true,
    speed: 75,
    click: true,
    timing: 'steady',
    steady: 96,
    level: -9,
  };
  const props = { duration: 100, waveform: [], onChange: change };
  const { rerender, unmount } = render(
    <PracticePanel {...props} value={value} />,
  );
  expect(change).not.toHaveBeenCalled();
  expect(
    screen.getByRole('radio', { name: '0.75 times speed' }),
  ).toHaveAttribute('aria-checked', 'true');
  rerender(
    <PracticePanel {...props} value={{ ...value, position: 25, speed: 50 }} />,
  );
  expect(change).not.toHaveBeenCalled();
  fireEvent.keyDown(screen.getByRole('slider', { name: /Waveform/ }), {
    key: 'ArrowRight',
  });
  expect(change).toHaveBeenCalledExactlyOnceWith({
    ...value,
    position: 30,
    speed: 50,
  });
  change.mockClear();
  unmount();
  render(<PracticePanel {...props} value={value} />);
  expect(change).not.toHaveBeenCalled();
});

it('Venue EQ reads the active profile without applying the first profile on mount or remote updates', async () => {
  const change = vi.fn();
  const hear = vi.fn();
  const profiles = vi.fn();
  const value = {
    profile: 'friday',
    eq: VENUE_PROFILES[2]!.eq,
    bypass: false,
    compare: false,
  };
  const { rerender } = render(
    <VenueEq
      profiles={VENUE_PROFILES}
      value={value}
      onChange={change}
      onHear={hear}
      onProfiles={profiles}
    />,
  );
  expect(hear).not.toHaveBeenCalled();
  expect(profiles).not.toHaveBeenCalled();
  rerender(
    <VenueEq
      profiles={VENUE_PROFILES}
      value={{ ...value, bypass: true }}
      onChange={change}
      onHear={hear}
      onProfiles={profiles}
    />,
  );
  expect(hear).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Bypassed' }));
  expect(change).toHaveBeenCalledExactlyOnceWith(value);
  expect(hear).toHaveBeenCalledExactlyOnceWith(value.eq);
});

it('empty profile collections render without issuing a command', () => {
  const hear = vi.fn();
  render(<VenueEq profiles={[]} onHear={hear} />);
  expect(screen.getByText('No venue profile')).toBeVisible();
  expect(hear).not.toHaveBeenCalled();
});

it('renames, duplicates and deletes profiles without silently changing the output', async () => {
  const hear = vi.fn();
  const profiles = vi.fn();
  const user = userEvent.setup();
  render(
    <VenueEq
      profiles={[VENUE_PROFILES[2]!, VENUE_PROFILES[0]!]}
      onHear={hear}
      onProfiles={profiles}
    />,
  );
  await user.click(
    screen.getByRole('button', { name: 'More for this profile' }),
  );
  await user.click(screen.getByRole('menuitem', { name: 'Rename…' }));
  await user.clear(screen.getByRole('textbox', { name: 'Profile name' }));
  await user.type(
    screen.getByRole('textbox', { name: 'Profile name' }),
    'Practice room',
  );
  await user.click(screen.getByRole('button', { name: 'Save profile' }));
  expect(profiles).toHaveBeenLastCalledWith(
    expect.arrayContaining([
      expect.objectContaining({ id: 'friday', name: 'Practice room' }),
    ]),
  );
  await user.click(
    screen.getByRole('button', { name: 'More for this profile' }),
  );
  await user.click(screen.getByRole('menuitem', { name: 'Duplicate' }));
  await user.click(screen.getByRole('button', { name: 'Save profile' }));
  expect(profiles.mock.calls.at(-1)![0]).toHaveLength(3);
  await user.click(
    screen.getByRole('button', { name: 'More for this profile' }),
  );
  await user.click(screen.getByRole('menuitem', { name: 'Delete…' }));
  await user.click(screen.getByRole('button', { name: 'Delete profile' }));
  expect(profiles.mock.calls.at(-1)![0]).toHaveLength(2);
  expect(screen.getByText(/Current output settings are kept/)).toBeVisible();
  expect(screen.getByRole('combobox', { name: 'Venue profile' })).toBeEnabled();
  expect(hear).not.toHaveBeenCalled();
});

it('mix undo and redo change the audible mix, not only the drawing', async () => {
  const onMix = vi.fn();
  const a = { guitar: { level: 0, muted: false, solo: false } };
  const b = { guitar: { level: -12, muted: true, solo: false } };
  render(
    <StemWorkspace
      song={{ name: 'Song', length: '1:00' }}
      split={{ state: 'ready', count: 1 }}
      starts={[
        { id: 'all', name: 'All', mix: a },
        { id: 'less', name: 'Less', mix: b },
      ]}
      saved={[]}
      onMix={onMix}
      onSplit={() => {}}
      onSave={() => {}}
      onLink={() => {}}
      onImport={() => {}}
      onConfirmImport={() => {}}
      onCancelImport={() => {}}
    />,
  );
  expect(onMix).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('radio', { name: 'Less' }));
  expect(onMix).toHaveBeenLastCalledWith(b);
  await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
  expect(onMix).toHaveBeenLastCalledWith(a);
  await userEvent.click(screen.getByRole('button', { name: 'Redo' }));
  expect(onMix).toHaveBeenLastCalledWith(b);
});

it('detects equal-valued model swaps and nested branch gain changes', () => {
  const block = {
    ...blocksOf(SERIAL_ROUTE)[0]!,
    source: { value: 'original', options: [] },
  };
  const saved = [
    { split: true as const, id: 's', branches: [[block], []], levels: [0, -6] },
  ];
  const edited = [
    {
      ...saved[0]!,
      branches: [
        [{ ...block, source: { value: 'new-model', options: [] } }],
        [],
      ],
      levels: [0, -12],
    },
  ];
  expect(diffRoutes(saved, edited).map((c) => c.kind)).toEqual([
    'model',
    'branches',
  ]);
});

it('comparison waits for device readback and whole discard uses its product command', async () => {
  const onCompare = vi.fn();
  const onDiscard = vi.fn();
  const onRoute = vi.fn();
  const onTuner = vi.fn();
  render(
    <RigSurface
      presetName="Test"
      route={SERIAL_ROUTE}
      saved={SERIAL_ROUTE}
      changeList={[{ kind: 'settings', text: 'Scene settings changed' }]}
      comparison="edited"
      onCompare={onCompare}
      onDiscard={onDiscard}
      onTuner={onTuner}
      onRoute={onRoute}
      versions={[{ id: 'v', name: 'Default' }]}
      currentVersion="v"
      onVersion={() => {}}
      onSaveVersion={() => {}}
      onSaveVersionAs={() => {}}
      onMakeDefault={() => {}}
      scenes={[]}
      activeScene={null}
      onScene={() => {}}
    />,
  );
  await userEvent.click(screen.getByRole('radio', { name: 'Saved' }));
  expect(onCompare).toHaveBeenCalledExactlyOnceWith('saved');
  expect(screen.queryByText('Hearing the saved version')).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Tuner' }));
  expect(onTuner).toHaveBeenCalledOnce();
  await userEvent.click(screen.getByRole('button', { name: /Default/ }));
  await userEvent.click(
    screen.getByRole('button', { name: 'Discard 1 change' }),
  );
  expect(onDiscard).toHaveBeenCalledOnce();
  expect(onRoute).not.toHaveBeenCalled();
});
