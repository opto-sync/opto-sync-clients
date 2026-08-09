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
  // Dart runs through the SDK rather than an AOT binary: `dart compile exe`
  // does not carry the sqlite3 native asset on Linux or Windows, so the
  // compiled child cannot open a database there. The JIT path resolves the
  // native library through .dart_tool and works on all three platforms. The
  // sentinel below makes its build-hook chatter harmless.
  dart: {
    command: process.env.DART_BIN ?? 'dart',
    args: ['run', path.join(ROOT, 'clients/reactive-dart/tool/sqlite_conformance_child.dart')],
    cwd: path.join(ROOT, 'clients/reactive-dart'),
    build: 'dart pub get (in clients/reactive-dart)',
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
  const child = spawn(spec.command, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    cwd: spec.cwd ?? process.cwd(),
  });
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
async function waitForEvent(handle, type, timeoutMs = 90_000) {
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
  // The holder must still own the lease when the slowest contender reaches its
  // acquire call. Sizing the hold to expected process-spawn time makes the
  // result a wall-clock race: a JIT runtime can take seconds to start, arrive
  // after a legitimate release, acquire correctly, and be reported as having
  // stolen the lease. So the holder holds effectively forever and is killed
  // once every contender has answered — the window cannot close early, and no
  // wall-clock interval is encoded in the test.
  const handle = spawnChild(holder, {
    db, owner: `${holder}-holder`, mode: 'contend', holdMs: 600_000, ttlMs: 600_000,
  });

  try {
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
  } finally {
    handle.child.kill();
    await handle.done;
  }
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

  // The lease must outlive the spawn latency of two more children, and a JIT
  // runtime can take seconds to reach its first event. A TTL tuned to an AOT
  // binary would expire mid-scenario and turn a coordination test into a
  // wall-clock race, so it is deliberately generous; expiry is then detected
  // by polling rather than by sleeping a fixed interval.
  const leaseTtlMs = 30_000;
  // The hold must outlast the wakers' startup, or "wakes raised mid-hold"
  // silently becomes "wakes raised after the holder already finished" and the
  // scenario stops testing what it claims. The TTL then has to outlast the
  // hold plus two further child spawns; expiry is found by polling, so a
  // generous TTL costs nothing but the poll.
  const handle = spawnChild(holder, {
    db, owner: `${holder}-holder`, mode: 'contend', holdMs: 9000, ttlMs: leaseTtlMs,
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
  // so the wake raised mid-hold is executed rather than dropped. Poll for the
  // inheritance instead of sleeping: the exact expiry instant is decided by
  // SQLite's clock, and a fixed sleep would encode this machine's spawn speed.
  const inheritDeadline = Date.now() + 90_000;
  let took;
  let next;
  while (Date.now() < inheritDeadline) {
    next = await run(successor, {
      db, owner: `${successor}-successor`, mode: 'contend', ttlMs: 5000,
    });
    took = next.events.find((event) => event.event === 'acquired');
    if (took) break;
  }
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
    path.isAbsolute(spec.command) &&
    spec.command !== process.execPath &&
    !existsSync(spec.command));
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
