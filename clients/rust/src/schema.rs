//! Envelope validation for the shared ingest schema.
//!
//! The single source of truth for the envelope shape is
//! `opto-sync-clients/schema/opto-sync-envelope.schema.json`; this validator
//! MUST accept/reject exactly the shared fixture corpus in `schema/fixtures/`,
//! the same corpus the TypeScript (zod), Dart, and Gleam validators are held
//! to. `tests/schema_ingest.rs` walks that directory rather than restating the
//! cases, so a fixture added for any one language binds all four.
//!
//! The patterns are hand-rolled rather than delegated to `regex`. They are five
//! fixed, simple shapes, and this crate keeps a deliberately small dependency
//! graph pinned to a certified MSRV (see the `rusqlite`/`tungstenite` pins in
//! `Cargo.toml`); pulling a regex engine in to match `[0-9]{13}` would not be a
//! fair trade. Each checker names the pattern it implements so the two stay
//! comparable by eye.

use serde_json::Value;
use std::fmt;

/// `^[A-Za-z_][A-Za-z0-9_]{0,62}$` — SQL-safe table identifier.
fn is_identifier(s: &str) -> bool {
    let mut chars = s.chars();
    match chars.next() {
        Some(c) if c.is_ascii_alphabetic() || c == '_' => {}
        _ => return false,
    }
    let rest = &s[1..];
    rest.len() <= 62 && rest.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
}

/// `^[0-9]{1,20}$` — pure-digit epoch string.
fn is_digits(s: &str) -> bool {
    !s.is_empty() && s.len() <= 20 && s.bytes().all(|b| b.is_ascii_digit())
}

/// `^(?:0|[1-9][0-9]*)$` — canonical decimal, no leading zeros.
fn is_decimal_string(s: &str) -> bool {
    match s.as_bytes() {
        [] => false,
        [b'0'] => true,
        [b'0', ..] => false,
        bytes => bytes.iter().all(u8::is_ascii_digit),
    }
}

/// `^[0-9]{13}-[0-9a-f]{4}-[^-]{1,128}$` — native HLC, as emitted by
/// [`crate::clock::format_hlc`].
///
/// This is not redundant with [`is_iso8601`]: `1753876800123-0001-devA.t1`
/// matches neither that pattern nor [`is_digits`], so without this check the
/// validator rejects the timestamps this very crate produces.
fn is_native_hlc(s: &str) -> bool {
    let mut parts = s.split('-');
    let (Some(millis), Some(counter), Some(node)) = (parts.next(), parts.next(), parts.next())
    else {
        return false;
    };
    // A nodeId may not contain '-' (the clock constructor rejects it), so a
    // fourth segment means this is not an HLC.
    if parts.next().is_some() {
        return false;
    }
    millis.len() == 13
        && millis.bytes().all(|b| b.is_ascii_digit())
        && counter.len() == 4
        && counter.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        && !node.is_empty()
        && node.len() <= 128
}

/// `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?Z(-[0-9A-Za-z._~-]+)*$`
fn is_iso8601(s: &str) -> bool {
    fn digits(b: &[u8], n: usize) -> Option<&[u8]> {
        if b.len() >= n && b[..n].iter().all(u8::is_ascii_digit) {
            Some(&b[n..])
        } else {
            None
        }
    }
    fn lit(b: &[u8], c: u8) -> Option<&[u8]> {
        if b.first() == Some(&c) { Some(&b[1..]) } else { None }
    }

    let run = || -> Option<&[u8]> {
        let b = s.as_bytes();
        let b = digits(b, 4)?;
        let b = lit(b, b'-')?;
        let b = digits(b, 2)?;
        let b = lit(b, b'-')?;
        let b = digits(b, 2)?;
        let b = lit(b, b'T')?;
        let b = digits(b, 2)?;
        let b = lit(b, b':')?;
        let b = digits(b, 2)?;
        let b = lit(b, b':')?;
        let b = digits(b, 2)?;
        // Optional fractional seconds, 1..=9 digits.
        let b = if b.first() == Some(&b'.') {
            let frac = &b[1..];
            let n = frac.iter().take_while(|c| c.is_ascii_digit()).count();
            if !(1..=9).contains(&n) {
                return None;
            }
            &frac[n..]
        } else {
            b
        };
        lit(b, b'Z')
    };

    let Some(rest) = run() else { return false };
    if rest.is_empty() {
        return true;
    }
    // Zero or more `-<suffix>` groups, each non-empty over [0-9A-Za-z._~-].
    // The suffix charset includes '-', so split and require every group after
    // the first (empty) one to be non-empty.
    let Some(tail) = rest.strip_prefix(b"-") else {
        return false;
    };
    !tail.is_empty()
        && tail
            .iter()
            .all(|&b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'~' | b'-'))
}

fn is_timestamp(value: &Value) -> bool {
    match value {
        Value::Number(n) => n.as_u64().is_some(),
        Value::String(s) => is_digits(s) || is_native_hlc(s) || is_iso8601(s),
        _ => false,
    }
}

/// Raised when an envelope does not satisfy the shared schema. Carries every
/// issue, not just the first, so a malformed export can be fixed in one pass.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IngestValidationError {
    pub issues: Vec<String>,
}

impl fmt::Display for IngestValidationError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "envelope failed validation: {}", self.issues.join("; "))
    }
}

impl std::error::Error for IngestValidationError {}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Operation {
    Upsert,
    Delete,
}

#[derive(Debug, Clone, PartialEq)]
pub struct IngestRecord {
    pub table: String,
    pub record_id: String,
    pub operation: Operation,
    pub base_revision: Option<String>,
    pub payload: serde_json::Map<String, Value>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct IngestEnvelope {
    pub source: Option<String>,
    pub records: Vec<IngestRecord>,
}

const ENVELOPE_KEYS: [&str; 3] = ["formatVersion", "source", "records"];
const RECORD_KEYS: [&str; 5] = ["table", "recordId", "operation", "baseRevision", "payload"];

/// Validate a decoded JSON envelope.
pub fn validate_envelope(value: &Value) -> Result<IngestEnvelope, IngestValidationError> {
    let mut issues = Vec::new();

    let Some(root) = value.as_object() else {
        return Err(IngestValidationError {
            issues: vec!["<root>: expected an object".to_string()],
        });
    };

    for key in root.keys() {
        if !ENVELOPE_KEYS.contains(&key.as_str()) {
            issues.push(format!("<root>.{key}: unrecognized key"));
        }
    }
    match root.get("formatVersion") {
        Some(Value::Number(n)) if n.as_u64() == Some(1) => {}
        Some(_) => issues.push("<root>.formatVersion: must be 1".to_string()),
        None => issues.push("<root>.formatVersion: required".to_string()),
    }
    let source = match root.get("source") {
        None | Some(Value::Null) => None,
        Some(Value::String(s)) if s.chars().count() <= 200 => Some(s.clone()),
        Some(_) => {
            issues.push("<root>.source: must be a string of at most 200 characters".to_string());
            None
        }
    };

    let mut records = Vec::new();
    match root.get("records") {
        Some(Value::Array(items)) => {
            if items.is_empty() {
                issues.push("<root>.records: must contain at least one record".to_string());
            }
            for (index, item) in items.iter().enumerate() {
                match validate_record(item, index) {
                    Ok(record) => records.push(record),
                    Err(mut record_issues) => issues.append(&mut record_issues),
                }
            }
        }
        Some(_) => issues.push("<root>.records: must be an array".to_string()),
        None => issues.push("<root>.records: required".to_string()),
    }

    if issues.is_empty() {
        Ok(IngestEnvelope { source, records })
    } else {
        Err(IngestValidationError { issues })
    }
}

fn validate_record(value: &Value, index: usize) -> Result<IngestRecord, Vec<String>> {
    let where_ = format!("records.{index}");
    let mut issues = Vec::new();

    let Some(object) = value.as_object() else {
        return Err(vec![format!("{where_}: expected an object")]);
    };

    for key in object.keys() {
        if !RECORD_KEYS.contains(&key.as_str()) {
            issues.push(format!("{where_}.{key}: unrecognized key"));
        }
    }

    let table = match object.get("table") {
        Some(Value::String(s)) if is_identifier(s) => s.clone(),
        Some(_) => {
            issues.push(format!("{where_}.table: not a SQL-safe identifier"));
            String::new()
        }
        None => {
            issues.push(format!("{where_}.table: required"));
            String::new()
        }
    };

    let record_id = match object.get("recordId") {
        Some(Value::String(s)) if !s.is_empty() && s.chars().count() <= 512 => s.clone(),
        Some(_) => {
            issues.push(format!("{where_}.recordId: must be 1..512 characters"));
            String::new()
        }
        None => {
            issues.push(format!("{where_}.recordId: required"));
            String::new()
        }
    };

    let operation = match object.get("operation") {
        None | Some(Value::Null) => Operation::Upsert,
        Some(Value::String(s)) if s == "upsert" => Operation::Upsert,
        Some(Value::String(s)) if s == "delete" => Operation::Delete,
        Some(_) => {
            issues.push(format!("{where_}.operation: must be \"upsert\" or \"delete\""));
            Operation::Upsert
        }
    };

    let base_revision = match object.get("baseRevision") {
        None | Some(Value::Null) => None,
        Some(Value::String(s)) if is_decimal_string(s) => Some(s.clone()),
        Some(_) => {
            issues.push(format!("{where_}.baseRevision: must be a decimal string"));
            None
        }
    };

    let payload = match object.get("payload") {
        Some(Value::Object(map)) => map.clone(),
        Some(_) => {
            issues.push(format!("{where_}.payload: must be an object"));
            serde_json::Map::new()
        }
        None => {
            issues.push(format!("{where_}.payload: required"));
            serde_json::Map::new()
        }
    };

    if object.get("payload").is_some_and(Value::is_object) {
        if operation == Operation::Delete {
            if !payload.is_empty() {
                issues.push(format!(
                    "{where_}.payload: a delete record must carry an empty payload"
                ));
            }
        } else {
            match payload.get("updatedAt") {
                Some(v) if is_timestamp(v) => {}
                Some(_) => issues.push(format!("{where_}.payload.updatedAt: invalid timestamp")),
                None => issues.push(format!(
                    "{where_}.payload.updatedAt: required timestamp is missing"
                )),
            }
            for key in ["createdAt", "syncedAt"] {
                if let Some(v) = payload.get(key) {
                    if !is_timestamp(v) {
                        issues.push(format!("{where_}.payload.{key}: invalid timestamp"));
                    }
                }
            }
        }
    }

    if issues.is_empty() {
        Ok(IngestRecord {
            table,
            record_id,
            operation,
            base_revision,
            payload,
        })
    } else {
        Err(issues)
    }
}

/// Validate an envelope supplied as JSON text.
pub fn parse_envelope(text: &str) -> Result<IngestEnvelope, IngestValidationError> {
    let value: Value = serde_json::from_str(text).map_err(|error| IngestValidationError {
        issues: vec![format!("<root>: invalid JSON: {error}")],
    })?;
    validate_envelope(&value)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::clock::format_hlc;

    #[test]
    fn accepts_the_hlc_this_crate_emits() {
        // The regression that motivated this module: the shared schema had no
        // branch for the native HLC format, so every client rejected its own
        // stamped timestamps.
        let stamp = format_hlc(1_753_876_800_123, 1, "devA.t1");
        assert!(is_native_hlc(&stamp), "not accepted: {stamp}");
        assert!(is_timestamp(&Value::String(stamp)));
    }

    #[test]
    fn native_hlc_rejects_near_misses() {
        for bad in [
            "175387680012-0001-devA.t1",    // 12-digit millis
            "17538768001234-0001-devA.t1",  // 14-digit millis
            "1753876800123-001-devA.t1",    // 3-hex counter
            "1753876800123-000g-devA.t1",   // non-hex counter
            "1753876800123-0001-",          // empty nodeId
            "1753876800123-0001-dev-A",     // '-' in nodeId
            "1753876800123-0001",           // no nodeId
        ] {
            assert!(!is_native_hlc(bad), "should have been rejected: {bad}");
        }
    }

    #[test]
    fn timestamp_accepts_each_documented_format() {
        for good in [
            Value::from(0u64),
            Value::from(1_753_876_800_123u64),
            Value::String("1753876800123".into()),
            Value::String("2026-07-30T12:00:00Z".into()),
            Value::String("2026-07-30T12:00:00.000000001Z-0001-a1b2c3d4".into()),
            Value::String("1753876800123-0001-devA.t1".into()),
        ] {
            assert!(is_timestamp(&good), "should have been accepted: {good:?}");
        }
        for bad in [
            Value::from(-1i64),
            Value::String("".into()),
            Value::String("not-a-timestamp".into()),
            Value::String("2026-07-30 12:00:00Z".into()),
            Value::Bool(true),
            Value::Null,
        ] {
            assert!(!is_timestamp(&bad), "should have been rejected: {bad:?}");
        }
    }

    #[test]
    fn identifier_rejects_injection() {
        assert!(is_identifier("todos"));
        assert!(is_identifier("_private_1"));
        assert!(!is_identifier("todos; DROP TABLE users"));
        assert!(!is_identifier("1todos"));
        assert!(!is_identifier(""));
    }

    #[test]
    fn decimal_string_rejects_leading_zeros() {
        assert!(is_decimal_string("0"));
        assert!(is_decimal_string("41"));
        assert!(!is_decimal_string("041"));
        assert!(!is_decimal_string(""));
        assert!(!is_decimal_string("4.1"));
    }
}
