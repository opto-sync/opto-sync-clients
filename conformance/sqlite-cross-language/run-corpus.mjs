#!/usr/bin/env node
// Cross-language SQLite desktop coordination corpus (DEN-1078).
//
// Node, Dart, and Rust processes open the SAME SQLite database and must agree
// on `opto_sync_desktop_coordination_v1`. Per-language suites already prove
// each runtime against itself; this corpus is the only place the three are
// proven against EACH OTHER, which is the property the shared on-disk contract
// actually depends on.
//
// Proven here:
//   1. mutual exclusion    - while one runtime holds, the other two get busy
//   2. monotonic fencing   - fences strictly increase across runtime handoffs
//   3. lossless wake handoff - wakes raised mid-hold survive to the next owner
//
// Children speak one protocol and emit `@@OPTO@@ {json}` events. The sentinel
// is required: `dart run` writes "Running build hooks..." onto the same stream
// (and the same line), which silently corrupts any raw-stream parser.

import { spawn } from 'node:child_process';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SENTINEL = '@@OPTO@@';

// Windows produces .exe artifacts for both the Rust and Dart children.
const EXE = process.platform === 'win32' ? '.exe' : '';

const RUNTIMES = {
  rust: {
    command: path.join(ROOT, `clients/desktop-rust/target/debug/opto_sync_sqlite_child${EXE}`),
    args: [],
    build: 'cargo build --bin opto_sync_sqlite_child (in clients/desktop-rust)',
  },
  node: {
    command: process.execPath,
    args: [
      '--experimental-strip-types',
      '--no-warnings',
      path.join(ROOT, 'clients/reactive-ts/tool/sqlite-conformance-child.ts'),
    ],
    build: 'ships with the repository',
  },
  dart: {
    command: path.join(ROOT, `clients/reactive-dart/build/sqlite_conformance_child${EXE}`),
    args: [],
    build: 'dart compile exe tool/sqlite_conformance_child.dart -o build/sqlite_conformance_child',
  },
};

let failures = 0;
let checks = 0;

function check(condition, message) {
  checks += 1;
  if (condition) {
    console.log(`  ok   ${message}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${message}`);
  }
}

function parseEvents(text) {
  const events = [];
  for (const line of text.split('\n')) {
    const at = line.indexOf(SENTINEL);
    if (at < 0) continue;
    try {
      events.push(JSON.parse(line.slice(at + SENTINEL.length).trim()));
    } catch {
      // A partially flushed line is not an event; the corpus asserts on the
      // events it did receive rather than inventing one here.
    }
  }
  return events;
}

function spawnChild(runtime, options) {
  const spec = RUNTIMES[runtime];
  const args = [
    ...spec.args,
    '--db', options.db,
    '--key', options.key ?? 'partition',
    '--owner', options.owner,
    '--mode', options.mode,
    '--hold-ms', String(options.holdMs ?? 0),
    '--ttl-ms', String(options.ttlMs ?? 5000),
  ];
  const child = spawn(spec.command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const done = new Promise((resolve) => {
    child.on('close', (code) => resolve({ code, stdout, stderr, events: parseEvents(stdout) }));
  });
  return { child, done, peek: () => parseEvents(stdout) };
}

function run(runtime, options) {
  return spawnChild(runtime, options).done;
}

/** Wait until the running child has emitted an event of `type`. */
async function waitForEvent(handle, type, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = handle.peek().find((event) => event.event === type);
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`timed out waiting for "${type}" event`);
}

function freshDb() {
  return path.join(mkdtempSync(path.join(tmpdir(), 'opto-corpus-')), 'coordination.db');
}

// ---------------------------------------------------------------------------
// 1. Mutual exclusion across runtimes
// ---------------------------------------------------------------------------
async function mutualExclusion(holder, contenders) {
  console.log(`\n[mutual exclusion] holder=${holder} contenders=${contenders.join(',')}`);
  const db = freshDb();
  const handle = spawnChild(holder, {
    db, owner: `${holder}-holder`, mode: 'contend', holdMs: 3000, ttlMs: 10_000,
  });

  const acquired = await waitForEvent(handle, 'acquired');
  check(acquired.fence === '1', `${holder} took the first fence (got ${acquired.fence})`);

  const results = await Promise.all(
    contenders.map((runtime) =>
      run(runtime, { db, owner: `${runtime}-contender`, mode: 'contend', ttlMs: 5000 })),
  );

  for (const [index, result] of results.entries()) {
    const runtime = contenders[index];
    const busy = result.events.find((event) => event.event === 'busy');
    const stole = result.events.find((event) => event.event === 'acquired');
    check(!stole, `${runtime} did not steal the lease held by ${holder}`);
    check(Boolean(busy), `${runtime} observed the ${holder} lease as busy`);
  }

  await handle.done;
}

// ---------------------------------------------------------------------------
// 2. Monotonic fencing across runtime handoffs
// ---------------------------------------------------------------------------
async function monotonicFencing(order) {
  console.log(`\n[monotonic fencing] handoff order=${order.join(' -> ')}`);
  const db = freshDb();
  let previous = 0n;

  for (const runtime of order) {
    const result = await run(runtime, {
      db, owner: `${runtime}-owner`, mode: 'contend', ttlMs: 5000,
    });
    const acquired = result.events.find((event) => event.event === 'acquired');
    if (!acquired) {
      check(false, `${runtime} acquired the free lease (stderr: ${result.stderr.slice(0, 200)})`);
      continue;
    }
    const fence = BigInt(acquired.fence);
    check(fence > previous, `${runtime} fence ${fence} strictly exceeds previous ${previous}`);
    previous = fence;
  }
}

// ---------------------------------------------------------------------------
// 3. Lossless wake handoff across runtimes
// ---------------------------------------------------------------------------
async function losslessWakeHandoff(holder, wakers, successor) {
  console.log(`\n[lossless wake handoff] holder=${holder} wakers=${wakers.join(',')} successor=${successor}`);
  const db = freshDb();

  // A short TTL lets the corpus observe the post-retention handoff without
  // sleeping for an arbitrary wall-clock interval.
  const leaseTtlMs = 1500;
  const handle = spawnChild(holder, {
    db, owner: `${holder}-holder`, mode: 'contend', holdMs: 600, ttlMs: leaseTtlMs,
  });
  const acquired = await waitForEvent(handle, 'acquired');
  const observedGeneration = BigInt(acquired.wakeGeneration);

  // Other runtimes raise wakes while the holder is mid-cycle. These must not
  // be lost: the holder completed against an older generation, so the record
  // stays dirty and the successor is obliged to run.
  const wakeResults = await Promise.all(
    wakers.map((runtime) => run(runtime, { db, owner: `${runtime}-waker`, mode: 'wake' })),
  );
  for (const [index, result] of wakeResults.entries()) {
    const wake = result.events.find((event) => event.event === 'wake');
    check(Boolean(wake), `${wakers[index]} recorded a wake during the ${holder} hold`);
  }

  const finished = await handle.done;
  const completed = finished.events.find((event) => event.event === 'completed');
  check(Boolean(completed), `${holder} completed its cycle`);
  if (completed) {
    check(
      completed.released === false,
      `${holder} refused to release while newer wakes were pending (released=${completed.released})`,
    );
    check(
      BigInt(completed.currentWakeGeneration) > observedGeneration,
      `wake generation advanced past the ${holder} observation ` +
        `(${completed.currentWakeGeneration} > ${observedGeneration})`,
    );
  }

  // The holder exited while still owning the retained lease. Before expiry the
  // successor MUST be excluded; the pending wake still has to be durably
  // visible to it. This is the actual "lossless" property.
  const early = await run(successor, {
    db, owner: `${successor}-early`, mode: 'contend', ttlMs: 5000,
  });
  check(
    Boolean(early.events.find((event) => event.event === 'busy')),
    `${successor} is excluded while the retained ${holder} lease is unexpired`,
  );

  const observed = await run(successor, { db, owner: `${successor}-reader`, mode: 'state' });
  const state = observed.events.find((event) => event.event === 'state');
  check(Boolean(state), `${successor} read the coordination row`);
  if (state) {
    check(state.dirty === true, `retained wake is still dirty for ${successor}`);
    check(
      BigInt(state.wakeGeneration) > BigInt(state.handledGeneration),
      `unhandled wake survives the ${holder} exit ` +
        `(wake ${state.wakeGeneration} > handled ${state.handledGeneration})`,
    );
  }

  // After expiry the successor inherits the work with a strictly newer fence,
  // so the wake raised mid-hold is executed rather than dropped.
  await new Promise((resolve) => setTimeout(resolve, leaseTtlMs + 400));
  const next = await run(successor, {
    db, owner: `${successor}-successor`, mode: 'contend', ttlMs: 5000,
  });
  const took = next.events.find((event) => event.event === 'acquired');
  check(Boolean(took), `${successor} picked up the retained wake after expiry`);
  if (took) {
    check(
      BigInt(took.fence) > BigInt(acquired.fence),
      `${successor} fence advanced on handoff ` +
        `(${took?.fence} > ${acquired.fence})`,
    );
  }
}

// ---------------------------------------------------------------------------

async function main() {
  console.log('opto-sync cross-language SQLite coordination corpus (DEN-1078)');

  const missing = Object.entries(RUNTIMES).filter(([, spec]) =>
    spec.command !== process.execPath && !existsSync(spec.command));
  if (missing.length > 0) {
    console.error('\nMissing conformance children. Build them first:');
    for (const [name, spec] of missing) console.error(`  ${name}: ${spec.build}`);
    process.exit(2);
  }

  // Every runtime must hold against the other two, so no single implementation
  // is privileged as "the" reference.
  await mutualExclusion('rust', ['node', 'dart']);
  await mutualExclusion('node', ['rust', 'dart']);
  await mutualExclusion('dart', ['rust', 'node']);

  await monotonicFencing(['rust', 'node', 'dart', 'rust', 'dart', 'node']);

  await losslessWakeHandoff('rust', ['node', 'dart'], 'node');
  await losslessWakeHandoff('node', ['rust', 'dart'], 'dart');
  await losslessWakeHandoff('dart', ['rust', 'node'], 'rust');

  console.log(`\n${checks - failures}/${checks} checks passed`);
  if (failures > 0) {
    console.error(`${failures} cross-language conformance failures`);
    process.exit(1);
  }
  console.log('cross-language SQLite coordination is consistent');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
