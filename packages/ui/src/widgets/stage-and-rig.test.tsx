import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';

import { diffRoutes } from '../lib/route-diff';
import { tempoFromTaps } from '../lib/tempo';
import { SERIAL_ROUTE } from '../patterns/rig.fixtures';
import type { BlockModel } from './block-editor';
import { CONTROLLERS } from './controllers';
import { Footswitches, type StageState } from './footswitches';
import { RouteView } from './route-view';
import { ChangeList, VersionPicker } from './versions';
import { VisualControl } from './visual-control';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const STATE: StageState = {
  scene: 'a',
  scenes: [
    { id: 'a', name: 'Clean' },
    { id: 'b', name: 'Crunch' },
  ],
  blocks: { echo: { label: 'Echo', on: false } },
  boost: false,
  tuner: false,
  playing: false,
  loop: false,
  bpm: 96,
};

it('footswitches show the tap and hold actions and fire them', () => {
  vi.useFakeTimers();
  const action = vi.fn();
  render(
    <Footswitches profile={CONTROLLERS[0]!} state={STATE} onAction={action} />,
  );
  const a = screen.getByRole('button', {
    name: 'A Clean Hold · Boost',
  });
  expect(a).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(screen.getByRole('button', { name: /^B Crunch/ }));
  expect(action).toHaveBeenLastCalledWith({ kind: 'scene', scene: 'b' });
  const c = screen.getByRole('button', {
    name: 'C Previous Hold · Tuner',
  });
  fireEvent.pointerDown(c);
  act(() => {
    vi.advanceTimersByTime(500);
  });
  fireEvent.pointerUp(c);
  fireEvent.click(c);
  expect(action).toHaveBeenLastCalledWith({ kind: 'tuner' });
  expect(action).not.toHaveBeenCalledWith({ kind: 'previous' });
});

it('every controller profile draws one tile per switch', () => {
  for (const profile of CONTROLLERS) {
    const { unmount } = render(
      <Footswitches profile={profile} state={STATE} onAction={() => {}} />,
    );
    expect(
      screen.getAllByRole('button', { name: /^[A-Z0-9▲▼] / }),
    ).toHaveLength(profile.switches.length);
    unmount();
  }
});

it('works out a tempo from taps', () => {
  expect(tempoFromTaps([0])).toBeNull();
  expect(tempoFromTaps([0, 500, 1000, 1500])).toBe(120);
  expect(tempoFromTaps([0, 625, 1250])).toBe(96);
});

it('lists what changed since the version was saved and undoes one change', async () => {
  const user = userEvent.setup();
  const edited = SERIAL_ROUTE.map((s) => {
    const b = s as BlockModel;
    if (b.id === 'echo')
      return {
        ...b,
        on: true,
        controls: b.controls.map((c) =>
          c.id === 'mix' ? { ...c, value: 40 } : c,
        ),
      };
    return b;
  });
  const changes = diffRoutes(SERIAL_ROUTE as BlockModel[], edited);
  expect(changes.map((c) => c.kind)).toEqual(['bypass', 'value']);
  const revert = vi.fn();
  render(<ChangeList changes={changes} onRevert={revert} />);
  expect(screen.getByText('Echo · Mix 25 % → 40 %')).toBeVisible();
  await user.click(screen.getByRole('button', { name: /Undo: Echo · Mix/ }));
  expect(revert).toHaveBeenCalledWith(
    expect.objectContaining({ control: 'mix', from: 25 }),
  );
});

it('saves an edit as a new named version', async () => {
  const user = userEvent.setup();
  const saveAs = vi.fn();
  render(
    <VersionPicker
      presetName="Rhythm section"
      versions={[{ id: 'default', name: 'Default', isDefault: true }]}
      current="default"
      changes={2}
      onSelect={() => {}}
      onSave={() => {}}
      onSaveAs={saveAs}
      onMakeDefault={() => {}}
      onDiscard={() => {}}
    />,
  );
  await user.click(screen.getByRole('button', { name: /Default/ }));
  await user.click(
    screen.getByRole('button', { name: 'Save as a new version…' }),
  );
  await user.click(screen.getByRole('button', { name: 'Friday gig' }));
  await user.click(screen.getByRole('button', { name: 'Save version' }));
  expect(saveAs).toHaveBeenCalledWith('Friday gig');
});

it('the drawing is a slider for the keyboard', async () => {
  const user = userEvent.setup();
  const onControl = vi.fn();
  const echo = SERIAL_ROUTE.find(
    (s) => (s as BlockModel).id === 'echo',
  ) as BlockModel;
  render(
    <VisualControl
      kind={echo.kind}
      role={echo.role}
      controls={echo.controls}
      onControl={onControl}
    />,
  );
  const handle = screen.getByRole('slider', { name: 'Time and feedback' });
  handle.focus();
  await user.keyboard('{ArrowUp}');
  expect(onControl).toHaveBeenCalledWith('feedback', expect.any(Number));
  expect(onControl.mock.calls.at(-1)![1]).toBeGreaterThan(35);
});

it('holding a block hears the rig without it, and a short tap selects', () => {
  vi.useFakeTimers();
  const audition = vi.fn();
  const select = vi.fn();
  render(
    <RouteView
      route={SERIAL_ROUTE}
      onChange={() => {}}
      onSelect={select}
      onAudition={audition}
      orientation="horizontal"
    />,
  );
  const echo = screen.getByRole('button', { name: /^Echo .* Off/ });
  fireEvent.pointerDown(echo);
  act(() => {
    vi.advanceTimersByTime(400);
  });
  expect(audition).toHaveBeenLastCalledWith('echo');
  fireEvent.pointerUp(echo);
  fireEvent.click(echo);
  expect(audition).toHaveBeenLastCalledWith(null);
  expect(select).not.toHaveBeenCalled();
  const amp = screen.getByRole('button', { name: /Plexi 50/ });
  fireEvent.pointerDown(amp);
  fireEvent.pointerUp(amp);
  fireEvent.click(amp);
  expect(select).toHaveBeenCalledWith('amp');
});
