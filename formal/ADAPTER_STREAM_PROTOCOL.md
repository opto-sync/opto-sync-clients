# Streaming implementation-adapter protocol v1

`fm.adapter.stream.v1` is the language-neutral subprocess boundary for replaying
formal-model actions against production implementations. A runner writes one
UTF-8 JSON object per line to adapter stdin. The adapter writes one response
object per request to stdout. Logs, traces, and human diagnostics go to stderr.

The authoritative machine-readable contract is
`formal/adapter-stream-protocol.schema.json`. The Rust reference parser and
session validator live in `tools/fmctl/src/adapter_stream.rs`. Byte-oriented
transcript fixtures live under `formal/protocol-fixtures/stream/` and are the
starting golden corpus for Rust, TypeScript, Dart, Go, and Gleam SDKs.

## Compatibility with the existing replay contract

The repository already uses `fmctl.adapter.v1`, a successful batch contract in
which `fmctl replay` sends a complete trace list to a short-lived adapter and
receives one summary response. That contract remains supported and is not
silently reinterpreted.

The streaming protocol is a second, separately versioned contract for adapters
that need deterministic reset/apply/observe/snapshot/fault interaction. A future
`fmctl replay --protocol stream` bridge may translate ITF states into these
messages, but existing Rust, TypeScript, and Dart batch adapters continue to use
`fmctl.adapter.v1` until each is explicitly migrated and cross-checked.

## Framing and process rules

- Exactly one JSON object appears on each line.
- Messages are at most 1 MiB before the line terminator.
- Stdout is protocol-only. Any non-protocol stdout is a hard failure.
- Stderr is bounded separately by the runner and must redact credentials/tokens.
- The adapter runs as an untrusted child process with a whole-process timeout,
  per-message timeout, output limits, deterministic environment allowlist, and
  process-tree termination on failure or cancellation.
- Unknown fields, protocol versions, operation names, or outcome shapes fail
  closed.
- The first request is `hello` at generation zero.
- Requests are serial. A second request cannot be sent before the first response.
- `requestId` is a strictly increasing canonical unsigned decimal string bounded
  to JavaScript's exactly representable integer range (`2^53 - 1`) so every SDK
  can compare it without loss.
- Every response echoes protocol, version, request ID, machine, generation, and
  operation. A mismatch is rejected before its payload is interpreted.

## Session generations

Generation zero contains the handshake and may contain read-only operations.
Every successful `reset` advances the generation by exactly one. Every other
request uses the current generation. Failed or unsupported resets do not advance
it.

This makes a delayed response from an older reset generation unambiguously
stale. SDKs must not silently apply such responses to the new implementation
state.

## Operations

| Operation | Purpose | Required behavior |
| --- | --- | --- |
| `hello` | Negotiate implementation identity and capabilities. | Success returns language, name, version, canonical-state schema hash, and capabilities. `reset`, `apply`, `observe`, and `close` are mandatory. |
| `reset` | Install the model-provided initial state, seed, and logical time. | Success creates the next generation and discards older volatile work. |
| `apply` | Execute one named abstract action with canonical JSON arguments and logical time. | Side effects must be deterministic under the injected dependencies declared by the adapter. |
| `observe` | Return the canonical abstract state and any externally visible result. | Must not leak incidental storage/framework layout into the comparison surface. |
| `settle` | Drain bounded asynchronous work/timers. | Optional and bounded by `maxSteps`; never waits indefinitely. |
| `snapshot` | Return restart/persistence state plus its schema hash. | Optional. The returned snapshot must be self-contained for the declared boundary. |
| `restore` | Restore a snapshot with an exact schema hash. | Optional. Schema mismatch fails closed. |
| `fault` | Inject a declared storage/network/clock/process fault. | Optional. Only advertised fault names may execute. |
| `close` | Terminate the session cleanly. | Mandatory. Success is the terminal protocol message. |

Each response outcome is exactly one of:

- `ok` with a canonical JSON `value`;
- `error` with a structured code/message/retryability/data object; or
- `unsupported` with a structured error explaining an optional capability.

A capability not advertised by `hello` cannot later return `ok`.

## Canonical JSON and ITF values

Cross-language comparison uses a deliberately small canonical JSON profile:

1. Object keys are ordered lexicographically by Unicode scalar value.
2. Ordinary array order is preserved.
3. JSON floating-point numbers are forbidden. Protocol integers should normally
   use ITF `{"#bigint":"<canonical decimal>"}` values when host-language width
   could differ.
4. `#bigint` uses a canonical decimal string: no leading zeroes, no plus sign,
   and no negative zero.
5. `#set` members are recursively canonicalized, sorted by their compact
   canonical encoding, and duplicate canonical values are rejected.
6. `#map` entries are `[key, value]` pairs, sorted by the canonical key encoding;
   duplicate canonical keys are rejected.
7. Tagged records/unions remain ordinary objects and follow the object-key rule.

This profile is not presented as a complete implementation of RFC 8785. It is a
formal-adapter subset chosen for byte-for-byte portability across the initial
SDK languages.

## Golden transcripts

The fixture corpus includes:

- a complete successful lifecycle with reset, apply, observe, settle, snapshot,
  restore, fault, and close;
- an optional snapshot operation returning `unsupported` after capability
  negotiation;
- a duplicate request-ID failure; and
- a stale-generation failure after reset.

Every SDK must parse these transcripts, emit the same canonical representation,
and reject the negative transcripts at the same semantic boundary. Product
adapters add their own model-generated traces on top of this shared corpus.

## Security and correctness boundary

This protocol establishes deterministic framing, correlation, canonicalization,
and session-ordering rules. It does not prove that a product adapter exposes the
right abstraction, that its implementation refines the formal model, or that an
external storage/network system satisfies its assumptions. Those claims require
product-owned model traces, implementation replay, fault/crash tests, exact
bounds, and explicit assumptions in the resulting verification report.
