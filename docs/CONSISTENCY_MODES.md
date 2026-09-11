# Explicit consistency modes

Caller-selected optimism is a versioned, wire-neutral policy identity stored on
the durable mutation intent. Display names may change; these identifiers must
not:

| Mode | Canonical identity | Legacy aliases |
|---|---|---|
| Remote-acknowledged / strict | `opto.consistency.remote-acknowledged.v1` | `remote-acknowledged`, `strict`, `remote-confirmed`, `await-server` |
| Write-through local-first | `opto.consistency.write-through-local-first.v1` | `write-through-local-first`, `local-then-remote`, `local-first` |
| Queued local-first | `opto.consistency.queued-local-first.v1` | `queued-local-first`, `local-durable`, `background` |

Unknown identifiers fail closed. Aliases are accepted at the call site and
canonicalized before queue commit. The stored identity is always the `opto.consistency.*.v1` value.

## Mode semantics

1. **Remote-acknowledged / strict** — persist intent for retry identity, send immediately, and do not report committed success until an exact-batch acknowledgement covers that mutation. Failures never appear as confirmed data. A committed-but-response-lost cycle is `ambiguous`. Caller cancellation is `cancelled`, which is distinct from ambiguity.
2. **Write-through local-first** — atomically persist the local intent and pending overlay, start the remote request immediately, and return a typed `pending` / `confirmed` / `rejected` / `transformed` / `ambiguous` result.
3. **Queued local-first** — atomically update the durable local view and queue, then return `pending` without requiring a network attempt. Foreground or background sync delivers later.

An already queued mutation cannot change identity or content, including its
canonical policy. Rebinding the same canonical policy (including through an
alias) is a no-op.

## Typed outcomes

`confirmed`, `pending`, `rejected`, `transformed`, `ambiguous`, `cancelled`.

Exact-batch acknowledgement removes only the mutation identities named by the
response. Unrelated pending work stays pending.

## Read model

Reads start from the authoritative local base plus the ordered
pending/rejected/transformed overlay. Remote rows may be merged afterward.
Winners are chosen by protocol identity and canonical decimal revision, never
by arrival time. Object absence is never deletion; only an explicit tombstone
is. A stale HTTP or WebSocket payload cannot overwrite newer local, pending,
transformed, or confirmed state. Remote-acknowledged pending work stays off the
projected payload until confirmation. Durable rejection and transformation
remain visible after restart.

Provenance values exposed to application code: `authoritative`, `pending`,
`rejected`, `transformed`, `stale`.

Shared replay lives in
[`formal/consistency_vectors.v1.json`](../formal/consistency_vectors.v1.json).
The JSON Schema is
[`schema/opto-sync-consistency.v1.schema.json`](../schema/opto-sync-consistency.v1.schema.json).
The policy identifiers belong in `opto-sync-interfaces` once that repository
becomes the published contract source; this repository currently hosts the
executable schema and fixtures because it is where the clients compile and
test.
