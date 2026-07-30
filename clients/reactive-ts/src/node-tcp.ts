import { createConnection } from 'node:net';

import type { ProtocolTransport, ResetRequired } from '@opto-sync/client';
import type {
  PullResponse,
  PushRequest,
  PushResponse,
  SnapshotResponse,
} from '@opto-sync/client';

export interface TcpJsonLineProtocolOptions {
  host: string;
  port: number;
  timeoutMs?: number;
  connect?: typeof createConnection;
  auth?: () => Promise<Record<string, string>> | Record<string, string>;
}

interface TcpEnvelope {
  id: string;
  method: 'push' | 'pull' | 'snapshot';
  auth?: Record<string, string>;
  payload: unknown;
}

interface TcpResponse {
  id: string;
  ok: boolean;
  result?: unknown;
  error?: string;
}

let requestSequence = 0;

/**
 * One bounded JSON-lines request per connection for trusted Node/native hosts.
 * Browser and mobile background workers should use HTTP; they cannot safely or
 * reliably own a permanent raw socket while suspended.
 */
export class TcpJsonLineProtocolTransport implements ProtocolTransport {
  private readonly timeoutMs: number;
  private readonly connect: typeof createConnection;

  constructor(private readonly options: TcpJsonLineProtocolOptions) {
    if (!options.host) throw new Error('TCP host is required');
    if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535) {
      throw new RangeError('TCP port must be from 1 through 65535');
    }
    this.timeoutMs = options.timeoutMs ?? 10_000;
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs < 100 || this.timeoutMs > 120_000) {
      throw new RangeError('TCP timeoutMs must be from 100 through 120000');
    }
    this.connect = options.connect ?? createConnection;
  }

  push(request: PushRequest, signal: AbortSignal): Promise<PushResponse> {
    return this.request<PushResponse>('push', request, signal);
  }

  pull(
    checkpoint: string,
    limit: number,
    signal: AbortSignal,
  ): Promise<PullResponse | ResetRequired> {
    return this.request<PullResponse | ResetRequired>(
      'pull',
      { checkpoint, limit },
      signal,
    );
  }

  snapshot(
    signal: AbortSignal,
    reset?: ResetRequired,
  ): Promise<SnapshotResponse> {
    return this.request<SnapshotResponse>('snapshot', reset ?? {}, signal);
  }

  private async request<T>(
    method: TcpEnvelope['method'],
    payload: unknown,
    signal: AbortSignal,
  ): Promise<T> {
    const id = `${process.pid}-${Date.now()}-${++requestSequence}`;
    const envelope: TcpEnvelope = {
      id,
      method,
      payload,
      ...(this.options.auth ? { auth: await this.options.auth() } : {}),
    };
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      let buffer = '';
      const socket = this.connect({ host: this.options.host, port: this.options.port });
      const finish = (error?: unknown, result?: T) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
        socket.destroy();
        if (error !== undefined) reject(error);
        else resolve(result as T);
      };
      const onAbort = () => finish(signal.reason ?? new DOMException('aborted', 'AbortError'));
      const timer = setTimeout(
        () => finish(new Error(`opto-sync TCP ${method} timed out`)),
        this.timeoutMs,
      );
      signal.addEventListener('abort', onAbort, { once: true });
      if (signal.aborted) return onAbort();

      socket.setEncoding('utf8');
      socket.on('connect', () => socket.write(`${JSON.stringify(envelope)}\n`));
      socket.on('data', (chunk) => {
        buffer += chunk;
        if (buffer.length > 2 * 1024 * 1024) {
          finish(new Error('opto-sync TCP response exceeded 2 MiB'));
          return;
        }
        const newline = buffer.indexOf('\n');
        if (newline < 0) return;
        const line = buffer.slice(0, newline);
        let response: TcpResponse;
        try {
          response = JSON.parse(line) as TcpResponse;
        } catch {
          finish(new Error('opto-sync TCP returned invalid JSON'));
          return;
        }
        if (response.id !== id) {
          finish(new Error('opto-sync TCP response id mismatch'));
        } else if (!response.ok) {
          finish(new Error((response.error ?? 'opto-sync TCP request failed').slice(0, 300)));
        } else {
          finish(undefined, response.result as T);
        }
      });
      socket.on('error', (error) => finish(error));
      socket.on('end', () => {
        if (!settled) finish(new Error('opto-sync TCP closed before one response line'));
      });
    });
  }
}
