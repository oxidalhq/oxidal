import { afterEach, describe, expect, it } from 'vitest';

import {
  afterStep,
  HISTORY_LIMIT,
  historyShortcut,
  historyTarget,
  parseHistory,
  recordEdit,
  typingIn,
} from './rigHistory';

const edit = (from: string, to: string, preset = 'p') => ({ preset, from, to });

describe('rig history', () => {
  it('records edits of one preset and steps back and forth through them', () => {
    let h = recordEdit(null, edit('r1', 'r2'), true);
    h = recordEdit(h, edit('r2', 'r3'), true);
    expect(h).toEqual({ preset: 'p', revisions: ['r1', 'r2', 'r3'], at: 2 });
    expect(historyTarget(h, 'r3', -1)).toBe('r2');
    expect(historyTarget(h, 'r3', 1)).toBeNull();
    // Undo republished r2 as the same revision.
    h = afterStep(h, -1, 'r2');
    expect(h.at).toBe(1);
    expect(historyTarget(h, 'r2', -1)).toBe('r1');
    expect(historyTarget(h, 'r2', 1)).toBe('r3');
    // A re-encoded manifest gives a new revision that takes r1's place.
    h = afterStep(h, -1, 'r1b');
    expect(h).toEqual({ preset: 'p', revisions: ['r1b', 'r2', 'r3'], at: 0 });
    expect(historyTarget(h, 'r1b', -1)).toBeNull();
    expect(historyTarget(h, 'r1b', 1)).toBe('r2');
  });

  it('drops what Redo could bring back once a new edit is made', () => {
    let h = recordEdit(null, edit('r1', 'r2'), true);
    h = recordEdit(h, edit('r2', 'r3'), true);
    h = afterStep(h, -1, 'r2');
    h = recordEdit(h, edit('r2', 'r4'), true);
    expect(h).toEqual({ preset: 'p', revisions: ['r1', 'r2', 'r4'], at: 2 });
    expect(historyTarget(h, 'r4', 1)).toBeNull();
  });

  it('starts again for another preset, an edit elsewhere or a copy', () => {
    const h = recordEdit(null, edit('r1', 'r2'), true);
    // Another preset.
    expect(recordEdit(h, edit('q1', 'q2', 'q'), true)).toEqual({
      preset: 'q',
      revisions: ['q1', 'q2'],
      at: 1,
    });
    // The same preset, edited from a revision this history does not hold.
    expect(recordEdit(h, edit('rX', 'r3'), true).revisions).toEqual([
      'rX',
      'r3',
    ]);
    // The first edit of an Oxidal sound makes a copy: nothing to undo.
    const copy = recordEdit(h, edit('sound', 'copy', 'c'), false);
    expect(copy).toEqual({ preset: 'c', revisions: ['copy'], at: 0 });
    expect(historyTarget(copy, 'copy', -1)).toBeNull();
  });

  it('offers nothing while another revision is playing', () => {
    const h = recordEdit(null, edit('r1', 'r2'), true);
    expect(historyTarget(h, 'other', -1)).toBeNull();
    expect(historyTarget(h, undefined, -1)).toBeNull();
    expect(historyTarget(null, 'r2', -1)).toBeNull();
  });

  it('ignores a publish that changed nothing and keeps at most the limit', () => {
    let h = recordEdit(null, edit('r1', 'r2'), true);
    expect(recordEdit(h, edit('r2', 'r2'), true)).toEqual(h);
    for (let n = 3; n < HISTORY_LIMIT + 10; n++)
      h = recordEdit(h, edit(`r${n - 1}`, `r${n}`), true);
    expect(h.revisions).toHaveLength(HISTORY_LIMIT);
    expect(h.at).toBe(HISTORY_LIMIT - 1);
    expect(h.revisions.at(-1)).toBe(`r${HISTORY_LIMIT + 9}`);
  });

  it('reads back only a well-formed history', () => {
    const h = { preset: 'p', revisions: ['a', 'b'], at: 1 };
    expect(parseHistory(h)).toEqual(h);
    expect(parseHistory(null)).toBeNull();
    expect(parseHistory({ ...h, at: 2 })).toBeNull();
    expect(parseHistory({ ...h, at: 0.5 })).toBeNull();
    expect(parseHistory({ ...h, revisions: [] })).toBeNull();
    expect(parseHistory({ ...h, revisions: [1] })).toBeNull();
  });
});

describe('Undo and Redo keys', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });
  const press = (
    key: string,
    keys: { meta?: boolean; ctrl?: boolean; shift?: boolean; alt?: boolean },
    target: EventTarget | null = document.body,
  ) =>
    historyShortcut({
      key,
      metaKey: !!keys.meta,
      ctrlKey: !!keys.ctrl,
      shiftKey: !!keys.shift,
      altKey: !!keys.alt,
      target,
      defaultPrevented: false,
      isComposing: false,
    });

  it('maps Cmd/Ctrl+Z to Undo and Shift+Cmd/Ctrl+Z or Ctrl+Y to Redo', () => {
    expect(press('z', { meta: true })).toBe('undo');
    expect(press('z', { ctrl: true })).toBe('undo');
    expect(press('Z', { meta: true, shift: true })).toBe('redo');
    expect(press('z', { ctrl: true, shift: true })).toBe('redo');
    expect(press('y', { ctrl: true })).toBe('redo');
    expect(press('y', { meta: true })).toBeNull();
    expect(press('z', {})).toBeNull();
    expect(press('z', { meta: true, alt: true })).toBeNull();
  });

  it('leaves the keys to a text field or a dialog', () => {
    document.body.innerHTML = `
      <input id="name" type="text" />
      <input id="level" type="range" />
      <textarea id="notes"></textarea>
      <div id="editable" contenteditable="true"><span id="inside"></span></div>
      <div role="dialog"><button id="in-dialog"></button></div>
      <button id="plain"></button>`;
    const at = (id: string) => document.getElementById(id);
    for (const id of ['name', 'notes', 'inside', 'in-dialog']) {
      expect(typingIn(at(id))).toBe(true);
      expect(press('z', { meta: true }, at(id))).toBeNull();
    }
    for (const id of ['level', 'plain']) {
      expect(typingIn(at(id))).toBe(false);
      expect(press('z', { ctrl: true }, at(id))).toBe('undo');
    }
  });
});
