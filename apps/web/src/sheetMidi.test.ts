import { expect, it, vi } from 'vitest';

import { publishSheetMidi, subscribeSheetMidi } from './sheetMidi';

it('delivers coalesced hardware changes to each open viewer without repeating old speed or presses', () => {
  const a = vi.fn();
  const b = vi.fn();
  const stopA = subscribeSheetMidi(a);
  const stopB = subscribeSheetMidi(b);
  const start = { seq: 4, ok: true, message: '', sheet_scroll_presses: 2 };
  const event = {
    ...start,
    seq: 8,
    sheet_scroll_presses: 4,
    sheet_speed: { seq: 7, speed: 9 },
  };
  publishSheetMidi(start, event);
  stopB();
  publishSheetMidi(event, event);
  publishSheetMidi(event, { ...event, seq: 9, ok: false });
  publishSheetMidi(event, { ...event, seq: 10, sheet_scroll_presses: 5 });
  stopA();
  expect(a.mock.calls).toEqual([
    [{ presses: 2, speed: 9 }],
    [{ presses: 1, speed: undefined }],
  ]);
  expect(b.mock.calls).toEqual([[{ presses: 2, speed: 9 }]]);
});
