import { describe, expect, it } from 'vitest';

import { applyTogether } from './pathSides';

/** A pretend rig: control values by side, and which sets fail. */
function rig(failing: (side: string, value: number) => boolean) {
  const values: Record<string, number> = { left: 1, right: 1 };
  const sent: [string, number][] = [];
  return {
    values,
    sent,
    read: (side: string) => values[side],
    set: (side: string, value: number) => {
      sent.push([side, value]);
      if (failing(side, value)) return Promise.resolve(false);
      values[side] = value;
      return Promise.resolve(true);
    },
  };
}

describe('a path change sets both sides or neither', () => {
  it('applies a pan to both sides', async () => {
    const r = rig(() => false);
    const pan: [string, number][] = [
      ['left', 1],
      ['right', 0.4],
    ];
    expect(await applyTogether(pan, r.read, r.set)).toBe('applied');
    expect(r.values).toEqual({ left: 1, right: 0.4 });
  });

  it('puts the first side back when the second fails', async () => {
    const r = rig((side) => side === 'right');
    const pan: [string, number][] = [
      ['left', 0.2],
      ['right', 1],
    ];
    expect(await applyTogether(pan, r.read, r.set)).toBe('restored');
    expect(r.values).toEqual({ left: 1, right: 1 });
    expect(r.sent).toEqual([
      ['left', 0.2],
      ['right', 1],
      ['left', 1],
    ]);
  });

  it('changes nothing when the first side fails', async () => {
    const r = rig((side) => side === 'left');
    const pan: [string, number][] = [
      ['left', 0.2],
      ['right', 1],
    ];
    expect(await applyTogether(pan, r.read, r.set)).toBe('failed');
    expect(r.values).toEqual({ left: 1, right: 1 });
    expect(r.sent).toHaveLength(1);
  });

  it('says so when a side cannot be put back', async () => {
    // The rig refuses everything after the first command.
    let calls = 0;
    const r = rig(() => ++calls > 1);
    const pan: [string, number][] = [
      ['left', 0.2],
      ['right', 1],
    ];
    expect(await applyTogether(pan, r.read, r.set)).toBe('partial');
    expect(r.values.left).toBe(0.2);
  });

  it('keeps polarity: an inverted pair goes through as one change', async () => {
    const r = rig(() => false);
    const inverted: [string, number][] = [
      ['left', -0.5],
      ['right', -0.5],
    ];
    expect(await applyTogether(inverted, r.read, r.set)).toBe('applied');
    expect(r.values).toEqual({ left: -0.5, right: -0.5 });
  });
});
