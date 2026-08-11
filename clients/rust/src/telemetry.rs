//! Injection-only structured telemetry for opto-sync lifecycle adapters.
//!
//! The event shape is closed by
//! `schema/opto-sync-telemetry-event.schema.json`: there is deliberately no
//! payload, token, request, response, cookie, or arbitrary metadata field.
//! Applications adapt [`TelemetrySink`] to `oresoftware/next-loggers`; this
//! crate never installs a global OpenTelemetry provider and never owns logger
//! flush/shutdown.

use crate::protocol_sync::ProtocolSyncCycleResult;
use serde::Serialize;
use std::panic::{catch_unwind, AssertUnwindSafe};

pub const TELEMETRY_SCHEMA_VERSION: u8 = 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum TelemetryLevel {
    Debug,
    Info,
    Warn,
    Error,
}

/// Closed metadata allowlist shared with Dart, TypeScript, and the JSON Schema.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TelemetryFields {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub operation: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub table: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub record_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mutation_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub checkpoint: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pushed_mutations: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub acknowledged_mutations: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pulled_changes: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub installed_snapshots: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub has_more_pending: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub consecutive_failures: Option<usize>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TelemetryEvent {
    pub schema_version: u8,
    pub name: String,
    pub level: TelemetryLevel,
    pub fields: TelemetryFields,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TelemetryEventError;

impl std::fmt::Display for TelemetryEventError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("telemetry event does not conform to the canonical JSON Schema")
    }
}

impl std::error::Error for TelemetryEventError {}

fn valid_event_name(name: &str) -> bool {
    if name.len() > 128 || !name.starts_with("opto_sync.") {
        return false;
    }
    let segments: Vec<_> = name.split('.').collect();
    (3..=5).contains(&segments.len())
        && segments[1..].iter().all(|segment| {
            !segment.is_empty()
                && segment
                    .bytes()
                    .next()
                    .is_some_and(|byte| byte.is_ascii_lowercase())
                && segment
                    .bytes()
                    .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_')
        })
}

fn at_most(value: Option<&str>, max_chars: usize) -> bool {
    value.is_none_or(|value| value.chars().count() <= max_chars)
}

fn canonical_decimal(value: Option<&str>) -> bool {
    let Some(value) = value else {
        return true;
    };
    let mut bytes = value.bytes();
    match bytes.next() {
        Some(b'0') => bytes.next().is_none(),
        Some(b'1'..=b'9') => bytes.all(|byte| byte.is_ascii_digit()),
        _ => false,
    }
}

fn valid_code(value: Option<&str>) -> bool {
    value.is_none_or(|value| {
        (1..=64).contains(&value.len())
            && value
                .bytes()
                .next()
                .is_some_and(|byte| byte.is_ascii_uppercase())
            && value
                .bytes()
                .all(|byte| byte.is_ascii_uppercase() || byte.is_ascii_digit() || byte == b'_')
    })
}

fn valid_fields(fields: &TelemetryFields) -> bool {
    at_most(fields.operation.as_deref(), 64)
        && at_most(fields.table.as_deref(), 63)
        && at_most(fields.record_id.as_deref(), 512)
        && canonical_decimal(fields.mutation_id.as_deref())
        && canonical_decimal(fields.checkpoint.as_deref())
        && at_most(fields.status.as_deref(), 48)
        && valid_code(fields.code.as_deref())
}

pub fn create_telemetry_event(
    name: impl Into<String>,
    level: TelemetryLevel,
    fields: TelemetryFields,
) -> Result<TelemetryEvent, TelemetryEventError> {
    let name = name.into();
    if !valid_event_name(&name) || !valid_fields(&fields) {
        return Err(TelemetryEventError);
    }
    Ok(TelemetryEvent {
        schema_version: TELEMETRY_SCHEMA_VERSION,
        name,
        level,
        fields,
    })
}

/// Minimal adapter seam for `oresoftware/next-loggers` or another sink.
pub trait TelemetrySink: Send + Sync {
    fn emit(&self, event: &TelemetryEvent) -> Result<(), String>;
}

impl<F> TelemetrySink for F
where
    F: Fn(&TelemetryEvent) -> Result<(), String> + Send + Sync,
{
    fn emit(&self, event: &TelemetryEvent) -> Result<(), String> {
        self(event)
    }
}

/// Best-effort emission. Logger errors and panics cannot alter sync behavior.
pub fn emit_telemetry(sink: Option<&dyn TelemetrySink>, event: &TelemetryEvent) {
    let Some(sink) = sink else {
        return;
    };
    let Ok(event) = create_telemetry_event(event.name.clone(), event.level, event.fields.clone())
    else {
        return;
    };
    let _ = catch_unwind(AssertUnwindSafe(|| sink.emit(&event)));
}

fn emit_lifecycle(
    sink: Option<&dyn TelemetrySink>,
    name: &str,
    level: TelemetryLevel,
    fields: TelemetryFields,
) {
    if let Ok(event) = create_telemetry_event(name, level, fields) {
        emit_telemetry(sink, &event);
    }
}

/// Observe an existing `ProtocolSyncDriver::sync_cycle` call without changing
/// its result. Only allowlisted counters/checkpoints are emitted; an error is
/// represented by a stable code, never by its possibly-sensitive message.
pub fn observe_sync_cycle<E, F>(
    sink: Option<&dyn TelemetrySink>,
    sync: F,
) -> Result<ProtocolSyncCycleResult, E>
where
    F: FnOnce() -> Result<ProtocolSyncCycleResult, E>,
{
    emit_lifecycle(
        sink,
        "opto_sync.sync.cycle_started",
        TelemetryLevel::Debug,
        TelemetryFields {
            operation: Some("protocolSyncCycle".to_string()),
            ..TelemetryFields::default()
        },
    );
    match sync() {
        Ok(result) => {
            emit_lifecycle(
                sink,
                "opto_sync.sync.cycle_succeeded",
                TelemetryLevel::Info,
                TelemetryFields {
                    operation: Some("protocolSyncCycle".to_string()),
                    checkpoint: Some(result.checkpoint.clone()),
                    pushed_mutations: Some(result.pushed_mutations),
                    acknowledged_mutations: Some(result.acknowledged_mutations),
                    pulled_changes: Some(result.pulled_changes),
                    installed_snapshots: Some(result.installed_snapshots),
                    has_more_pending: Some(result.has_more_pending),
                    ..TelemetryFields::default()
                },
            );
            Ok(result)
        }
        Err(error) => {
            emit_lifecycle(
                sink,
                "opto_sync.sync.cycle_failed",
                TelemetryLevel::Error,
                TelemetryFields {
                    operation: Some("protocolSyncCycle".to_string()),
                    code: Some("SYNC_CYCLE_FAILED".to_string()),
                    ..TelemetryFields::default()
                },
            );
            Err(error)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    fn result() -> ProtocolSyncCycleResult {
        ProtocolSyncCycleResult {
            pushed_mutations: 2,
            acknowledged_mutations: 2,
            pulled_changes: 1,
            installed_snapshots: 0,
            checkpoint: "9".to_string(),
            has_more_pending: false,
        }
    }

    #[test]
    fn failing_sink_cannot_change_successful_sync_result() {
        let calls = AtomicUsize::new(0);
        let sink = |_: &TelemetryEvent| -> Result<(), String> {
            calls.fetch_add(1, Ordering::SeqCst);
            Err("logger unavailable".to_string())
        };
        let expected = result();
        let actual = observe_sync_cycle(Some(&sink), || Ok::<_, ()>(expected.clone())).unwrap();
        assert_eq!(actual, expected);
        assert_eq!(calls.load(Ordering::SeqCst), 2);
    }

    #[test]
    fn panicking_sink_cannot_replace_sync_error() {
        let sink = |_: &TelemetryEvent| -> Result<(), String> { panic!("sink panic") };
        let error = observe_sync_cycle(Some(&sink), || Err::<ProtocolSyncCycleResult, _>("sync"))
            .unwrap_err();
        assert_eq!(error, "sync");
    }

    #[test]
    fn serialized_event_has_no_sensitive_payload_slot() {
        let event = create_telemetry_event(
            "opto_sync.sync.cycle_succeeded",
            TelemetryLevel::Info,
            TelemetryFields {
                checkpoint: Some("9".to_string()),
                ..TelemetryFields::default()
            },
        )
        .unwrap();
        let encoded = serde_json::to_value(event).unwrap();
        let fields = encoded["fields"].as_object().unwrap();
        assert!(!fields.contains_key("payload"));
        assert!(!fields.contains_key("token"));
        assert!(!fields.contains_key("request"));
        assert!(!fields.contains_key("response"));
    }

    #[test]
    fn event_factory_enforces_the_canonical_field_constraints() {
        let invalid_checkpoint = create_telemetry_event(
            "opto_sync.sync.cycle_succeeded",
            TelemetryLevel::Info,
            TelemetryFields {
                checkpoint: Some("09".to_string()),
                ..TelemetryFields::default()
            },
        );
        assert_eq!(invalid_checkpoint, Err(TelemetryEventError));

        let invalid_code = create_telemetry_event(
            "opto_sync.sync.cycle_failed",
            TelemetryLevel::Error,
            TelemetryFields {
                code: Some("contains-sensitive-text".to_string()),
                ..TelemetryFields::default()
            },
        );
        assert_eq!(invalid_code, Err(TelemetryEventError));
    }

    #[test]
    fn final_sink_boundary_rejects_a_hand_written_invalid_event() {
        let calls = AtomicUsize::new(0);
        let sink = |_: &TelemetryEvent| -> Result<(), String> {
            calls.fetch_add(1, Ordering::SeqCst);
            Ok(())
        };
        let event = TelemetryEvent {
            schema_version: TELEMETRY_SCHEMA_VERSION,
            name: "opto_sync.sync.cycle_succeeded".to_string(),
            level: TelemetryLevel::Info,
            fields: TelemetryFields {
                checkpoint: Some("09".to_string()),
                ..TelemetryFields::default()
            },
        };
        emit_telemetry(Some(&sink), &event);
        assert_eq!(calls.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn invalid_result_metadata_cannot_change_the_sync_result() {
        let calls = AtomicUsize::new(0);
        let sink = |_: &TelemetryEvent| -> Result<(), String> {
            calls.fetch_add(1, Ordering::SeqCst);
            Ok(())
        };
        let mut expected = result();
        expected.checkpoint = "09".to_string();
        let actual = observe_sync_cycle(Some(&sink), || Ok::<_, ()>(expected.clone())).unwrap();
        assert_eq!(actual, expected);
        assert_eq!(calls.load(Ordering::SeqCst), 1);
    }
}
