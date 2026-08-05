//! Envelope validation for the shared ingest schema.
//!
//! `serde_json::Value` is the lossless decoded representation and the shared
//! fixture corpus is the executable contract. Additional validation libraries
//! are integrated as veto-only providers so they cannot coerce or default data
//! before the canonical Serde validator returns an [`IngestEnvelope`].

use serde_json::Value;
use std::{
    fmt,
    panic::{catch_unwind, AssertUnwindSafe},
};

/// Largest integer represented exactly by every supported runtime.
pub const MAX_SAFE_TIMESTAMP_INTEGER: u64 = 9_007_199_254_740_991;

/// `^[A-Za-z_][A-Za-z0-9_]{0,62}$` — SQL-safe table identifier.
fn is_identifier(value: &str) -> bool {
    let mut chars = value.chars();
    match chars.next() {
        Some(c) if c.is_ascii_alphabetic() || c == '_' => {}
        _ => return false,
    }
    chars.clone().count() <= 62 && chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
}

/// `^[0-9]{1,20}$` — pure-digit epoch string.
fn is_digits(value: &str) -> bool {
    let length = value.len();
    (1..=20).contains(&length) && value.bytes().all(|byte| byte.is_ascii_digit())
}

/// `^(?:0|[1-9][0-9]*)$` — canonical decimal, no leading zeros.
fn is_decimal_string(value: &str) -> bool {
    match value.as_bytes() {
        [] => false,
        [b'0'] => true,
        [b'0', ..] => false,
        bytes => bytes.iter().all(u8::is_ascii_digit),
    }
}

/// `^[0-9]{13}-[0-9a-f]{4}-[^-]{1,128}$` — native HLC.
fn is_native_hlc(value: &str) -> bool {
    let mut parts = value.split('-');
    let (Some(millis), Some(counter), Some(node)) = (parts.next(), parts.next(), parts.next())
    else {
        return false;
    };
    if parts.next().is_some() {
        return false;
    }
    millis.len() == 13
        && millis.bytes().all(|byte| byte.is_ascii_digit())
        && counter.len() == 4
        && counter
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        && (1..=128).contains(&node.chars().count())
}

/// `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?Z(-[0-9A-Za-z._~-]+)*$`.
fn is_iso8601(value: &str) -> bool {
    fn digits(bytes: &[u8], count: usize) -> Option<&[u8]> {
        if bytes.len() >= count && bytes[..count].iter().all(u8::is_ascii_digit) {
            Some(&bytes[count..])
        } else {
            None
        }
    }

    fn literal(bytes: &[u8], expected: u8) -> Option<&[u8]> {
        if bytes.first() == Some(&expected) {
            Some(&bytes[1..])
        } else {
            None
        }
    }

    let parse_head = || -> Option<&[u8]> {
        let bytes = value.as_bytes();
        let bytes = digits(bytes, 4)?;
        let bytes = literal(bytes, b'-')?;
        let bytes = digits(bytes, 2)?;
        let bytes = literal(bytes, b'-')?;
        let bytes = digits(bytes, 2)?;
        let bytes = literal(bytes, b'T')?;
        let bytes = digits(bytes, 2)?;
        let bytes = literal(bytes, b':')?;
        let bytes = digits(bytes, 2)?;
        let bytes = literal(bytes, b':')?;
        let bytes = digits(bytes, 2)?;
        let bytes = if bytes.first() == Some(&b'.') {
            let fraction = &bytes[1..];
            let count = fraction
                .iter()
                .take_while(|byte| byte.is_ascii_digit())
                .count();
            if !(1..=9).contains(&count) {
                return None;
            }
            &fraction[count..]
        } else {
            bytes
        };
        literal(bytes, b'Z')
    };

    let Some(rest) = parse_head() else {
        return false;
    };
    if rest.is_empty() {
        return true;
    }
    let Some(suffix) = rest.strip_prefix(b"-") else {
        return false;
    };
    !suffix.is_empty()
        && suffix
            .iter()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'~' | b'-'))
}

fn is_safe_integer(number: &serde_json::Number) -> bool {
    if let Some(value) = number.as_u64() {
        return value <= MAX_SAFE_TIMESTAMP_INTEGER;
    }
    number.as_f64().is_some_and(|value| {
        value.is_finite()
            && value >= 0.0
            && value <= MAX_SAFE_TIMESTAMP_INTEGER as f64
            && value.fract() == 0.0
    })
}

fn is_timestamp(value: &Value) -> bool {
    match value {
        Value::Number(number) => is_safe_integer(number),
        Value::String(text) => is_digits(text) || is_native_hlc(text) || is_iso8601(text),
        _ => false,
    }
}

/// Raised when an envelope does not satisfy the shared schema. Carries every
/// issue, not just the first.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IngestValidationError {
    pub issues: Vec<String>,
}

impl fmt::Display for IngestValidationError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            formatter,
            "envelope failed validation: {}",
            self.issues.join("; ")
        )
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

/// Optional validation-library integration. Providers are veto gates only; the
/// canonical Serde validator still normalizes the envelope.
pub trait EnvelopeValidationProvider {
    fn name(&self) -> &str;
    fn validate(&self, value: &Value) -> Result<(), Vec<String>>;
}

pub struct FnValidationProvider<F> {
    name: &'static str,
    validate: F,
}

impl<F> FnValidationProvider<F> {
    pub fn new(name: &'static str, validate: F) -> Self {
        Self { name, validate }
    }
}

impl<F> EnvelopeValidationProvider for FnValidationProvider<F>
where
    F: Fn(&Value) -> Result<(), Vec<String>>,
{
    fn name(&self) -> &str {
        self.name
    }

    fn validate(&self, value: &Value) -> Result<(), Vec<String>> {
        (self.validate)(value)
    }
}

/// Adapter constructor for the `validator` crate.
pub fn validator_provider<F>(validate: F) -> FnValidationProvider<F>
where
    F: Fn(&Value) -> Result<(), Vec<String>>,
{
    FnValidationProvider::new("validator", validate)
}

/// Adapter constructor for the `garde` crate.
pub fn garde_provider<F>(validate: F) -> FnValidationProvider<F>
where
    F: Fn(&Value) -> Result<(), Vec<String>>,
{
    FnValidationProvider::new("garde", validate)
}

/// Adapter constructor for the `jsonschema` crate or another JSON Schema engine.
pub fn json_schema_provider<F>(validate: F) -> FnValidationProvider<F>
where
    F: Fn(&Value) -> Result<(), Vec<String>>,
{
    FnValidationProvider::new("jsonschema", validate)
}

fn provider_name(provider: &dyn EnvelopeValidationProvider) -> String {
    catch_unwind(AssertUnwindSafe(|| provider.name().to_string()))
        .unwrap_or_else(|_| "<panicked-provider-name>".to_string())
}

fn run_provider(
    provider: &dyn EnvelopeValidationProvider,
    value: &Value,
) -> (String, Result<(), Vec<String>>) {
    let name = provider_name(provider);
    let result = catch_unwind(AssertUnwindSafe(|| provider.validate(value)));
    let normalized = match result {
        Ok(Ok(())) => Ok(()),
        Ok(Err(issues)) if issues.is_empty() => {
            Err(vec!["validation rejected the envelope".to_string()])
        }
        Ok(Err(issues)) => Err(issues),
        Err(_) => Err(vec!["provider panicked".to_string()]),
    };
    (name, normalized)
}

const ENVELOPE_KEYS: [&str; 3] = ["formatVersion", "source", "records"];
const RECORD_KEYS: [&str; 5] = ["table", "recordId", "operation", "baseRevision", "payload"];

/// Validate a decoded JSON envelope with the canonical Serde implementation.
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
        Some(Value::Number(number)) if number.as_u64() == Some(1) => {}
        Some(_) => issues.push("<root>.formatVersion: must be 1".to_string()),
        None => issues.push("<root>.formatVersion: required".to_string()),
    }

    let source = match root.get("source") {
        None => None,
        Some(Value::String(text)) if text.chars().count() <= 200 => Some(text.clone()),
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
    let path = format!("records.{index}");
    let mut issues = Vec::new();

    let Some(object) = value.as_object() else {
        return Err(vec![format!("{path}: expected an object")]);
    };

    for key in object.keys() {
        if !RECORD_KEYS.contains(&key.as_str()) {
            issues.push(format!("{path}.{key}: unrecognized key"));
        }
    }

    let table = match object.get("table") {
        Some(Value::String(text)) if is_identifier(text) => text.clone(),
        Some(_) => {
            issues.push(format!("{path}.table: not a SQL-safe identifier"));
            String::new()
        }
        None => {
            issues.push(format!("{path}.table: required"));
            String::new()
        }
    };

    let record_id = match object.get("recordId") {
        Some(Value::String(text)) if (1..=512).contains(&text.chars().count()) => text.clone(),
        Some(_) => {
            issues.push(format!("{path}.recordId: must be 1..512 characters"));
            String::new()
        }
        None => {
            issues.push(format!("{path}.recordId: required"));
            String::new()
        }
    };

    let operation = match object.get("operation") {
        None => Operation::Upsert,
        Some(Value::String(text)) if text == "upsert" => Operation::Upsert,
        Some(Value::String(text)) if text == "delete" => Operation::Delete,
        Some(_) => {
            issues.push(format!(
                "{path}.operation: must be \"upsert\" or \"delete\""
            ));
            Operation::Upsert
        }
    };

    let base_revision = match object.get("baseRevision") {
        None => None,
        Some(Value::String(text)) if is_decimal_string(text) => Some(text.clone()),
        Some(_) => {
            issues.push(format!("{path}.baseRevision: must be a decimal string"));
            None
        }
    };

    let payload = match object.get("payload") {
        Some(Value::Object(map)) => map.clone(),
        Some(_) => {
            issues.push(format!("{path}.payload: must be an object"));
            serde_json::Map::new()
        }
        None => {
            issues.push(format!("{path}.payload: required"));
            serde_json::Map::new()
        }
    };

    if object.get("payload").is_some_and(Value::is_object) {
        if operation == Operation::Delete {
            if !payload.is_empty() {
                issues.push(format!(
                    "{path}.payload: a delete record must carry an empty payload"
                ));
            }
        } else {
            match payload.get("updatedAt") {
                Some(timestamp) if is_timestamp(timestamp) => {}
                Some(_) => issues.push(format!("{path}.payload.updatedAt: invalid timestamp")),
                None => issues.push(format!(
                    "{path}.payload.updatedAt: required timestamp is missing"
                )),
            }
            for key in ["createdAt", "syncedAt"] {
                if let Some(timestamp) = payload.get(key) {
                    if !is_timestamp(timestamp) {
                        issues.push(format!("{path}.payload.{key}: invalid timestamp"));
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

/// Run additional providers and the canonical validator against decoded JSON.
pub fn validate_envelope_with(
    value: &Value,
    providers: &[&dyn EnvelopeValidationProvider],
) -> Result<IngestEnvelope, IngestValidationError> {
    let canonical = validate_envelope(value);
    let mut issues = canonical
        .as_ref()
        .err()
        .map_or_else(Vec::new, |error| error.issues.clone());

    for provider in providers {
        let (name, result) = run_provider(*provider, value);
        if let Err(provider_issues) = result {
            issues.extend(
                provider_issues
                    .into_iter()
                    .map(|entry| format!("provider[{name}]: {entry}")),
            );
        }
    }

    if issues.is_empty() {
        canonical
    } else {
        Err(IngestValidationError { issues })
    }
}

/// Validate an envelope supplied as JSON text.
pub fn parse_envelope(text: &str) -> Result<IngestEnvelope, IngestValidationError> {
    parse_envelope_with(text, &[])
}

/// Validate JSON text with additional provider gates.
pub fn parse_envelope_with(
    text: &str,
    providers: &[&dyn EnvelopeValidationProvider],
) -> Result<IngestEnvelope, IngestValidationError> {
    let value: Value = serde_json::from_str(text).map_err(|error| IngestValidationError {
        issues: vec![format!("<root>: invalid JSON: {error}")],
    })?;
    validate_envelope_with(&value, providers)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProviderAuditResult {
    pub provider: String,
    pub canonical_accepted: bool,
    pub provider_accepted: bool,
    pub drift: bool,
    pub provider_issues: Vec<String>,
}

/// Compare one provider's decision with the canonical Serde contract.
pub fn audit_provider(
    value: &Value,
    provider: &dyn EnvelopeValidationProvider,
) -> ProviderAuditResult {
    let canonical_accepted = validate_envelope(value).is_ok();
    let (name, result) = run_provider(provider, value);
    let provider_accepted = result.is_ok();
    ProviderAuditResult {
        provider: name,
        canonical_accepted,
        provider_accepted,
        drift: canonical_accepted != provider_accepted,
        provider_issues: result.err().unwrap_or_default(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn accepts_the_hlc_this_crate_emits() {
        use crate::clock::{format_hlc, HlcParts};

        let stamp = format_hlc(&HlcParts {
            millis: 1_753_876_800_123,
            counter: 1,
            node_id: "devA.t1".to_string(),
        });
        assert!(is_native_hlc(&stamp), "not accepted: {stamp}");
        assert!(is_timestamp(&Value::String(stamp)));
    }

    #[test]
    fn optional_null_is_not_missing() {
        let value = json!({
            "formatVersion": 1,
            "source": null,
            "records": [{
                "table": "notes",
                "recordId": "n1",
                "payload": {"updatedAt": "1"}
            }]
        });
        assert!(validate_envelope(&value).is_err());
    }

    #[test]
    fn safe_integer_boundary_is_exact() {
        assert!(is_timestamp(&json!(MAX_SAFE_TIMESTAMP_INTEGER)));
        assert!(!is_timestamp(&json!(MAX_SAFE_TIMESTAMP_INTEGER + 1)));
        assert!(is_timestamp(&json!("9007199254740992")));
    }

    #[test]
    fn provider_cannot_reject_silently() {
        let value = json!({
            "formatVersion": 1,
            "records": [{
                "table": "notes",
                "recordId": "n1",
                "payload": {"updatedAt": "1"}
            }]
        });
        let provider = validator_provider(|_| Err(Vec::new()));
        let error = validate_envelope_with(&value, &[&provider]).unwrap_err();
        assert!(error
            .issues
            .iter()
            .any(|issue| issue.contains("validation rejected the envelope")));
    }

    #[test]
    fn provider_drift_is_reported() {
        let value = json!({"formatVersion": 1, "records": []});
        let provider = validator_provider(|_| Ok(()));
        let audit = audit_provider(&value, &provider);
        assert!(audit.drift);
        assert!(!audit.canonical_accepted);
        assert!(audit.provider_accepted);
    }
}
