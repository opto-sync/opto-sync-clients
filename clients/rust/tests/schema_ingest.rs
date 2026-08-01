//! The Rust validator against the SHARED cross-language fixture corpus.
//!
//! `schema/fixtures/` is the same directory the TypeScript, Dart, and Gleam
//! suites read. It is located by walking up from this crate rather than copied,
//! so a fixture added for one language immediately binds all four.

use std::fs;
use std::path::{Path, PathBuf};

use opto_sync_client::protocol::{Operation, ProtocolQueue};
use opto_sync_client::schema::{ingest_envelope, parse_envelope, IngestError, IngestOptions};

fn locate_fixtures() -> PathBuf {
    let start = Path::new(env!("CARGO_MANIFEST_DIR"));
    let mut directory = start;
    for _ in 0..10 {
        let candidate = directory.join("schema").join("fixtures");
        if candidate.is_dir() {
            return candidate;
        }
        match directory.parent() {
            Some(parent) => directory = parent,
            None => break,
        }
    }
    panic!("could not locate schema/fixtures above {}", start.display());
}

/// Fixture file names, sorted so a failure names the same file everywhere.
fn json_files(subdirectory: &str) -> Vec<PathBuf> {
    let directory = locate_fixtures().join(subdirectory);
    let mut files: Vec<PathBuf> = fs::read_dir(&directory)
        .unwrap_or_else(|error| panic!("cannot read {}: {error}", directory.display()))
        .map(|entry| entry.expect("readable directory entry").path())
        .filter(|path| {
            path.extension()
                .is_some_and(|extension| extension == "json")
        })
        .collect();
    files.sort();
    files
}

fn read(path: &Path) -> String {
    fs::read_to_string(path)
        .unwrap_or_else(|error| panic!("cannot read {}: {error}", path.display()))
}

#[test]
fn accepts_every_shared_valid_fixture() {
    let files = json_files("valid");
    assert!(files.len() >= 3, "the shared corpus is missing");
    for file in files {
        let envelope = parse_envelope(&read(&file))
            .unwrap_or_else(|error| panic!("{} must parse: {error}", file.display()));
        assert!(
            !envelope.records.is_empty(),
            "{} must carry records",
            file.display()
        );
    }
}

#[test]
fn rejects_every_shared_invalid_fixture() {
    let files = json_files("invalid");
    assert!(files.len() >= 4, "the shared corpus is missing");
    for file in files {
        let error = parse_envelope(&read(&file))
            .expect_err(&format!("{} must be rejected", file.display()));
        assert!(
            matches!(error, IngestError::Invalid(_)),
            "{} must fail validation, not parsing: {error:?}",
            file.display()
        );
    }
}

#[test]
fn ingest_queues_one_mutation_per_record_in_file_order() {
    let mut queue = ProtocolQueue::new("rust-fixture-client").unwrap();
    let raw = read(
        &locate_fixtures()
            .join("valid")
            .join("nested-keyed-arrays.json"),
    );
    let ids = ingest_envelope(&mut queue, &raw, IngestOptions::default()).unwrap();
    assert_eq!(ids.len(), 2);

    let pending: Vec<_> = queue.pending().collect();
    assert_eq!(pending.len(), 2);
    assert_eq!(pending[0].operation, Operation::Upsert);
    assert_eq!(pending[0].record_id, "doc-9");
    assert_eq!(pending[0].base_revision.as_deref(), Some("41"));
    let payload = pending[0]
        .payload
        .as_ref()
        .expect("upsert carries a payload");
    assert_eq!(payload["sections"].as_array().unwrap().len(), 2);
    assert_eq!(pending[1].operation, Operation::Delete);
    assert_eq!(pending[1].record_id, "doc-10");
}

#[test]
fn nothing_queues_when_any_record_is_invalid() {
    let mut queue = ProtocolQueue::new("rust-fixture-client").unwrap();
    let raw = read(
        &locate_fixtures()
            .join("invalid")
            .join("missing-updated-at.json"),
    );
    let error = ingest_envelope(&mut queue, &raw, IngestOptions::default()).unwrap_err();
    assert!(matches!(error, IngestError::Invalid(_)), "{error:?}");
    assert_eq!(queue.pending().count(), 0);
}
