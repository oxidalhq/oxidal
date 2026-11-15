import { expect, it } from 'vitest';
import type { PlayerSnapshot } from '../api';
import {
  clock,
  formatTime,
  positionAt,
  spokenTime,
  tapTempo,
} from './playerClock';

const snapshot = (
  state: PlayerSnapshot['state'],
  frame: number,
  repeat = false,
): PlayerSnapshot => ({
  state,
  frame,
  repeat,
  levelDb: -6,
  order: ['t1'],
  revision: 1,
  underruns: 0,
  track: {
    id: 't1',
    title: 'Rehearsal 01',
    frames: 48000 * 222,
    rate: 48000,
    channels: 2,
    trimDb: -6,
  },
});

it('advances a playing track locally from the snapshot frame', () => {
  const player = snapshot('playing', 48000 * 72);
  expect(positionAt(player, 1000, 1000)).toBe(72);
  expect(positionAt(player, 1000, 3500)).toBeCloseTo(74.5);
});

it('holds a paused or ready track where the device says', () => {
  expect(positionAt(snapshot('paused', 48000 * 72), 0, 99_000)).toBe(72);
  expect(positionAt(snapshot('ready', 0), 0, 99_000)).toBe(0);
});

it('stops at the end, or wraps with Repeat Track', () => {
  const late = snapshot('playing', 48000 * 220);
  expect(positionAt(late, 0, 10_000)).toBe(222);
  expect(positionAt(snapshot('playing', 48000 * 220, true), 0, 10_000)).toBe(8);
  expect(positionAt(snapshot('ended', 0), 0, 0)).toBe(222);
  expect(positionAt(null, 0, 0)).toBe(0);
});

it('formats and speaks times', () => {
  expect(formatTime(72.9)).toBe('1:12');
  expect(formatTime(-3)).toBe('0:00');
  expect(spokenTime(222)).toBe('3 minutes 42');
  expect(spokenTime(61)).toBe('1 minute 1');
});

it('shows loop points to a tenth of a second and taps a tempo', () => {
  expect(clock(83.44)).toBe('1:23.4');
  expect(clock(5.2)).toBe('0:05.2');
  expect(tapTempo([0])).toBeNull();
  expect(tapTempo([0, 500, 1000, 1500])).toBe(120);
  // A long pause starts a new count.
  expect(tapTempo([0, 500, 4000, 4545])).toBe(110.1);
});
