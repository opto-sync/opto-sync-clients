//! Envelope validation + ingestion (Rust mirror of the shared contract).
//!
//! The source of truth is
//! `opto-sync-clients/schema/opto-sync-envelope.schema.json`; this validator
//! MUST accept/reject exactly the shared fixture corpus in `schema/fixtures/`
//! (enforced by `tests/schema_ingest.rs`), keeping it in lockstep with the
//! TypeScript (zod), Dart, and Gleam validators.
//!
//! Validation is hand-written over `serde_json` instead of generated from the
//! JSON Schema at build time. The contract is small, stable, and already
//! duplicated in four languages; a schema-compiler dependency would buy nothing
//! and would put this crate's MSRV at the mercy of another dependency graph.
//!
//! Ingestion turns a validated file/blob into ordinary queued protocol
//! mutations, so every store converges through the normal push/reconcile path —
//! the ingest API deliberately has no direct-to-database shortcut. Unlike the
//! TypeScript and Dart clients this crate has no `rx`/optimism layer, so the
//! ingest target is [`ProtocolQueue`] itself; see [`ingest_envelope`].

use serde_json::{Map, Value};

use crate::protocol::{ProtocolError, ProtocolQueue};

pub use crate::protocol::Operation;

/// The only envelope version this validator accepts.
///
/// The parsed [`IngestEnvelope`] therefore does not carry the version: a value
/// that reached you has `formatVersion == FORMAT_VERSION` by construction.
pub const FORMAT_VERSION: u64 = 1;

/// Maximum length (in Unicode scalar values) of the free-form `source` label.
const MAX_SOURCE_LEN: usize = 200;
/// Maximum length (in Unicode scalar values) of a `recordId`.
const MAX_RECORD_ID_LEN: usize = 512;
/// Maximum length of a pure-digit timestamp string.
const MAX_DIGIT_TIMESTAMP_LEN: usize = 20;
/// Maximum length of a SQL-safe table identifier.
const MAX_IDENTIFIER_LEN: usize = 63;

const ENVELOPE_KEYS: [&str; 3] = ["formatVersion", "source", "records"];
const RECORD_KEYS: [&str; 5] = ["table", "recordId", "operation", "baseRevision", "payload"];

/* ------------------------------------------------------------------------ */
/* Errors                                                                   */
/* ------------------------------------------------------------------------ */

/// One contract violation, located by a dotted path into the envelope.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Issue {
    /// Dotted path to the offending value, e.g. `records.0.payload.updatedAt`.
    /// Empty for the document itself.
    pub path: String,
    pub message: String,
}

impl Issue {
    fn new(path: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            path: path.into(),
            message: message.into(),
        }
    }
}

impl std::fmt::Display for Issue {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let path = if self.path.is_empty() {
            "<root>"
        } else {
            &self.path
        };
        write!(f, "{path}: {}", self.message)
    }
}

/// Why an envelope could not be parsed, validated, or queued.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum IngestError {
    /// The input is not valid JSON.
    InvalidJson,
    /// The document parsed but violates the envelope contract. Every issue is
    /// reported, not just the first: an operator fixing an export file wants
    /// the whole list.
    Invalid(Vec<Issue>),
    /// The envelope is valid but the queue refused a record (full, payload too
    /// large, identity the protocol will not carry, ...). Nothing is queued
    /// when this happens — see [`ingest_envelope`].
    Queue(ProtocolError),
}

impl IngestError {
    /// The contract violations, or an empty slice for the other variants.
    #[must_use]
    pub fn issues(&self) -> &[Issue] {
        match self {
            IngestError::Invalid(issues) => issues,
            _ => &[],
        }
    }
}

impl std::fmt::Display for IngestError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            IngestError::InvalidJson => write!(f, "input is not valid JSON"),
            IngestError::Invalid(issues) => {
                write!(f, "envelope failed validation: ")?;
                for (index, issue) in issues.iter().enumerate() {
                    if index > 0 {
                        write!(f, "; ")?;
                    }
                    write!(f, "{issue}")?;
                }
                Ok(())
            }
            IngestError::Queue(error) => write!(f, "envelope could not be queued: {error}"),
        }
    }
}

impl std::error::Error for IngestError {}

impl From<ProtocolError> for IngestError {
    fn from(error: ProtocolError) -> Self {
        IngestError::Queue(error)
    }
}

/* ------------------------------------------------------------------------ */
/* Envelope                                                                 */
/* ------------------------------------------------------------------------ */

/// One validated record of an envelope.
#[derive(Debug, Clone, PartialEq)]
pub struct IngestRecord {
    pub table: String,
    pub record_id: String,
    /// Absent in the file means [`Operation::Upsert`].
    pub operation: Operation,
    pub base_revision: Option<String>,
    /// The jsonb document. Empty for a delete.
    pub payload: Map<String, Value>,
}

/// A validated ingest envelope.
#[derive(Debug, Clone, PartialEq)]
pub struct IngestEnvelope {
    /// Free-form provenance label (device id, export job, ...).
    pub source: Option<String>,
    /// Always non-empty.
    pub records: Vec<IngestRecord>,
}

/// Knobs for [`ingest_envelope`].
///
/// The TypeScript and Dart clients take an optimism level here; this crate has
/// no such layer (queueing is synchronous and the caller owns the transport),
/// so the only per-ingest choice is the protocol's `resurrect` flag.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct IngestOptions {
    /// Let an ingested upsert revive a server-side tombstone. Default `false`,
    /// so a re-imported export cannot silently undo a delete.
    pub resurrect: bool,
}

/* ------------------------------------------------------------------------ */
/* Validation                                                               */
/* ------------------------------------------------------------------------ */

/// Validate an envelope from its JSON text.
///
/// # Errors
///
/// [`IngestError::InvalidJson`] if the text is not JSON, otherwise
/// [`IngestError::Invalid`] listing every contract violation.
pub fn parse_envelope(input: &str) -> Result<IngestEnvelope, IngestError> {
    let document: Value = serde_json::from_str(input).map_err(|_| IngestError::InvalidJson)?;
    validate_envelope(&document)
}

/// [`parse_envelope`] for callers that already hold a parsed document.
///
/// # Errors
///
/// [`IngestError::Invalid`] listing every contract violation.
pub fn validate_envelope(document: &Value) -> Result<IngestEnvelope, IngestError> {
    let Some(root) = document.as_object() else {
        return Err(IngestError::Invalid(vec![Issue::new(
            "",
            "envelope must be an object",
        )]));
    };

    let mut issues = Vec::new();
    for key in root.keys() {
        if !ENVELOPE_KEYS.contains(&key.as_str()) {
            issues.push(Issue::new(key, "unknown property"));
        }
    }

    if root.get("formatVersion").and_then(Value::as_u64) != Some(FORMAT_VERSION) {
        issues.push(Issue::new(
            "formatVersion",
            format!("must be {FORMAT_VERSION}"),
        ));
    }

    let mut source = None;
    match root.get("source") {
        None => {}
        Some(Value::String(label)) if scalar_len(label) <= MAX_SOURCE_LEN => {
            source = Some(label.clone());
        }
        Some(_) => issues.push(Issue::new(
            "source",
            format!("must be a string of at most {MAX_SOURCE_LEN} characters"),
        )),
    }

    let mut records = Vec::new();
    match root.get("records") {
        Some(Value::Array(items)) if !items.is_empty() => {
            for (index, item) in items.iter().enumerate() {
                if let Some(record) = validate_record(index, item, &mut issues) {
                    records.push(record);
                }
            }
        }
        _ => issues.push(Issue::new("records", "must be a non-empty array")),
    }

    if issues.is_empty() {
        Ok(IngestEnvelope { source, records })
    } else {
        Err(IngestError::Invalid(issues))
    }
}

/// Validate one record, appending every violation to `issues`.
///
/// Returns `None` when this record contributed any issue, so the caller never
/// builds a half-valid [`IngestRecord`].
fn validate_record(index: usize, value: &Value, issues: &mut Vec<Issue>) -> Option<IngestRecord> {
    let at = format!("records.{index}");
    let Some(object) = value.as_object() else {
        issues.push(Issue::new(at, "must be an object"));
        return None;
    };
    let issues_before = issues.len();

    for key in object.keys() {
        if !RECORD_KEYS.contains(&key.as_str()) {
            issues.push(Issue::new(format!("{at}.{key}"), "unknown property"));
        }
    }

    let table = match object.get("table") {
        Some(Value::String(table)) if is_identifier(table) => Some(table.clone()),
        _ => {
            issues.push(Issue::new(
                format!("{at}.table"),
                "must be a SQL-safe identifier",
            ));
            None
        }
    };

    let record_id = match object.get("recordId") {
        Some(Value::String(id)) if (1..=MAX_RECORD_ID_LEN).contains(&scalar_len(id)) => {
            Some(id.clone())
        }
        _ => {
            issues.push(Issue::new(
                format!("{at}.recordId"),
                format!("must be a string of 1..{MAX_RECORD_ID_LEN} characters"),
            ));
            None
        }
    };

    let operation = match object.get("operation") {
        None => Some(Operation::Upsert),
        Some(Value::String(op)) if op == "upsert" => Some(Operation::Upsert),
        Some(Value::String(op)) if op == "delete" => Some(Operation::Delete),
        Some(_) => {
            issues.push(Issue::new(
                format!("{at}.operation"),
                "must be upsert or delete",
            ));
            None
        }
    };

    let mut base_revision = None;
    match object.get("baseRevision") {
        None => {}
        Some(Value::String(revision)) if is_canonical_decimal(revision) => {
            base_revision = Some(revision.clone());
        }
        Some(_) => issues.push(Issue::new(
            format!("{at}.baseRevision"),
            "must be a canonical decimal string",
        )),
    }

    let payload = match object.get("payload") {
        Some(Value::Object(payload)) => Some(payload),
        _ => {
            issues.push(Issue::new(format!("{at}.payload"), "must be an object"));
            None
        }
    };

    if let (Some(payload), Some(operation)) = (payload, operation) {
        validate_payload(&at, operation, payload, issues);
    }

    if issues.len() != issues_before {
        return None;
    }
    Some(IngestRecord {
        table: table?,
        record_id: record_id?,
        operation: operation?,
        base_revision,
        payload: payload?.clone(),
    })
}

/// A delete carries no document; an upsert must carry the timestamp that keeps
/// last-write-wins from being decided by ingest order.
fn validate_payload(
    at: &str,
    operation: Operation,
    payload: &Map<String, Value>,
    issues: &mut Vec<Issue>,
) {
    if operation == Operation::Delete {
        if !payload.is_empty() {
            issues.push(Issue::new(
                format!("{at}.payload"),
                "a delete record must carry an empty payload",
            ));
        }
        return;
    }
    if !payload.get("updatedAt").is_some_and(is_timestamp) {
        issues.push(Issue::new(
            format!("{at}.payload.updatedAt"),
            "required timestamp (epoch int, digit string, or fixed-width ISO-8601 UTC/HLC)",
        ));
    }
    for key in ["createdAt", "syncedAt"] {
        if payload.get(key).is_some_and(|value| !is_timestamp(value)) {
            issues.push(Issue::new(
                format!("{at}.payload.{key}"),
                "invalid timestamp",
            ));
        }
    }
}

/* ------------------------------------------------------------------------ */
/* Ingestion                                                                */
/* ------------------------------------------------------------------------ */

/// Validate an envelope and queue every record, in file order.
///
/// All-or-nothing: the whole envelope is validated before anything is queued,
/// and the records are staged against a copy of `queue` that is only committed
/// once the last one is accepted. A rejected record therefore leaves `queue`
/// byte-identical, so a failed ingest can be retried from the same file.
///
/// Returns the allocated mutation ids, one per record, in file order.
///
/// # Errors
///
/// [`IngestError::InvalidJson`] / [`IngestError::Invalid`] from
/// [`parse_envelope`], or [`IngestError::Queue`] when the queue refuses a
/// record. Note the two identity rules differ on purpose: the envelope's
/// `table` is the SQL-safe identifier pattern (a leading `_` is legal), while
/// the wire protocol additionally requires a leading alphanumeric, so a
/// schema-valid `_private` table is reported as
/// [`ProtocolError::InvalidTarget`] here rather than silently pushed.
pub fn ingest_envelope(
    queue: &mut ProtocolQueue,
    input: &str,
    options: IngestOptions,
) -> Result<Vec<String>, IngestError> {
    let envelope = parse_envelope(input)?;
    ingest_records(queue, &envelope.records, options)
}

/// [`ingest_envelope`] for callers that already hold a validated envelope.
///
/// # Errors
///
/// [`IngestError::Queue`] when the queue refuses a record; `queue` is left
/// unchanged.
pub fn ingest_records(
    queue: &mut ProtocolQueue,
    records: &[IngestRecord],
    options: IngestOptions,
) -> Result<Vec<String>, IngestError> {
    let mut staged = queue.clone();
    let mut mutation_ids = Vec::with_capacity(records.len());
    for record in records {
        let mutation_id = match record.operation {
            Operation::Upsert => staged.queue_upsert(
                record.table.clone(),
                record.record_id.clone(),
                Value::Object(record.payload.clone()),
                record.base_revision.clone(),
                options.resurrect,
            ),
            Operation::Delete => staged.queue_delete(
                record.table.clone(),
                record.record_id.clone(),
                record.base_revision.clone(),
            ),
        }?;
        mutation_ids.push(mutation_id);
    }
    *queue = staged;
    Ok(mutation_ids)
}

/* ------------------------------------------------------------------------ */
/* Scalar rules                                                             */
/* ------------------------------------------------------------------------ */

/// Length in Unicode scalar values, which is what JSON Schema `maxLength`
/// counts.
fn scalar_len(value: &str) -> usize {
    value.chars().count()
}

/// `^[A-Za-z_][A-Za-z0-9_]{0,62}$` — a SQL-safe table identifier.
fn is_identifier(value: &str) -> bool {
    let bytes = value.as_bytes();
    let Some((first, rest)) = bytes.split_first() else {
        return false;
    };
    bytes.len() <= MAX_IDENTIFIER_LEN
        && (first.is_ascii_alphabetic() || *first == b'_')
        && rest
            .iter()
            .all(|byte| byte.is_ascii_alphanumeric() || *byte == b'_')
}

/// `^(?:0|[1-9][0-9]*)$` — a canonical decimal with no leading zero.
fn is_canonical_decimal(value: &str) -> bool {
    match value.as_bytes() {
        [b'0'] => true,
        [first, rest @ ..] => (b'1'..=b'9').contains(first) && rest.iter().all(u8::is_ascii_digit),
        [] => false,
    }
}

/// One timestamp FORMAT per key across all replicas: an epoch integer, a
/// pure-digit string, or a fixed-width ISO-8601 UTC stamp (optionally carrying
/// HLC counter/node suffixes after the `Z`).
fn is_timestamp(value: &Value) -> bool {
    match value {
        // `as_u64` is exactly "a non-negative JSON integer": it rejects
        // negatives and anything serde parsed as a float, including `1.0`.
        Value::Number(number) => number.as_u64().is_some(),
        Value::String(text) => is_digit_timestamp(text) || is_iso8601_hlc(text),
        _ => false,
    }
}

/// `^[0-9]+$` with `maxLength: 20`.
fn is_digit_timestamp(value: &str) -> bool {
    let bytes = value.as_bytes();
    !bytes.is_empty()
        && bytes.len() <= MAX_DIGIT_TIMESTAMP_LEN
        && bytes.iter().all(u8::is_ascii_digit)
}

/// `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?Z(-[0-9A-Za-z._~-]+)*$`
///
/// Fixed width up to the `Z` so that string comparison is chronological, which
/// is what the merge core's last-write-wins actually does with these values.
fn is_iso8601_hlc(value: &str) -> bool {
    // `0` in the mask means "any ASCII digit"; every other byte is a literal.
    const MASK: &[u8; 19] = b"0000-00-00T00:00:00";
    let bytes = value.as_bytes();
    if bytes.len() < MASK.len() {
        return false;
    }
    for (byte, expected) in bytes.iter().zip(MASK) {
        let matched = match expected {
            b'0' => byte.is_ascii_digit(),
            literal => byte == literal,
        };
        if !matched {
            return false;
        }
    }

    // The mask is ASCII, so byte 19 is a char boundary.
    let mut rest = &value[MASK.len()..];
    if let Some(fraction) = rest.strip_prefix('.') {
        let digits = fraction.bytes().take_while(u8::is_ascii_digit).count();
        if !(1..=9).contains(&digits) {
            return false;
        }
        rest = &fraction[digits..];
    }
    let Some(suffixes) = rest.strip_prefix('Z') else {
        return false;
    };

    // `(-X+)*` where `-` is itself in X collapses to: nothing at all, or a
    // leading `-` followed by at least one more character from X.
    suffixes.is_empty()
        || (suffixes.starts_with('-')
            && suffixes.len() >= 2
            && suffixes.bytes().all(|byte| {
                byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'~' | b'-')
            }))
}

/* ------------------------------------------------------------------------ */
/* Tests                                                                    */
/* ------------------------------------------------------------------------ */

#[cfg(test)]
mod tests {
    use super::*;

    /// A minimal accepted envelope with `patch` applied to its only record.
    fn envelope_with(record: Value) -> String {
        serde_json::json!({ "formatVersion": 1, "records": [record] }).to_string()
    }

    fn upsert(payload: Value) -> Value {
        serde_json::json!({ "table": "todos", "recordId": "todo-1", "payload": payload })
    }

    fn issue_paths(error: &IngestError) -> Vec<&str> {
        error
            .issues()
            .iter()
            .map(|issue| issue.path.as_str())
            .collect()
    }

    fn expect_invalid(json: &str) -> IngestError {
        let error = parse_envelope(json).expect_err("must be rejected");
        assert!(
            matches!(error, IngestError::Invalid(_)),
            "expected a contract violation, got {error:?}"
        );
        error
    }

    #[test]
    fn accepts_a_minimal_upsert() {
        let envelope = parse_envelope(&envelope_with(upsert(
            serde_json::json!({ "updatedAt": "2026-07-30T12:00:00Z", "title": "buy milk" }),
        )))
        .unwrap();
        assert_eq!(envelope.records.len(), 1);
        assert_eq!(envelope.records[0].table, "todos");
        assert_eq!(envelope.records[0].record_id, "todo-1");
        assert_eq!(envelope.records[0].operation, Operation::Upsert);
        assert_eq!(envelope.records[0].base_revision, None);
        assert_eq!(envelope.records[0].payload["title"], "buy milk");
        assert_eq!(envelope.source, None);
    }

    #[test]
    fn operation_defaults_to_upsert_and_delete_takes_an_empty_payload() {
        let envelope = parse_envelope(
            &serde_json::json!({
                "formatVersion": 1,
                "source": "unit-fixture",
                "records": [
                    { "table": "todos", "recordId": "a", "payload": { "updatedAt": 1 } },
                    {
                        "table": "todos",
                        "recordId": "b",
                        "operation": "delete",
                        "baseRevision": "41",
                        "payload": {}
                    }
                ]
            })
            .to_string(),
        )
        .unwrap();
        assert_eq!(envelope.source.as_deref(), Some("unit-fixture"));
        assert_eq!(envelope.records[0].operation, Operation::Upsert);
        assert_eq!(envelope.records[1].operation, Operation::Delete);
        assert_eq!(envelope.records[1].base_revision.as_deref(), Some("41"));
        assert!(envelope.records[1].payload.is_empty());
    }

    #[test]
    fn rejects_an_explicit_null_for_an_optional_field() {
        // DELIBERATE, and a place the two reference validators disagree: the
        // JSON Schema and the zod client reject `null` for an optional field
        // (absent and null are different things), while the Dart client's
        // `!= null` guards treat null as absent and accept all four of these.
        // Following the schema keeps a null that a producer wrote by accident
        // from becoming an untyped value nobody validated.
        for envelope in [
            serde_json::json!({
                "formatVersion": 1,
                "source": null,
                "records": [upsert(serde_json::json!({ "updatedAt": 1 }))]
            }),
            serde_json::json!({
                "formatVersion": 1,
                "records": [{
                    "table": "todos", "recordId": "t", "operation": null,
                    "payload": { "updatedAt": 1 }
                }]
            }),
            serde_json::json!({
                "formatVersion": 1,
                "records": [{
                    "table": "todos", "recordId": "t", "baseRevision": null,
                    "payload": { "updatedAt": 1 }
                }]
            }),
            serde_json::json!({
                "formatVersion": 1,
                "records": [upsert(
                    serde_json::json!({ "updatedAt": 1, "createdAt": null })
                )]
            }),
        ] {
            expect_invalid(&envelope.to_string());
        }
    }

    #[test]
    fn rejects_a_table_identifier_that_is_not_sql_safe() {
        let error = expect_invalid(&envelope_with(serde_json::json!({
            "table": "todos; DROP TABLE users",
            "recordId": "todo-1",
            "payload": { "updatedAt": 1 }
        })));
        assert_eq!(issue_paths(&error), ["records.0.table"]);
    }

    #[test]
    fn table_identifier_edges() {
        assert!(is_identifier("_private"));
        assert!(is_identifier("T"));
        assert!(is_identifier(&"a".repeat(63)));
        assert!(!is_identifier(&"a".repeat(64)));
        assert!(!is_identifier(""));
        assert!(!is_identifier("9lives"), "must not start with a digit");
        assert!(!is_identifier("with space"));
        assert!(!is_identifier("dash-ed"));
        assert!(!is_identifier("café"));
    }

    #[test]
    fn rejects_a_delete_that_carries_a_payload() {
        let error = expect_invalid(&envelope_with(serde_json::json!({
            "table": "todos",
            "recordId": "todo-1",
            "operation": "delete",
            "payload": { "updatedAt": "2026-07-30T12:00:00Z", "title": "stale" }
        })));
        assert_eq!(issue_paths(&error), ["records.0.payload"]);
        assert!(error.to_string().contains("empty payload"), "{error}");
    }

    #[test]
    fn rejects_an_upsert_without_updated_at() {
        // The whole point of the field: without it last-write-wins is decided
        // by ingest order.
        let error = expect_invalid(&envelope_with(upsert(
            serde_json::json!({ "title": "no timestamp" }),
        )));
        assert_eq!(issue_paths(&error), ["records.0.payload.updatedAt"]);
    }

    #[test]
    fn rejects_an_invalid_optional_timestamp() {
        let error = expect_invalid(&envelope_with(upsert(serde_json::json!({
            "updatedAt": 1,
            "createdAt": "yesterday",
            "syncedAt": -1
        }))));
        assert_eq!(
            issue_paths(&error),
            ["records.0.payload.createdAt", "records.0.payload.syncedAt"]
        );
    }

    #[test]
    fn rejects_a_format_version_other_than_one() {
        let error = expect_invalid(
            &serde_json::json!({
                "formatVersion": 2,
                "records": [upsert(serde_json::json!({ "updatedAt": 1 }))]
            })
            .to_string(),
        );
        assert_eq!(issue_paths(&error), ["formatVersion"]);

        // A stringly-typed version is a different file format, not this one.
        let error = expect_invalid(
            &serde_json::json!({
                "formatVersion": "1",
                "records": [upsert(serde_json::json!({ "updatedAt": 1 }))]
            })
            .to_string(),
        );
        assert_eq!(issue_paths(&error), ["formatVersion"]);

        // DELIBERATE: `1.0` is a float, not the integer literal 1, and this
        // validator applies that rule uniformly — the same reason it rejects a
        // `1.0` timestamp. Both reference validators accept it here (zod
        // because `JSON.parse` collapses `1.0` to `1`, Dart because `1.0 == 1`
        // is numeric equality), yet Dart still rejects `"updatedAt": 1.0`
        // because that check is a type test. Being consistent is worth being
        // stricter than both on a value no encoder emits for a version field.
        let error = expect_invalid(&r#"{"formatVersion":1.0,"records":[]}"#.to_string());
        assert_eq!(issue_paths(&error), ["formatVersion", "records"]);
    }

    #[test]
    fn rejects_an_empty_records_array() {
        let error =
            expect_invalid(&serde_json::json!({ "formatVersion": 1, "records": [] }).to_string());
        assert_eq!(issue_paths(&error), ["records"]);
    }

    #[test]
    fn rejects_unknown_properties() {
        // Strict on purpose: a typo'd key that is silently dropped is a field
        // that never syncs, discovered months later.
        let error = expect_invalid(
            &serde_json::json!({
                "formatVersion": 1,
                "records": [upsert(serde_json::json!({ "updatedAt": 1 }))],
                "recordsCount": 1
            })
            .to_string(),
        );
        assert_eq!(issue_paths(&error), ["recordsCount"]);

        let error = expect_invalid(&envelope_with(serde_json::json!({
            "table": "todos",
            "recordId": "todo-1",
            "payload": { "updatedAt": 1 },
            "tabel": "todos"
        })));
        assert_eq!(issue_paths(&error), ["records.0.tabel"]);
    }

    #[test]
    fn payload_keeps_unknown_properties() {
        // The payload is the application's jsonb document; only the timestamp
        // keys are the contract's business.
        let envelope = parse_envelope(&envelope_with(upsert(serde_json::json!({
            "updatedAt": 1,
            "anything": { "nested": [1, 2, 3] }
        }))))
        .unwrap();
        assert!(envelope.records[0].payload.contains_key("anything"));
    }

    #[test]
    fn rejects_a_non_canonical_base_revision() {
        for revision in ["041", "", "-1", "1.0", "0x1"] {
            let error = expect_invalid(&envelope_with(serde_json::json!({
                "table": "todos",
                "recordId": "todo-1",
                "baseRevision": revision,
                "payload": { "updatedAt": 1 }
            })));
            assert_eq!(
                issue_paths(&error),
                ["records.0.baseRevision"],
                "revision {revision:?}"
            );
        }
        assert!(is_canonical_decimal("0"));
        assert!(is_canonical_decimal("41"));
        assert!(is_canonical_decimal("9007199254740993"));
    }

    #[test]
    fn rejects_a_record_id_outside_one_to_512_characters() {
        for record_id in [String::new(), "x".repeat(513)] {
            let error = expect_invalid(&envelope_with(serde_json::json!({
                "table": "todos",
                "recordId": record_id,
                "payload": { "updatedAt": 1 }
            })));
            assert_eq!(issue_paths(&error), ["records.0.recordId"]);
        }
        assert!(parse_envelope(&envelope_with(serde_json::json!({
            "table": "todos",
            "recordId": "x".repeat(512),
            "payload": { "updatedAt": 1 }
        })))
        .is_ok());
    }

    #[test]
    fn rejects_an_operation_that_is_not_upsert_or_delete() {
        let error = expect_invalid(&envelope_with(serde_json::json!({
            "table": "todos",
            "recordId": "todo-1",
            "operation": "drop",
            "payload": { "updatedAt": 1 }
        })));
        assert_eq!(issue_paths(&error), ["records.0.operation"]);
    }

    #[test]
    fn rejects_a_source_label_over_two_hundred_characters() {
        let error = expect_invalid(
            &serde_json::json!({
                "formatVersion": 1,
                "source": "s".repeat(201),
                "records": [upsert(serde_json::json!({ "updatedAt": 1 }))]
            })
            .to_string(),
        );
        assert_eq!(issue_paths(&error), ["source"]);
    }

    #[test]
    fn reports_every_issue_at_once() {
        let error = expect_invalid(
            &serde_json::json!({
                "formatVersion": 3,
                "records": [
                    { "table": "1nvalid", "recordId": "", "payload": {} }
                ]
            })
            .to_string(),
        );
        assert_eq!(
            issue_paths(&error),
            [
                "formatVersion",
                "records.0.table",
                "records.0.recordId",
                "records.0.payload.updatedAt"
            ]
        );
    }

    #[test]
    fn rejects_documents_that_are_not_envelopes() {
        assert_eq!(parse_envelope("{not json"), Err(IngestError::InvalidJson));
        assert_eq!(issue_paths(&expect_invalid("[]")), [""]);
        assert!(expect_invalid("[]").to_string().contains("<root>"));
        assert_eq!(
            issue_paths(&expect_invalid(
                &serde_json::json!({ "formatVersion": 1, "records": [42] }).to_string()
            )),
            ["records.0"]
        );
    }

    #[test]
    fn accepts_every_timestamp_format_of_the_union() {
        for timestamp in [
            serde_json::json!(0),
            serde_json::json!(1_753_876_800_123_i64),
            serde_json::json!(1_753_876_800_123_456_789_i64),
            serde_json::json!("0"),
            serde_json::json!("1753876800123"),
            serde_json::json!("2026-07-30T12:00:00Z"),
            serde_json::json!("2026-07-30T12:00:00.1Z"),
            serde_json::json!("2026-07-30T12:00:00.000000001Z"),
            serde_json::json!("2026-07-30T12:00:00.000000001Z-0001-a1b2c3d4"),
            serde_json::json!("2026-07-30T12:00:00Z-0001-node.id_v1~2"),
        ] {
            assert!(
                is_timestamp(&timestamp),
                "{timestamp} must be a valid timestamp"
            );
            assert!(
                parse_envelope(&envelope_with(upsert(
                    serde_json::json!({ "updatedAt": timestamp })
                )))
                .is_ok(),
                "{timestamp} must be accepted as updatedAt"
            );
        }
    }

    #[test]
    fn rejects_timestamps_outside_the_union() {
        for timestamp in [
            serde_json::json!(-1),
            serde_json::json!(1.5),
            // DELIBERATE, and a place the two reference validators disagree: a
            // float is a different scale, not an epoch integer. The Dart client
            // rejects these too; the zod client accepts them because
            // `JSON.parse` has already collapsed `1.0` and `1e3` to integers by
            // the time it looks, so the distinction is gone. serde keeps it.
            serde_json::json!(1.0),
            serde_json::json!(1e3),
            serde_json::json!(true),
            serde_json::json!(null),
            serde_json::json!([1]),
            serde_json::json!({}),
            serde_json::json!(""),
            serde_json::json!("123456789012345678901"),
            serde_json::json!("12a3"),
            serde_json::json!("2026-07-30T12:00:00"),
            serde_json::json!("2026-07-30T12:00:00+01:00"),
            serde_json::json!("2026-7-30T12:00:00Z"),
            serde_json::json!("2026-07-30T12:00:00.Z"),
            serde_json::json!("2026-07-30T12:00:00.1234567890Z"),
            serde_json::json!("2026-07-30T12:00:00Z-"),
            serde_json::json!("2026-07-30T12:00:00Z0001"),
            serde_json::json!("2026-07-30T12:00:00Z-node id"),
            // The native millisecond HLC the clock module emits is NOT in the
            // envelope union: it is not fixed-width ISO-8601 and not pure
            // digits. Mixing formats for one key compares lexicographically
            // and is not chronologically meaningful.
            serde_json::json!("1721822400000-0000-rust1"),
        ] {
            assert!(
                !is_timestamp(&timestamp),
                "{timestamp} must not be a valid timestamp"
            );
        }
    }

    /* -------------------------------------------------------------------- */
    /* Ingestion                                                            */
    /* -------------------------------------------------------------------- */

    fn queue() -> ProtocolQueue {
        ProtocolQueue::new("rust-ingest-test").unwrap()
    }

    const TWO_RECORDS: &str = r#"{
        "formatVersion": 1,
        "records": [
            {
                "table": "documents",
                "recordId": "doc-9",
                "operation": "upsert",
                "baseRevision": "41",
                "payload": { "updatedAt": 1753876800123456789, "title": "alpha" }
            },
            {
                "table": "documents",
                "recordId": "doc-10",
                "operation": "delete",
                "payload": {}
            }
        ]
    }"#;

    #[test]
    fn ingest_queues_one_mutation_per_record_in_file_order() {
        let mut queue = queue();
        let ids = ingest_envelope(&mut queue, TWO_RECORDS, IngestOptions::default()).unwrap();
        assert_eq!(ids, ["1", "2"]);

        let pending: Vec<_> = queue.pending().collect();
        assert_eq!(pending.len(), 2);
        assert_eq!(pending[0].operation, Operation::Upsert);
        assert_eq!(pending[0].record_id, "doc-9");
        assert_eq!(pending[0].base_revision.as_deref(), Some("41"));
        assert!(!pending[0].resurrect);
        assert_eq!(pending[0].payload.as_ref().unwrap()["title"], "alpha");
        assert_eq!(pending[1].operation, Operation::Delete);
        assert_eq!(pending[1].record_id, "doc-10");
        assert_eq!(pending[1].payload, None);
    }

    #[test]
    fn ingest_does_not_restamp_the_payload_timestamps() {
        // The envelope's own updatedAt is the record's history; rewriting it
        // here would make an import outrank every existing replica.
        let mut queue = queue();
        ingest_envelope(&mut queue, TWO_RECORDS, IngestOptions::default()).unwrap();
        let payload = queue.all()[0].payload.clone().unwrap();
        assert_eq!(
            payload["updatedAt"],
            serde_json::json!(1753876800123456789_i64)
        );
    }

    #[test]
    fn ingest_can_opt_into_resurrecting_tombstones() {
        let mut queue = queue();
        ingest_envelope(&mut queue, TWO_RECORDS, IngestOptions { resurrect: true }).unwrap();
        assert!(queue.all()[0].resurrect);
    }

    #[test]
    fn nothing_queues_when_any_record_is_invalid() {
        let mut queue = queue();
        let error = ingest_envelope(
            &mut queue,
            &serde_json::json!({
                "formatVersion": 1,
                "records": [
                    upsert(serde_json::json!({ "updatedAt": 1 })),
                    { "table": "todos", "recordId": "todo-2", "payload": {} }
                ]
            })
            .to_string(),
            IngestOptions::default(),
        )
        .unwrap_err();
        assert_eq!(issue_paths(&error), ["records.1.payload.updatedAt"]);
        assert_eq!(queue.pending().count(), 0);
    }

    #[test]
    fn a_record_the_queue_refuses_rolls_back_the_whole_ingest() {
        // `_private` satisfies the envelope's SQL-safe identifier but not the
        // wire protocol's scope id, which must start alphanumeric. The first
        // record must not survive the second one's rejection.
        let mut queue = queue();
        let error = ingest_envelope(
            &mut queue,
            &serde_json::json!({
                "formatVersion": 1,
                "records": [
                    upsert(serde_json::json!({ "updatedAt": 1 })),
                    {
                        "table": "_private",
                        "recordId": "todo-2",
                        "payload": { "updatedAt": 1 }
                    }
                ]
            })
            .to_string(),
            IngestOptions::default(),
        )
        .unwrap_err();
        assert_eq!(error, IngestError::Queue(ProtocolError::InvalidTarget));
        assert_eq!(queue.pending().count(), 0);
        assert_eq!(queue, self::queue(), "the queue must be untouched");
    }

    #[test]
    fn ingest_reports_invalid_json_rather_than_queueing_nothing_silently() {
        let mut queue = queue();
        assert_eq!(
            ingest_envelope(&mut queue, "{not json", IngestOptions::default()),
            Err(IngestError::InvalidJson)
        );
    }
}
