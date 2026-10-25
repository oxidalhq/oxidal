import { describe, it, expect, vi } from 'vitest';
import { EditQueue } from './editQueue';
import type { Action, Snapshot } from './api';
type Edit = Extract<Action, { type: 'edit' }>['edit'];
const snapshot = { revision: 1 } as Snapshot;
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
describe('owned edit transport queue', () => {
  it('bounds previews to one in-flight and one latest value; sends the exact terminal value', async () => {
    const inFlight = deferred<Snapshot>();
    const calls: Edit[] = [];
    const send = vi.fn((edit: Edit) => {
      calls.push(edit);
      return calls.length === 1 ? inFlight.promise : Promise.resolve(snapshot);
    });
    const accept = vi.fn();
    const queue = new EditQueue(
      'owner',
      'token',
      Promise.resolve(),
      send,
      accept,
      vi.fn(),
    );
    queue.preview(0.1);
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    for (let i = 0; i < 1000; i++) queue.preview(i / 1000);
    expect(calls).toHaveLength(1);
    const done = queue.finish(0.73);
    queue.preview(0.99);
    inFlight.resolve(snapshot);
    await done;
    expect(calls).toEqual([
      {
        phase: 'preview',
        owner: 'owner',
        token: 'token',
        sequence: 1,
        value: 0.1,
      },
      {
        phase: 'commit',
        owner: 'owner',
        token: 'token',
        sequence: 2,
        value: 0.73,
      },
    ]);
    expect(accept).toHaveBeenCalledTimes(2);
  });
  it('waits for begin before cancellation and discards queued previews', async () => {
    const begun = deferred<void>();
    const send = vi.fn(() => Promise.resolve(snapshot));
    const queue = new EditQueue(
      'owner',
      'token',
      begun.promise,
      send,
      vi.fn(),
      vi.fn(),
    );
    queue.preview(0.4);
    const cancelled = queue.cancel();
    expect(send).not.toHaveBeenCalled();
    begun.resolve();
    await cancelled;
    expect(send).toHaveBeenCalledExactlyOnceWith({
      phase: 'cancel',
      owner: 'owner',
      token: 'token',
    });
  });
  it('does not replay failed previews or commit, but permits explicit recovery cancellation', async () => {
    const failed = deferred<Snapshot>();
    const send = vi
      .fn()
      .mockImplementationOnce(() => failed.promise)
      .mockResolvedValue(snapshot);
    const report = vi.fn();
    const queue = new EditQueue(
      'owner',
      'token',
      Promise.resolve(),
      send,
      vi.fn(),
      report,
    );
    queue.preview(0.4);
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    const committed = queue.finish(0.6);
    const check = expect(committed).rejects.toThrow('disconnected');
    failed.reject(new Error('disconnected'));
    await check;
    expect(send).toHaveBeenCalledTimes(1);
    await queue.cancel();
    expect(send).toHaveBeenLastCalledWith({
      phase: 'cancel',
      owner: 'owner',
      token: 'token',
    });
    expect(report).toHaveBeenCalledTimes(1);
  });
});
