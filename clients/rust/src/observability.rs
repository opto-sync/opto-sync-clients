//! Privacy-bounded records for an application-owned `ores.otel.log` transport.
//!
//! This module has no exporter and installs no global OpenTelemetry provider.
//! It exposes no fields for queue payloads, domain record identifiers,
//! checkpoints, URLs, headers, or raw error messages. Callers must still pass
//! only non-secret machine codes and correlation values.

use crate::protocol_sync::ProtocolSyncCycleResult;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

pub const OPTO_SYNC_TELEMETRY_SCHEMA: &str = "opto-sync.telemetry/v1";
const MAXIMUM_SAFE_INTEGER: u128 = 9_007_199_254_740_991;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProtocolSyncTelemetryRuntime {
    TypeScript,
    Dart,
    Rust,
}

impl ProtocolSyncTelemetryRuntime {
    fn as_str(self) -> &'static str {
        match self {
            Self::TypeScript => "typescript",
            Self::Dart => "dart",
            Self::Rust => "rust",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProtocolSyncTelemetryKind {
    StateChanged,
    CycleCompleted,
    CycleFailed,
}

impl ProtocolSyncTelemetryKind {
    fn event_name(self) -> &'static str {
        match self {
            Self::StateChanged => "opto.sync.state.changed",
            Self::CycleCompleted => "opto.sync.cycle.completed",
            Self::CycleFailed => "opto.sync.cycle.failed",
        }
    }

    fn body(self) -> &'static str {
        match self {
            Self::StateChanged => "opto-sync state changed",
            Self::CycleCompleted => "opto-sync sync cycle completed",
            Self::CycleFailed => "opto-sync sync cycle failed",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProtocolSyncTelemetryStatus {
    Stopped,
    Idle,
    Syncing,
    Offline,
    Backoff,
    Error,
}

impl ProtocolSyncTelemetryStatus {
    fn as_str(self) -> &'static str {
        match self {
            Self::Stopped => "stopped",
            Self::Idle => "idle",
            Self::Syncing => "syncing",
            Self::Offline => "offline",
            Self::Backoff => "backoff",
            Self::Error => "error",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OresOpenTelemetryLogRecord {
    pub body: String,
    pub severity_text: String,
    pub severity_number: u8,
    pub timestamp: String,
    pub attributes: Map<String, Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub trace_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub span_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub trace_flags: Option<u8>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub trace_state: Option<String>,
}

pub struct ProtocolSyncTelemetryInput<'a> {
    pub runtime: ProtocolSyncTelemetryRuntime,
    pub kind: ProtocolSyncTelemetryKind,
    pub status: ProtocolSyncTelemetryStatus,
    pub consecutive_failures: u32,
    /// Canonical UTC timestamp with millisecond precision.
    pub timestamp: &'a str,
    pub next_retry_at: Option<&'a str>,
    pub cycle: Option<&'a ProtocolSyncCycleResult>,
    /// Stable uppercase machine code only; never a raw error message.
    pub error_code: Option<&'a str>,
    /// Correlation identifier from the `ores-interfaces` request context.
    pub request_id: Option<&'a str>,
    pub trace_id: Option<&'a str>,
    pub span_id: Option<&'a str>,
    pub trace_flags: Option<u8>,
    pub trace_state: Option<&'a str>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProtocolSyncTelemetryError {
    MissingCycleResult,
    MissingErrorCode,
    InvalidErrorCode,
    InvalidRequestId,
    InvalidTimestamp,
    InvalidTraceId,
    InvalidSpanId,
    TraceStateTooLong,
    CountOutOfRange(&'static str),
}

impl std::fmt::Display for ProtocolSyncTelemetryError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::MissingCycleResult => {
                formatter.write_str("cycle-completed telemetry requires a cycle result")
            }
            Self::MissingErrorCode => {
                formatter.write_str("cycle-failed telemetry requires a stable error code")
            }
            Self::InvalidErrorCode => {
                formatter.write_str("error code must be a stable uppercase machine code")
            }
            Self::InvalidRequestId => {
                formatter.write_str("request id is not a valid ores-interfaces identifier")
            }
            Self::InvalidTimestamp => {
                formatter.write_str("timestamp must be canonical UTC with millisecond precision")
            }
            Self::InvalidTraceId => {
                formatter.write_str("trace id must be a non-zero lowercase W3C trace id")
            }
            Self::InvalidSpanId => {
                formatter.write_str("span id must be a non-zero lowercase W3C span id")
            }
            Self::TraceStateTooLong => formatter.write_str("trace state exceeds 512 characters"),
            Self::CountOutOfRange(name) => {
                write!(formatter, "{name} exceeds the interoperable integer range")
            }
        }
    }
}

impl std::error::Error for ProtocolSyncTelemetryError {}

fn canonical_timestamp(value: &str) -> bool {
    let bytes = value.as_bytes();
    if bytes.len() != 24
        || bytes[4] != b'-'
        || bytes[7] != b'-'
        || bytes[10] != b'T'
        || bytes[13] != b':'
        || bytes[16] != b':'
        || bytes[19] != b'.'
        || bytes[23] != b'Z'
    {
        return false;
    }
    for (start, end) in [
        (0, 4),
        (5, 7),
        (8, 10),
        (11, 13),
        (14, 16),
        (17, 19),
        (20, 23),
    ] {
        if !bytes[start..end].iter().all(u8::is_ascii_digit) {
            return false;
        }
    }
    let number = |start: usize, end: usize| value[start..end].parse::<u16>().unwrap_or(u16::MAX);
    let year = number(0, 4);
    let month = number(5, 7);
    let day = number(8, 10);
    let leap_year = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    let days_in_month = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if leap_year => 29,
        2 => 28,
        _ => return false,
    };
    (1..=days_in_month).contains(&day)
        && number(11, 13) <= 23
        && number(14, 16) <= 59
        && number(17, 19) <= 59
}

fn valid_error_code(value: &str) -> bool {
    let bytes = value.as_bytes();
    (1..=128).contains(&bytes.len())
        && bytes[0].is_ascii_uppercase()
        && bytes[1..]
            .iter()
            .all(|byte| byte.is_ascii_uppercase() || byte.is_ascii_digit() || b"_.-".contains(byte))
}

fn valid_request_id(value: &str) -> bool {
    let bytes = value.as_bytes();
    (8..=128).contains(&bytes.len())
        && bytes
            .iter()
            .all(|byte| byte.is_ascii_alphanumeric() || b"._:-".contains(byte))
}

fn valid_hex_id(value: &str, length: usize) -> bool {
    value.len() == length
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        && value.bytes().any(|byte| byte != b'0')
}

fn insert_count(
    attributes: &mut Map<String, Value>,
    key: &'static str,
    name: &'static str,
    value: usize,
) -> Result<(), ProtocolSyncTelemetryError> {
    if value as u128 > MAXIMUM_SAFE_INTEGER {
        return Err(ProtocolSyncTelemetryError::CountOutOfRange(name));
    }
    attributes.insert(key.to_string(), Value::from(value as u64));
    Ok(())
}

/// Build the shared privacy-bounded OpenTelemetry bridge record.
pub fn create_protocol_sync_telemetry_record(
    input: ProtocolSyncTelemetryInput<'_>,
) -> Result<OresOpenTelemetryLogRecord, ProtocolSyncTelemetryError> {
    if input.consecutive_failures > i32::MAX as u32 {
        return Err(ProtocolSyncTelemetryError::CountOutOfRange(
            "consecutive_failures",
        ));
    }
    if !canonical_timestamp(input.timestamp)
        || input
            .next_retry_at
            .is_some_and(|value| !canonical_timestamp(value))
    {
        return Err(ProtocolSyncTelemetryError::InvalidTimestamp);
    }
    if input.kind == ProtocolSyncTelemetryKind::CycleCompleted && input.cycle.is_none() {
        return Err(ProtocolSyncTelemetryError::MissingCycleResult);
    }
    if input.kind == ProtocolSyncTelemetryKind::CycleFailed && input.error_code.is_none() {
        return Err(ProtocolSyncTelemetryError::MissingErrorCode);
    }
    if input
        .error_code
        .is_some_and(|value| !valid_error_code(value))
    {
        return Err(ProtocolSyncTelemetryError::InvalidErrorCode);
    }
    if input
        .request_id
        .is_some_and(|value| !valid_request_id(value))
    {
        return Err(ProtocolSyncTelemetryError::InvalidRequestId);
    }
    if input.trace_id.is_some_and(|value| !valid_hex_id(value, 32)) {
        return Err(ProtocolSyncTelemetryError::InvalidTraceId);
    }
    if input.span_id.is_some_and(|value| !valid_hex_id(value, 16)) {
        return Err(ProtocolSyncTelemetryError::InvalidSpanId);
    }
    if input
        .trace_state
        .is_some_and(|value| value.chars().count() > 512)
    {
        return Err(ProtocolSyncTelemetryError::TraceStateTooLong);
    }

    let mut attributes = Map::from_iter([
        (
            "service.name".to_string(),
            Value::String("opto-sync".to_string()),
        ),
        (
            "event.name".to_string(),
            Value::String(input.kind.event_name().to_string()),
        ),
        (
            "opto.sync.schema".to_string(),
            Value::String(OPTO_SYNC_TELEMETRY_SCHEMA.to_string()),
        ),
        (
            "opto.sync.runtime".to_string(),
            Value::String(input.runtime.as_str().to_string()),
        ),
        (
            "opto.sync.status".to_string(),
            Value::String(input.status.as_str().to_string()),
        ),
        (
            "opto.sync.consecutive_failures".to_string(),
            Value::from(input.consecutive_failures),
        ),
    ]);
    if let Some(value) = input.next_retry_at {
        attributes.insert(
            "opto.sync.next_retry_at".to_string(),
            Value::String(value.to_string()),
        );
    }
    if let Some(value) = input.error_code {
        attributes.insert("error.code".to_string(), Value::String(value.to_string()));
    }
    if let Some(value) = input.request_id {
        attributes.insert("request.id".to_string(), Value::String(value.to_string()));
    }
    if let Some(cycle) = input
        .cycle
        .filter(|_| input.kind == ProtocolSyncTelemetryKind::CycleCompleted)
    {
        insert_count(
            &mut attributes,
            "opto.sync.pushed_mutations",
            "cycle.pushed_mutations",
            cycle.pushed_mutations,
        )?;
        insert_count(
            &mut attributes,
            "opto.sync.acknowledged_mutations",
            "cycle.acknowledged_mutations",
            cycle.acknowledged_mutations,
        )?;
        insert_count(
            &mut attributes,
            "opto.sync.pulled_changes",
            "cycle.pulled_changes",
            cycle.pulled_changes,
        )?;
        insert_count(
            &mut attributes,
            "opto.sync.installed_snapshots",
            "cycle.installed_snapshots",
            cycle.installed_snapshots,
        )?;
        attributes.insert(
            "opto.sync.has_more_pending".to_string(),
            Value::Bool(cycle.has_more_pending),
        );
    }

    let (severity_text, severity_number) = if input.kind == ProtocolSyncTelemetryKind::CycleFailed {
        ("ERROR", 17)
    } else if input.kind == ProtocolSyncTelemetryKind::CycleCompleted {
        ("INFO", 9)
    } else if input.status == ProtocolSyncTelemetryStatus::Error {
        ("ERROR", 17)
    } else if matches!(
        input.status,
        ProtocolSyncTelemetryStatus::Backoff | ProtocolSyncTelemetryStatus::Offline
    ) {
        ("WARN", 13)
    } else {
        ("INFO", 9)
    };
    Ok(OresOpenTelemetryLogRecord {
        body: input.kind.body().to_string(),
        severity_text: severity_text.to_string(),
        severity_number,
        timestamp: input.timestamp.to_string(),
        attributes,
        trace_id: input.trace_id.map(str::to_string),
        span_id: input.span_id.map(str::to_string),
        trace_flags: input.trace_flags,
        trace_state: input.trace_state.map(str::to_string),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cycle() -> ProtocolSyncCycleResult {
        ProtocolSyncCycleResult {
            pushed_mutations: 3,
            acknowledged_mutations: 3,
            pulled_changes: 2,
            installed_snapshots: 0,
            checkpoint: "private-high-cardinality-value".to_string(),
            has_more_pending: false,
        }
    }

    #[test]
    fn cycle_record_matches_the_shared_ore_fixture() {
        let cycle = cycle();
        let record = create_protocol_sync_telemetry_record(ProtocolSyncTelemetryInput {
            runtime: ProtocolSyncTelemetryRuntime::TypeScript,
            kind: ProtocolSyncTelemetryKind::CycleCompleted,
            status: ProtocolSyncTelemetryStatus::Idle,
            consecutive_failures: 0,
            timestamp: "2026-08-11T17:53:28.151Z",
            next_retry_at: None,
            cycle: Some(&cycle),
            error_code: None,
            request_id: Some("sync-cycle-42"),
            trace_id: Some("0123456789abcdef0123456789abcdef"),
            span_id: Some("0123456789abcdef"),
            trace_flags: Some(1),
            trace_state: None,
        })
        .unwrap();
        let actual = serde_json::to_value(record).unwrap();
        let expected: Value = serde_json::from_str(include_str!(
            "../../../schema/telemetry-fixtures/valid/cycle-completed.json"
        ))
        .unwrap();
        assert_eq!(actual, expected);
        assert!(!actual
            .to_string()
            .contains("private-high-cardinality-value"));
    }

    #[test]
    fn raw_error_text_cannot_be_mistaken_for_a_machine_code() {
        let result = create_protocol_sync_telemetry_record(ProtocolSyncTelemetryInput {
            runtime: ProtocolSyncTelemetryRuntime::Rust,
            kind: ProtocolSyncTelemetryKind::CycleFailed,
            status: ProtocolSyncTelemetryStatus::Error,
            consecutive_failures: 1,
            timestamp: "2026-08-11T17:53:28.151Z",
            next_retry_at: None,
            cycle: None,
            error_code: Some("raw exception message is not a code"),
            request_id: None,
            trace_id: None,
            span_id: None,
            trace_flags: None,
            trace_state: None,
        });
        assert_eq!(result, Err(ProtocolSyncTelemetryError::InvalidErrorCode));
    }

    #[test]
    fn request_ids_match_the_ores_interfaces_contract() {
        for request_id in ["short", "invalid/request-id"] {
            let result = create_protocol_sync_telemetry_record(ProtocolSyncTelemetryInput {
                runtime: ProtocolSyncTelemetryRuntime::Rust,
                kind: ProtocolSyncTelemetryKind::StateChanged,
                status: ProtocolSyncTelemetryStatus::Idle,
                consecutive_failures: 0,
                timestamp: "2026-08-11T17:53:28.151Z",
                next_retry_at: None,
                cycle: None,
                error_code: None,
                request_id: Some(request_id),
                trace_id: None,
                span_id: None,
                trace_flags: None,
                trace_state: None,
            });
            assert_eq!(result, Err(ProtocolSyncTelemetryError::InvalidRequestId));
        }
    }

    #[test]
    fn impossible_calendar_dates_are_rejected() {
        let result = create_protocol_sync_telemetry_record(ProtocolSyncTelemetryInput {
            runtime: ProtocolSyncTelemetryRuntime::Rust,
            kind: ProtocolSyncTelemetryKind::StateChanged,
            status: ProtocolSyncTelemetryStatus::Idle,
            consecutive_failures: 0,
            timestamp: "2026-02-31T17:53:28.151Z",
            next_retry_at: None,
            cycle: None,
            error_code: None,
            request_id: None,
            trace_id: None,
            span_id: None,
            trace_flags: None,
            trace_state: None,
        });
        assert_eq!(result, Err(ProtocolSyncTelemetryError::InvalidTimestamp));
    }
}
