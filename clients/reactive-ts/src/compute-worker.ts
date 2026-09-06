/** Small pool for pure, structured-cloneable CPU jobs. Never use for queue writes. */
export interface ComputeWorker {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  addEventListener(type: 'message' | 'error' | 'messageerror', listener: (event: any) => void): void;
  removeEventListener(type: 'message' | 'error' | 'messageerror', listener: (event: any) => void): void;
  terminate(): void;
}

export class ComputeError extends Error {
  readonly code: 'QUEUE_FULL' | 'DISPOSED' | 'WORKER_FAILED' | 'TIMED_OUT' | 'TASK_FAILED' | 'INVALID_RESPONSE';
  constructor(code: ComputeError['code']) {
    super(code);
    this.code = code;
    this.name = 'ComputeError';
  }
}

interface Job<I, O> {
  id: number;
  input: I;
  transfer: Transferable[];
  resolve(value: O): void;
  reject(error: unknown): void;
  timer?: ReturnType<typeof setTimeout>;
}
interface Slot<I, O> {
  worker: ComputeWorker;
  job?: Job<I, O>;
  message(event: MessageEvent): void;
  error(): void;
}

export class ComputeWorkerPool<I, O> {
  readonly #slots: Slot<I, O>[] = [];
  readonly #queue: Job<I, O>[] = [];
  readonly #maxPending: number;
  readonly #timeoutMs: number;
  #nextId = 0;
  #closed = false;

  constructor(createWorker: () => ComputeWorker,
    options: { size?: number; maxPending?: number; timeoutMs?: number } = {}) {
    const size = options.size ?? 2;
    this.#maxPending = options.maxPending ?? 32;
    this.#timeoutMs = options.timeoutMs ?? 30_000;
    if (!Number.isSafeInteger(size) || size < 1 || size > 4 ||
        !Number.isSafeInteger(this.#maxPending) || this.#maxPending < size ||
        !Number.isSafeInteger(this.#timeoutMs) || this.#timeoutMs < 1 || this.#timeoutMs > 2_147_483_647) {
      throw new RangeError('size must be 1..4, maxPending >= size, timeoutMs 1..2147483647');
    }
    try {
      for (let i = 0; i < size; i++) {
        const worker = createWorker();
        const slot: Slot<I, O> = {
          worker,
          message: event => this.#receive(slot, event.data),
          error: () => this.#fail(new ComputeError('WORKER_FAILED')),
        };
        this.#slots.push(slot);
        worker.addEventListener('message', slot.message);
        worker.addEventListener('error', slot.error);
        worker.addEventListener('messageerror', slot.error);
      }
    } catch (error) {
      this.#fail(new ComputeError('WORKER_FAILED'));
      throw error;
    }
  }

  /** Capacity includes active jobs. Timeout includes time waiting in the queue. */
  run(input: I, transfer: Transferable[] = []): Promise<O> {
    if (this.#closed) return Promise.reject(new ComputeError('DISPOSED'));
    if (this.#queue.length + this.#slots.filter(s => s.job).length >= this.#maxPending) {
      return Promise.reject(new ComputeError('QUEUE_FULL'));
    }
    return new Promise<O>((resolve, reject) => {
      const job: Job<I, O> = { id: ++this.#nextId, input, transfer, resolve, reject };
      // An unresponsive worker must not leave callers or memory pinned forever.
      // Fail the pool without retrying a possibly side-effecting computation.
      job.timer = setTimeout(() => this.#fail(new ComputeError('TIMED_OUT')), this.#timeoutMs);
      this.#queue.push(job);
      this.#pump();
    });
  }

  #pump(): void {
    for (const slot of this.#slots) {
      if (this.#closed || slot.job || !this.#queue.length) continue;
      const job = this.#queue.shift()!;
      slot.job = job;
      try {
        slot.worker.postMessage({ protocol: 'opto.compute.v1', id: job.id, input: job.input }, job.transfer);
      } catch {
        clearTimeout(job.timer);
        slot.job = undefined;
        job.reject(new ComputeError('TASK_FAILED'));
        // Continue draining even if a value cannot be structured-cloned.
        queueMicrotask(() => this.#pump());
      }
    }
  }

  #receive(slot: Slot<I, O>, data: unknown): void {
    const job = slot.job;
    if (this.#closed || !job) return;
    if (!data || typeof data !== 'object' || !('id' in data) || data.id !== job.id) return;
    if (!('protocol' in data) || data.protocol !== 'opto.compute.v1' || !('ok' in data) ||
        (data.ok !== true && data.ok !== false) || (data.ok && !('output' in data))) {
      this.#fail(new ComputeError('INVALID_RESPONSE'));
      return;
    }
    clearTimeout(job.timer);
    slot.job = undefined;
    if (data.ok && 'output' in data) job.resolve(data.output as O);
    else job.reject(new ComputeError('TASK_FAILED'));
    this.#pump();
  }

  #fail(error: ComputeError): void {
    if (this.#closed) return;
    this.#closed = true;
    const jobs = [...this.#queue.splice(0), ...this.#slots.flatMap(s => s.job ? [s.job] : [])];
    for (const slot of this.#slots) {
      slot.job = undefined;
      slot.worker.removeEventListener('message', slot.message);
      slot.worker.removeEventListener('error', slot.error);
      slot.worker.removeEventListener('messageerror', slot.error);
      slot.worker.terminate();
    }
    for (const job of jobs) {
      clearTimeout(job.timer);
      job.reject(error);
    }
  }

  dispose(): void { this.#fail(new ComputeError('DISPOSED')); }
}

export interface ComputeWorkerScope {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
  removeEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
}

/** Install in a dedicated module Worker after initializing its own WASM engine. */
export function installComputeWorker<I, O>(scope: ComputeWorkerScope,
  compute: (input: I) => O | Promise<O>): () => void {
  let active = true;
  const listener = async (event: MessageEvent) => {
    const data = event.data;
    if (!data || data.protocol !== 'opto.compute.v1' || !Number.isSafeInteger(data.id)) return;
    try {
      const output = await compute(data.input);
      if (active) scope.postMessage({ protocol: 'opto.compute.v1', id: data.id, ok: true, output });
    } catch {
      // Exception strings can contain payloads; send a bounded failure only.
      if (active) scope.postMessage({ protocol: 'opto.compute.v1', id: data.id, ok: false });
    }
  };
  scope.addEventListener('message', listener);
  return () => { active = false; scope.removeEventListener('message', listener); };
}
