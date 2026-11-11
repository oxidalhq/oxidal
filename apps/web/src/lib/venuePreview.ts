/**
 * Sends a dragged value at most once per `interval` ms with one request in
 * flight: newer values replace a waiting one, and `finish` sends the final
 * value as soon as the request ahead of it returns, so a release is never
 * dropped. `settled` runs when nothing is waiting or in flight.
 * @see docs/media.md
 */
export class PreviewThrottle<T> {
  private waiting: { value: T } | null = null;
  private final = false;
  private running = false;
  private last = -Infinity;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private idle: (() => void)[] = [];
  constructor(
    private readonly send: (value: T) => Promise<void>,
    private readonly settled: () => void = () => {},
    private readonly interval = 50,
    private readonly now: () => number = () => performance.now(),
  ) {}
  /** A value during a drag; may be replaced before it is sent. */
  push(value: T) {
    this.waiting = { value };
    this.pump();
  }
  /** The value on release: sent without waiting for the interval. */
  finish(value: T) {
    this.waiting = { value };
    this.final = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.pump();
  }
  /** Drops anything not yet sent, as after a refusal or another client's change. */
  cancel() {
    this.waiting = null;
    this.final = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!this.running) this.release();
  }
  get busy() {
    return this.running || this.waiting !== null;
  }
  /** Sends any waiting value now and resolves once nothing is in flight. */
  whenIdle(): Promise<void> {
    if (!this.busy) return Promise.resolve();
    const done = new Promise<void>((resolve) => this.idle.push(resolve));
    if (this.waiting) this.finish(this.waiting.value);
    return done;
  }
  private release() {
    const waiting = this.idle;
    this.idle = [];
    for (const resolve of waiting) resolve();
  }
  private pump() {
    if (this.running || this.timer) return;
    const waiting = this.waiting;
    if (!waiting) return;
    const wait = this.final ? 0 : this.last + this.interval - this.now();
    if (wait > 0) {
      this.timer = setTimeout(() => {
        this.timer = null;
        this.pump();
      }, wait);
      return;
    }
    this.waiting = null;
    this.final = false;
    this.running = true;
    this.last = this.now();
    void this.send(waiting.value)
      .catch(() => this.cancel())
      .finally(() => {
        this.running = false;
        if (this.waiting) this.pump();
        else {
          this.settled();
          this.release();
        }
      });
  }
}
