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
