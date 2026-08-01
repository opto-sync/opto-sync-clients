//! The Rust validator against the shared cross-language fixture corpus.
//!
//! This walks `schema/fixtures/` rather than restating the cases inline, which
//! is the whole point of the corpus: a fixture added for TypeScript, Dart, or
//! Gleam binds this validator too, and a validator that drifts from the shared
//! schema fails here instead of at a consumer.

use std::path::PathBuf;

use opto_sync_client::schema::{parse_envelope, Operation};

fn fixtures_dir(kind: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../schema/fixtures")
        .join(kind)
}

fn read_fixtures(kind: &str) -> Vec<(String, String)> {
    let dir = fixtures_dir(kind);
    let mut out: Vec<(String, String)> = std::fs::read_dir(&dir)
        .unwrap_or_else(|e| panic!("cannot read {}: {e}", dir.display()))
        .map(|entry| entry.expect("readable dir entry").path())
        .filter(|path| path.extension().is_some_and(|e| e == "json"))
        .map(|path| {
            let name = path.file_name().unwrap().to_string_lossy().into_owned();
            let text = std::fs::read_to_string(&path).expect("readable fixture");
            (name, text)
        })
        .collect();
    out.sort();
    assert!(!out.is_empty(), "no {kind} fixtures found in {}", dir.display());
    out
}

#[test]
fn accepts_every_shared_valid_fixture() {
    for (name, text) in read_fixtures("valid") {
        match parse_envelope(&text) {
            Ok(envelope) => assert!(
                !envelope.records.is_empty(),
                "{name}: parsed but produced no records"
            ),
            Err(error) => panic!("{name}: should have been accepted, got {error}"),
        }
    }
}

#[test]
fn rejects_every_shared_invalid_fixture() {
    for (name, text) in read_fixtures("invalid") {
        let result = parse_envelope(&text);
        assert!(result.is_err(), "{name}: should have been rejected");
        assert!(
            !result.unwrap_err().issues.is_empty(),
            "{name}: rejected without reporting an issue"
        );
    }
}

#[test]
fn parses_the_fields_downstream_consumers_read() {
    let text = std::fs::read_to_string(fixtures_dir("valid").join("nested-keyed-arrays.json"))
        .expect("readable fixture");
    let envelope = parse_envelope(&text).expect("valid fixture");

    assert_eq!(envelope.records.len(), 2);

    let upsert = &envelope.records[0];
    assert_eq!(upsert.table, "documents");
    assert_eq!(upsert.record_id, "doc-9");
    assert_eq!(upsert.operation, Operation::Upsert);
    assert_eq!(upsert.base_revision.as_deref(), Some("41"));
    // The payload passes through intact — ingest has no direct-to-database
    // shortcut, so whatever is here is what reaches the merge core.
    assert!(upsert.payload.contains_key("sections"));

    let delete = &envelope.records[1];
    assert_eq!(delete.operation, Operation::Delete);
    assert!(delete.payload.is_empty());
}

#[test]
fn operation_defaults_to_upsert_when_absent() {
    let text = std::fs::read_to_string(fixtures_dir("valid").join("basic-upsert.json"))
        .expect("readable fixture");
    let envelope = parse_envelope(&text).expect("valid fixture");
    assert_eq!(envelope.records[0].operation, Operation::Upsert);
}

#[test]
fn reports_every_issue_not_merely_the_first() {
    // Two independently broken records: a malformed envelope should be fixable
    // in one pass rather than one error at a time.
    let text = r#"{
      "formatVersion": 1,
      "records": [
        { "table": "bad table", "recordId": "", "payload": {} },
        { "table": "todos", "recordId": "t2", "payload": { "updatedAt": "nope" } }
      ]
    }"#;
    let issues = parse_envelope(text).unwrap_err().issues;
    assert!(issues.len() >= 3, "expected several issues, got {issues:?}");
    assert!(issues.iter().any(|i| i.contains("records.0.table")));
    assert!(issues.iter().any(|i| i.contains("records.1.payload.updatedAt")));
}

#[test]
fn invalid_json_is_an_error_not_a_panic() {
    let error = parse_envelope("{ not json").unwrap_err();
    assert!(error.issues[0].contains("invalid JSON"));
}
