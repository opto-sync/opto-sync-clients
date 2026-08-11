//! Fail-open delivery for the canonical Ores/OpenTelemetry bridge record.
//!
//! Records are always rebuilt from [`ProtocolSyncTelemetryInput`] at the final
//! sink boundary. This crate never installs a global provider, owns logger
//! shutdown, or exposes payload/checkpoint/record fields to the sink.

use crate::observability::{
    create_protocol_sync_telemetry_record, OresOpenTelemetryLogRecord,
    ProtocolSyncTelemetryInput,
};
use std::panic::{catch_unwind, AssertUnwindSafe};

/// Minimal application-owned adapter seam for `oresoftware/next-loggers`.
pub trait ProtocolSyncTelemetrySink: Send + Sync {
    fn emit(&self, record: &OresOpenTelemetryLogRecord) -> Result<(), String>;
}

impl<F> ProtocolSyncTelemetrySink for F
where
    F: Fn(&OresOpenTelemetryLogRecord) -> Result<(), String> + Send + Sync,
{
    fn emit(&self, record: &OresOpenTelemetryLogRecord) -> Result<(), String> {
        self(record)
    }
}

/// Build and deliver one canonical record without changing sync behavior.
///
/// Invalid derived metadata, sink errors, and sink panics are all contained at
/// this boundary.
pub fn emit_protocol_sync_telemetry(
    sink: Option<&dyn ProtocolSyncTelemetrySink>,
    input: ProtocolSyncTelemetryInput<'_>,
) {
    let Some(sink) = sink else {
        return;
    };
    let Ok(record) = create_protocol_sync_telemetry_record(input) else {
        return;
    };
    let _ = catch_unwind(AssertUnwindSafe(|| sink.emit(&record)));
}

/// Backwards-compatible trait spelling for application adapters.
pub use ProtocolSyncTelemetrySink as TelemetrySink;

/// Backwards-compatible function spelling; prefer
/// [`emit_protocol_sync_telemetry`].
pub use emit_protocol_sync_telemetry as emit_telemetry;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::observability::{
        ProtocolSyncTelemetryKind, ProtocolSyncTelemetryRuntime,
        ProtocolSyncTelemetryStatus,
    };
    use std::sync::atomic::{AtomicUsize, Ordering};

    fn input<'a>(request_id: Option<&'a str>) -> ProtocolSyncTelemetryInput<'a> {
        ProtocolSyncTelemetryInput {
            runtime: ProtocolSyncTelemetryRuntime::Rust,
            kind: ProtocolSyncTelemetryKind::StateChanged,
            status: ProtocolSyncTelemetryStatus::Idle,
            consecutive_failures: 0,
            timestamp: "2026-08-11T17:53:28.151Z",
            next_retry_at: None,
            cycle: None,
            error_code: None,
            request_id,
            trace_id: None,
            span_id: None,
            trace_flags: None,
            trace_state: None,
        }
    }

    #[test]
    fn failing_sink_is_contained() {
        let calls = AtomicUsize::new(0);
        let sink = |_: &OresOpenTelemetryLogRecord| -> Result<(), String> {
            calls.fetch_add(1, Ordering::SeqCst);
            Err("logger unavailable".to_string())
        };
        emit_protocol_sync_telemetry(Some(&sink), input(Some("sync-cycle-42")));
        assert_eq!(calls.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn panicking_sink_is_contained() {
        let sink = |_: &OresOpenTelemetryLogRecord| -> Result<(), String> {
            panic!("sink panic")
        };
        emit_protocol_sync_telemetry(Some(&sink), input(Some("sync-cycle-42")));
    }

    #[test]
    fn invalid_metadata_never_reaches_the_sink() {
        let calls = AtomicUsize::new(0);
        let sink = |_: &OresOpenTelemetryLogRecord| -> Result<(), String> {
            calls.fetch_add(1, Ordering::SeqCst);
            Ok(())
        };
        emit_protocol_sync_telemetry(Some(&sink), input(Some("bad/id")));
        assert_eq!(calls.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn record_has_no_sensitive_payload_or_checkpoint_slot() {
        let sink = |record: &OresOpenTelemetryLogRecord| -> Result<(), String> {
            let encoded = serde_json::to_value(record).unwrap();
            assert!(encoded.get("payload").is_none());
            assert!(encoded.get("checkpoint").is_none());
            assert!(encoded["attributes"].get("payload").is_none());
            assert!(encoded["attributes"].get("checkpoint").is_none());
            Ok(())
        };
        emit_protocol_sync_telemetry(Some(&sink), input(Some("sync-cycle-42")));
    }
}
