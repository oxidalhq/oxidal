import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';

import { formatTime } from '../lib/time';
import { Chain } from './chain';
import { Meter } from './meter';
import { PresetStepper } from './preset-step';
import { ScenePads } from './scene-pad';
import { PositionBar } from './transport';
import { TunerFace } from './tuner-face';

afterEach(cleanup);

const LANES = [
  {
    id: 'main',
    blocks: [
      { id: 'a', label: 'TS9', kind: 'pedal' as const, on: true },
      { id: 'b', label: 'Plexi', kind: 'amp' as const, on: false },
    ],
  },
];

it('a meter reports its level and says when it is stopped or unavailable', () => {
  const { rerender } = render(<Meter label="Output" value={-6.5} />);
  const meter = screen.getByRole('meter', { name: 'Output' });
  expect(meter).toHaveAttribute('aria-valuenow', '-6.5');
  expect(meter).toHaveAttribute('aria-valuetext', '-6.5 dB');
  rerender(<Meter label="Output" value={null} state="stopped" />);
  expect(meter).toHaveAttribute('aria-valuetext', 'Stopped');
  rerender(<Meter label="Output" value={null} state="unavailable" />);
  expect(meter).toHaveAttribute('aria-valuetext', '—');
});

it('scene pads select on tap and open the menu on a long press', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  const select = vi.fn();
  const menu = vi.fn();
  render(
    <ScenePads
      scenes={[
        { id: 'a', name: 'Clean' },
        { id: 'b', name: 'Crunch' },
      ]}
      active="a"
      onSelect={select}
      onMenu={menu}
    />,
  );
  await user.click(screen.getByRole('button', { name: 'Scene 2 Crunch' }));
  expect(select).toHaveBeenCalledWith('b');
  const pad = screen.getByRole('button', { name: 'Scene 1 Clean' });
  await user.pointer({ keys: '[MouseLeft>]', target: pad });
  vi.advanceTimersByTime(500);
  await user.pointer({ keys: '[/MouseLeft]', target: pad });
  expect(menu).toHaveBeenCalledWith('a');
  vi.useRealTimers();
});

it('the preset stepper disables the end it cannot pass', () => {
  render(
    <PresetStepper
      name="Lead"
      position={3}
      count={3}
      onPrevious={() => {}}
      onNext={() => {}}
    />,
  );
  expect(screen.getByRole('button', { name: 'Previous preset' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Next preset' })).toBeDisabled();
});

it('the position bar seeks with the arrow keys and formats times', async () => {
  const user = userEvent.setup();
  const seek = vi.fn();
  render(<PositionBar position={60} duration={200} onSeek={seek} />);
  const bar = screen.getByRole('slider', { name: 'Position' });
  expect(bar).toHaveAttribute('aria-valuetext', '1:00 of 3:20');
  bar.focus();
  await user.keyboard('{ArrowRight}');
  expect(seek).toHaveBeenCalledWith(65);
  expect(formatTime(0)).toBe('0:00');
  expect(formatTime(3725)).toBe('62:05');
});

it('the tuner names the note and says when it is in tune', () => {
  const { rerender } = render(<TunerFace note={69} cents={1.2} />);
  expect(screen.getByRole('status')).toHaveAccessibleName(
    'A4, +1 cents, in tune',
  );
  rerender(<TunerFace note={64} cents={-20} />);
  expect(screen.getByRole('status')).toHaveAccessibleName('E4, -20 cents');
  rerender(<TunerFace note={null} cents={0} />);
  expect(screen.getByRole('status')).toHaveAccessibleName('Tuner: no note');
});

it('the chain names bypassed blocks, selects on click and moves with Shift+arrows when editing', async () => {
  const user = userEvent.setup();
  const select = vi.fn();
  const move = vi.fn();
  render(
    <Chain
      lanes={LANES}
      selected="a"
      onSelect={select}
      editing
      onMove={move}
      onAdd={() => {}}
    />,
  );
  await user.click(screen.getByRole('button', { name: /^Plexi .*Off/ }));
  expect(select).toHaveBeenCalledWith('b');
  screen.getByRole('button', { name: /^TS9/ }).focus();
  await user.keyboard('{Shift>}{ArrowRight}{/Shift}');
  expect(move).toHaveBeenCalledWith('a', 0, 2);
  expect(
    screen.getAllByRole('button', { name: /Add block at position/ }),
  ).toHaveLength(3);
});
