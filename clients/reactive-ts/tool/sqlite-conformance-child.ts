// Uniform cross-language conformance child for SQLite desktop coordination.
//
// Mirrors clients/desktop-rust/src/bin/opto_sync_sqlite_child.rs and
// clients/reactive-dart/tool/sqlite_conformance_child.dart exactly: same
// flags, same modes, same sentinel-prefixed JSON events. The orchestrator
// contends all three runtimes against a single SQLite database.
//
// The `@@OPTO@@` sentinel exists because toolchains emit their own progress
// text on stdout and stderr; parsing only sentinel lines keeps the protocol
// immune to that noise.

import { NodeSqliteDesktopCoordinator } from '../src/sqlite-desktop.ts';

const SENTINEL = '@@OPTO@@';

function emit(event: string, fields: Record<string, unknown>): void {
  process.stdout.write(
    `${SENTINEL} ${JSON.stringify({ event, runtime: 'node', ...fields })}\n`,
  );
}

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function required(name: string): string {
  const value = flag(name);
  if (value === undefined) {
    process.stderr.write(`missing required flag ${name}\n`);
    process.exit(2);
  }
  return value;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<number> {
  const db = required('--db');
  const key = required('--key');
  const owner = required('--owner');
  const mode = required('--mode');
  const holdMs = Number(flag('--hold-ms') ?? 0);
  const ttlMs = Number(flag('--ttl-ms') ?? 5_000);

  let coordinator: NodeSqliteDesktopCoordinator;
  try {
    coordinator = new NodeSqliteDesktopCoordinator(db, { busyTimeoutMs: 10_000 });
  } catch (error) {
    emit('error', { message: String(error) });
    return 1;
  }

  try {
    if (mode === 'wake') {
      const receipt = coordinator.signalWake(key);
      emit('wake', {
        generation: receipt.generation,
        handledGeneration: receipt.handledGeneration,
        dirty: receipt.dirty,
      });
      return 0;
    }

    if (mode === 'state') {
      const state = coordinator.readState(key);
      emit('state', {
        fence: state.fence,
        wakeGeneration: state.wakeGeneration,
        handledGeneration: state.handledGeneration,
        dirty: state.dirty,
        owned: state.owned,
      });
      return 0;
    }

    if (mode === 'contend' || mode === 'acquire-hold') {
      coordinator.signalWake(key);
      const result = coordinator.acquire({
        key,
        ownerId: owner,
        token: `${owner}-token`,
        leaseTtlMs: ttlMs,
      });

      if (result.status === 'busy') {
        emit('busy', {
          wakeGeneration: result.wakeGeneration,
          handledGeneration: result.handledGeneration,
          retryAfterMs: result.retryAfterMs,
        });
        return 0;
      }

      const grant = result.grant;
      emit('acquired', {
        fence: grant.fence,
        owner: grant.ownerId,
        wakeGeneration: grant.wakeGeneration,
      });

      if (holdMs > 0) await sleep(holdMs);

      // acquire-hold exits while still holding, to exercise expiry replay.
      if (mode === 'acquire-hold') return 0;

      const completion = coordinator.complete(grant, grant.wakeGeneration);
      emit('completed', {
        released: completion.released,
        currentWakeGeneration: completion.currentWakeGeneration,
        handledGeneration: completion.handledGeneration,
      });
      return 0;
    }

    emit('error', { message: `unknown mode ${mode}` });
    return 2;
  } catch (error) {
    emit('error', { message: String(error) });
    return 1;
  } finally {
    coordinator.close();
  }
}

main().then(
  (code) => process.exit(code),
  (error) => {
    emit('error', { message: String(error) });
    process.exit(1);
  },
);
