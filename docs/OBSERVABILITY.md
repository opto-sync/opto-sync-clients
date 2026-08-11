# ORE-compatible sync telemetry

Opto-Sync exposes one privacy-bounded record for Rust, Dart, and TypeScript:

- schema: [`schema/opto-sync-telemetry.schema.json`](../schema/opto-sync-telemetry.schema.json)
- wire contract: `opto-sync.telemetry/v1`
- upstream envelope: the explicit OpenTelemetry bridge record from
  [`ores-otel/ores.otel.log`](https://github.com/ores-otel/ores.otel.log)
- `request.id` follows the bounded request-context identifier from
  [`ores-otel/ores-interfaces`](https://github.com/ores-otel/ores-interfaces);
  `traceId`, `spanId`, `traceFlags`, and `traceState` follow bounded W3C trace
  fields

The clients create records but never register a global OpenTelemetry provider,
select an exporter, or send data. The application owns the ORE logger and its
transport. A telemetry callback must also remain best effort: logging must not
change sync correctness or retry behavior.

## Privacy boundary

The schema is a strict subset of the ORE OpenTelemetry bridge. The helpers
expose only bounded sync state, aggregate counters, stable error codes, and
correlation identifiers; they expose no dedicated fields for:

- mutation payloads or authoritative records;
- table names, record IDs, client IDs, mutation IDs, or pull checkpoints;
- URLs, request/response bodies, headers, tokens, or credentials;
- raw exception messages or stack traces.

`lastError` remains useful local diagnostic state, but the telemetry helpers do
not accept it. Convert known failures to a stable uppercase code such as
`SYNC_TRANSPORT_ERROR`; keep the original error in an access-controlled local
log if the application needs it.

String fields are not secret scanners. Callers must use only non-secret,
low-cardinality values for `error.code`, `request.id`, and `traceState`; never
encode tokens, URLs, domain record identifiers, or personal data into them.

## TypeScript

```ts
import {
  ProtocolSyncLoop,
  createProtocolSyncTelemetryRecord,
  protocolSyncStateTelemetry,
} from '@opto-sync/client';

const emit = (record: object) => applicationOwnedOresSink(record);
const loop = new ProtocolSyncLoop(queue, transport, callbacks, {
  onStateChange(state) {
    emit(protocolSyncStateTelemetry('typescript', state, {
      timestamp: new Date(),
    }));
  },
});

const result = await loop.syncNow();
emit(createProtocolSyncTelemetryRecord({
  runtime: 'typescript',
  kind: 'cycle.completed',
  status: 'idle',
  cycle: result,
}));
```

## Dart

```dart
final loop = ProtocolSyncLoop(
  queue,
  transport,
  callbacks,
  onStateChange: (state) {
    oresSink(
      protocolSyncStateTelemetry(
        ProtocolSyncTelemetryRuntime.dart,
        state,
        timestamp: DateTime.now(),
      ),
    );
  },
);

final result = await loop.syncNow();
oresSink(
  createProtocolSyncTelemetryRecord(
    ProtocolSyncTelemetryInput(
      runtime: ProtocolSyncTelemetryRuntime.dart,
      kind: ProtocolSyncTelemetryKind.cycleCompleted,
      status: ProtocolSyncStatus.idle,
      timestamp: DateTime.now(),
      cycle: result,
    ),
  ),
);
```

## Rust

All runtimes require the application to supply the event time. Rust accepts the
canonical RFC 3339 text directly; Dart and TypeScript normalize their native
time values to that same wire representation.

```rust
use opto_sync_client::{
    create_protocol_sync_telemetry_record, ProtocolSyncTelemetryInput,
    ProtocolSyncTelemetryKind, ProtocolSyncTelemetryRuntime,
    ProtocolSyncTelemetryStatus,
};

let result = driver.sync_cycle(&mut queue, &mut transport, &mut callbacks, &mut persistence)?;
let record = create_protocol_sync_telemetry_record(ProtocolSyncTelemetryInput {
    runtime: ProtocolSyncTelemetryRuntime::Rust,
    kind: ProtocolSyncTelemetryKind::CycleCompleted,
    status: ProtocolSyncTelemetryStatus::Idle,
    consecutive_failures: 0,
    timestamp: "2026-08-11T17:53:28.151Z",
    next_retry_at: None,
    cycle: Some(&result),
    error_code: None,
    request_id: None,
    trace_id: None,
    span_id: None,
    trace_flags: None,
    trace_state: None,
})?;
application_owned_ores_sink(record);
```

## Zed dependency gate

The intended Zed dependencies are:

```toml
[dependencies]
"ores-otel/ores-interfaces" = "^0.1.0"
"oresoftware/next-loggers" = "^0.1.0"
```

They are not yet declared in the source manifest. As of this contract change,
both upstream repositories have version `0.1.0` manifests but no release tag,
and the Node logger package is not present in its native registry. Adding the
requirements now would make a clean `zed install --frozen` impossible and
would misrepresent the empty lockfile as resolved provenance.

The dependency change is ready only when all of these gates pass:

1. both upstream coordinates have immutable `v0.1.0` releases in the Zed
   registry;
2. language-native artifacts used by the target matrix are published;
3. `zed add` resolves the two packages and produces a committed lock with
   matching hashes and source commits;
4. a clean directory can run `zed install --frozen` without sibling checkouts;
5. `opto-sync-test` canaries exercise Rust, Dart, and TypeScript against the
   same telemetry fixture.

Until then, the explicit bridge record keeps applications compatible with ORE
without introducing a dependency that cannot be reproduced.
