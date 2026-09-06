/** A synchronous, UI-independent store. State and selected values must be immutable. */
export class StateStore<S, A> {
  #state: S;
  #revision = 0;
  #busy = false;
  #disposed = false;
  #listeners = new Set<() => void>();
  #effects = new Map<string, object>();
  readonly #reduce: (state: Readonly<S>, action: A) => S;
  readonly #onObserverError: (error: unknown) => void;

  constructor(initial: S, reduce: (state: Readonly<S>, action: A) => S,
    onObserverError: (error: unknown) => void = () => {}) {
    this.#state = initial;
    this.#reduce = reduce;
    this.#onObserverError = onObserverError;
  }

  get state(): Readonly<S> { return this.#state; }
  get revision(): number { return this.#revision; }
  get disposed(): boolean { return this.#disposed; }

  #check(): void {
    if (this.#disposed) throw new Error('StateStore is disposed');
    if (this.#busy) throw new Error('StateStore does not allow reentrant transitions');
  }

  #notify(): void {
    for (const listener of [...this.#listeners]) {
      if (!this.#listeners.has(listener)) continue;
      try { listener(); } catch (error) {
        // Rendering/diagnostics must not turn a committed dispatch into a failure.
        try { this.#onObserverError(error); } catch { /* observer isolation */ }
      }
    }
  }

  /** Reducer failures leave the previous state and revision intact. */
  dispatch(action: A): void {
    this.#check();
    this.#busy = true;
    try {
      const next = this.#reduce(this.#state, action);
      if (next !== null && typeof next === 'object' &&
          'then' in next && typeof next.then === 'function') {
        throw new TypeError('StateStore reducers must be synchronous');
      }
      this.#state = next;
      this.#revision += 1;
      this.#notify();
    } finally { this.#busy = false; }
  }

  /** Clear user state and invalidate every outstanding effect on session change. */
  reset(initial: S): void {
    this.#check();
    this.#busy = true;
    try {
      this.#effects.clear();
      this.#state = initial;
      this.#revision += 1;
      this.#notify();
    } finally { this.#busy = false; }
  }

  /** Replays once synchronously, then emits only when the selected value changes. */
  select<T>(selector: (state: Readonly<S>) => T, listener: (value: T) => void,
    same: (left: T, right: T) => boolean = Object.is): () => void {
    this.#check();
    this.#busy = true;
    try {
      let previous = selector(this.#state);
      const notify = () => {
        const next = selector(this.#state);
        if (same(previous, next)) return;
        previous = next;
        listener(next);
      };
      // Do not retain the listener if initial selection/delivery fails.
      listener(previous);
      this.#listeners.add(notify);
      return () => { this.#listeners.delete(notify); };
    } finally { this.#busy = false; }
  }

  /** Latest result wins per key; unrelated keys can run concurrently. */
  beginEffect(key: string): StateEffect<A> {
    this.#check();
    const token = {};
    this.#effects.set(key, token);
    const isCurrent = () => !this.#disposed && this.#effects.get(key) === token;
    return {
      isCurrent,
      dispatch: (action) => {
        if (!isCurrent()) return false;
        this.dispatch(action);
        return true;
      },
      close: () => { if (isCurrent()) this.#effects.delete(key); },
    };
  }

  /** Read a complete, already-rebased localView; never hydrate a raw remote echo. */
  async projectLocalView<T>(key: string, read: () => Promise<T>, action: (value: T) => A): Promise<boolean> {
    const effect = this.beginEffect(key);
    try {
      const value = await read();
      return effect.isCurrent() && effect.dispatch(action(value));
    } finally { effect.close(); }
  }

  /** Releases subscriptions and invalidates effects. Does not touch durable queues. */
  dispose(): void {
    if (this.#disposed) return;
    this.#check();
    this.#disposed = true;
    this.#effects.clear();
    this.#listeners.clear();
  }
}

/** Logical cancellation only: an already-started durable write must still settle. */
export interface StateEffect<A> {
  isCurrent(): boolean;
  dispatch(action: A): boolean;
  close(): void;
}
