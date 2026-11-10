# Experimental SQLite journal adapter (Node 24 reference)

**This implements a real SQLite-backed host reference for the future AttoLang
sync actor. It is NOT compiled or executed AttoLang, not an SDK, and not an
authenticated remote HTTP client.**

File: `sqlite_journal.host.mjs`. It is deliberately within
`experimental/oreslang/` and not imported by shipping clients.

## Guarantees within the trusted host process

- SQLite `WAL`, `synchronous=FULL`, `BEGIN IMMEDIATE` fenced transactions;
  the adapter rejects a missing WAL/FULL setting, malformed journal rows,
  noncanonical unsigned decimal IDs, wrong tenant/client, oversized payloads,
  or simultaneous outstanding mutations
- `stage_mutation` returns an opaque in-process receipt **only after COMMIT**;
  a caller cannot create one by supplying `storage_fsynced: true`
- Every new supervisor opening this journal increments the persisted generation
  in its own SQLite transaction. Earlier sessions must compare the stored
  generation before mutations or retirement and fail closed when fenced
- Exactly one immutable mutation can be pending. A lost HTTP response or
  process crash does not clear it; `recovered_stage_receipt` reconstructs a
  fresh *session-local* capability from committed durable journal state
- `dispatch` accepts only a branded stage receipt, checks the original retry
  deadline, sends an exact immutable envelope and validates the scoped server
  reply (client, protocol, last mutation, result status, checkpoint)
- `retire_verified` accepts only an opaque receipt minted by `dispatch` after
  a verified trusted exchange, then advances the checkpoint and removes pending
  work together in **one FULL-synchronous SQLite transaction**; only after that
  COMMIT is a retirement receipt returned
- All numbers crossing the protocol are canonical decimal strings bounded by
  the signed-i64 maximum; no JS floating point mutation ID truncation

## Trust boundary and remaining gaps

`exchange` is **injected by the trusted supervisor**. In tests it is a fake
callback. A malicious caller able to choose `exchange` can fake an HTTP server;
therefore minted receipts are unforgeable *objects* inside this Node module,
but do not establish external network authentication. A production transport
must own authenticated TLS credentials, validate tenant context, and fence the
actor generation on the server side. The current wire envelope does not
include a server-validated fencing token: an already-dispatched old request
may reach the server after a new local generation opens the journal.
**This is a remaining distributed correctness blocker**, even though all
*local* stale journal commits are denied.

The database file and parent directory must be readable/writable only by
trusted supervisor processes. An attacker with raw SQLite file write access
can bypass the public adapter and forge state; SQLite is not a security
boundary against filesystem compromise. Concurrent supervisor openings use
last-acquired-generation-wins fencing; authorization of which supervisor may
acquire a generation is a deployment/OS-level capability still to implement.

This reference has no actual AttoLang SQLite FFI binding, no actor scheduling,
no compilation, and no production HTTP or PostgreSQL E2E. Its tests are
real SQLite host execution and independent subprocess crash/replay scenarios,
but **cannot be reported as native AttoLang guest verification**.

## Reproduce

With Node.js 24:

```sh
node --test experimental/oreslang/tests/*.test.mjs
```

For actual AttoLang, follow the guest compiler admission blocked in Java
#2751 and LLVM #1639, and replace the adapter boundary with an audited native
storage capability whose receipt construction is inaccessible to user actors.

## Path guard hardening

The adapter uses `lstat` directly, rejecting both existing symlinks and
**dangling** symlinks before opening SQLite. This avoids following a link
whose target did not exist at the time of an `exists`-style check. The
security boundary still requires an OS-protected parent directory; lstat
alone cannot prevent a malicious directory owner swapping path components
between inspection and SQLite open.

## Executed crash-window test requirements

A separate Node process begins a SQLite `BEGIN IMMEDIATE` transaction,
changes `last_ack`, and terminates without `COMMIT`. Reopening the journal
must observe the old committed value: an in-flight SQLite write is not durable.
A second check suspends an HTTP exchange, acquires a newer supervisor
generation, then releases the old reply; `dispatch` must reject that stale
reply, leave pending work in SQLite, and let the new generation replay the
original mutation. This fences local retirement only: the remote server still
requires its own generation-aware admission protocol.
