import type { Action, Snapshot } from './api';

type Edit = Extract<Action, { type: 'edit' }>['edit'];
type Send = (edit: Edit) => Promise<Snapshot>;

/** One in-flight request plus one replaceable preview; a terminal value is never coalesced away. */
export class EditQueue {
  private pending: number | null = null;
  private running = false;
  private sequence = 0;
  private failed = false;
  private terminal: {
    value: number | null;
    resolve: () => void;
    reject: (e: unknown) => void;
  } | null = null;
  private result: Promise<void> | null = null;
  constructor(
    private readonly owner: string,
    private readonly token: string,
    private readonly ready: Promise<unknown>,
    private readonly send: Send,
    private readonly accept: (state: Snapshot) => void,
    private readonly fail: (error: unknown) => void,
  ) {}
  preview(value: number) {
    if (this.result || this.failed) return;
    this.pending = value;
    void this.pump();
  }
  finish(value: number | null): Promise<void> {
    if (this.result) return this.result;
    this.pending = null;
    this.result = new Promise<void>((resolve, reject) => {
      this.terminal = { value, resolve, reject };
    });
    void this.pump();
    return this.result;
  }
  async cancel(): Promise<void> {
    if (!this.result) return this.finish(null);
    await this.result.catch(() => {});
    // Cancellation after an uncertain terminal request is safe: the daemon
    // retains successful receipts and cannot undo an already committed value.
    await this.ready;
    this.accept(
      await this.send({
        phase: 'cancel',
        owner: this.owner,
        token: this.token,
      }),
    );
  }
  private async pump() {
    if (this.running) return;
    this.running = true;
    try {
      await this.ready;
      while (this.terminal || this.pending !== null) {
        const terminal = this.terminal;
        const value = terminal ? terminal.value : this.pending;
        this.pending = null;
        if (this.failed && terminal?.value !== null)
          throw new Error('Preview failed; cancel or reopen the editor.');
        const identity = { owner: this.owner, token: this.token };
        const edit: Edit =
          terminal && value === null
            ? { phase: 'cancel', ...identity }
            : {
                phase: terminal ? 'commit' : 'preview',
                ...identity,
                sequence: ++this.sequence,
                value: value!,
              };
        const next = await this.send(edit);
        this.accept(next);
        if (terminal) {
          terminal.resolve();
          this.terminal = null;
          return;
        }
      }
    } catch (error) {
      this.pending = null;
      this.failed = true;
      this.terminal?.reject(error);
      this.terminal = null;
      this.fail(error);
    } finally {
      this.running = false;
    }
  }
}
