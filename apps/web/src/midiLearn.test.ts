import { renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { learnMidi } from './api';
import { firstAfter, useLearnGate } from './midiLearn';

vi.mock('./api', () => ({ learnMidi: vi.fn() }));

afterEach(() => vi.resetAllMocks());

const program = (n: number) => ({ kind: 'program', channel: 1, program: n });

it('learns the first message of a burst, not the last', () => {
  const status = {
    events: 4,
    last: program(3),
    recent: [1, 2, 3, 4].map((seq) => ({ seq, message: program(seq - 1) })),
  };
  expect(firstAfter(status, 1)).toEqual(program(1));
  expect(firstAfter(status, 4)).toBeUndefined();
  expect(firstAfter(null, 0)).toBeUndefined();
  // Older workers without a log still learn from the latest message.
  expect(firstAfter({ events: 2, last: program(9) }, 1)).toEqual(program(9));
});

it('opens the device learn gate while active and always closes it', () => {
  const { rerender, unmount } = renderHook(
    ({ active }) => useLearnGate(active),
    { initialProps: { active: false } },
  );
  expect(learnMidi).not.toHaveBeenCalled();
  rerender({ active: true });
  expect(learnMidi).toHaveBeenLastCalledWith(true);
  rerender({ active: false });
  expect(learnMidi).toHaveBeenLastCalledWith(false);
  rerender({ active: true });
  unmount();
  expect(learnMidi).toHaveBeenLastCalledWith(false);
});

it('learns only from the chosen controller when several are connected', () => {
  const status = {
    events: 3,
    last: program(2),
    recent: [
      { seq: 1, message: program(0), source: 0 },
      { seq: 2, message: program(1), source: 1 },
      { seq: 3, message: program(2), source: 0 },
    ],
  };
  expect(firstAfter(status, 0, 1)).toEqual(program(1));
  expect(firstAfter(status, 0, 0)).toEqual(program(0));
  // Nothing from the second controller after seq 2: keep waiting, never borrow.
  expect(firstAfter(status, 2, 1)).toBeUndefined();
  // No source given keeps the earlier behaviour (first message from anyone).
  expect(firstAfter(status, 0)).toEqual(program(0));
});
