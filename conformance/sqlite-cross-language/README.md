# Cross-language SQLite coordination corpus

DEN-1078 residual acceptance item 1: *one deterministic cross-language corpus in
which Node, Dart, and Rust open the same SQLite database and prove mutual
exclusion, monotonic fencing, and lossless wake handoff.*

## Why this exists

DEN-1113 (Rust) and DEN-1127 (Dart) each landed a `opto_sync_desktop_coordination_v1`
implementation, and every runtime has its own suite. Those suites prove each
implementation against **itself**. They cannot catch the failure that actually
matters for a shared on-disk contract: two runtimes disagreeing about the same
database. A Rust-only test will happily pass while Rust and Node quietly permit
two simultaneous owners.

This corpus is the only place the three implementations are proven against
**each other**.

## What it proves

Every runtime takes a turn as the holder, so no implementation is privileged as
"the" reference.

| Property | Assertion |
| --- | --- |
| Mutual exclusion | While one runtime holds the lease, the other two observe `busy` and never acquire |
| Monotonic fencing | Fences strictly increase across a `rust → node → dart → rust → dart → node` handoff chain |
| Lossless wake handoff | Wakes raised by other runtimes mid-hold keep the row dirty, block release, survive holder exit, and are inherited with a strictly newer fence |

## Running it

```bash
# Rust child
(cd clients/desktop-rust && cargo build --bin opto_sync_sqlite_child)

# Dart child — compiled, not `dart run` (see below)
(cd clients/reactive-dart && dart pub get && mkdir -p build \
  && dart compile exe tool/sqlite_conformance_child.dart \
       -o build/sqlite_conformance_child)

# Node child ships as-is
node conformance/sqlite-cross-language/run-corpus.mjs
```

CI runs this on Ubuntu, macOS, and Windows via
`.github/workflows/sqlite-cross-language-conformance.yml`, twice per job, so a
result that depends on scheduling order fails the build.

## The child protocol

Each runtime ships a child speaking identical flags:

```
--db <path> --key <key> --owner <id> --mode <mode> [--hold-ms N] [--ttl-ms N]
```

Modes: `wake`, `contend`, `acquire-hold` (exits while holding, to exercise
expiry replay), `state`.

Children emit sentinel-prefixed JSON events:

```
@@OPTO@@ {"event":"acquired","runtime":"rust","fence":"1",...}
```

### Why the sentinel

`dart run` writes `Running build hooks...` to both stdout and stderr, sometimes
onto the *same line* as program output. Any harness that parses raw stream text
is corrupted by it — this is not hypothetical, it is why
`tool/sqlite_desktop_self_test.dart` failed locally before its assertions were
taught to strip that chatter. Scanning for `@@OPTO@@` anywhere in a line makes
the protocol immune regardless of toolchain noise.

The Dart child is additionally **compiled** rather than run under the JIT: the
JIT path is slow enough to blow multi-process timeouts on a cold cache, which
makes contention tests flaky for reasons unrelated to coordination.
