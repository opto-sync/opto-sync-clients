#![cfg(feature = "sqlite")]

use opto_sync_client::protocol::{
    Change, MutationResult, Operation, ProtocolError, PushResponse, ResultStatus, SnapshotRecord,
};
use opto_sync_client::protocol_sync::AtomicProtocolSyncStore;
use opto_sync_client::sqlite::{SqliteProtocolStore, SqliteStoreError};
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Barrier};

static NEXT_PATH: AtomicU64 = AtomicU64::new(1);

struct TestDatabase(PathBuf);

impl TestDatabase {
    fn new(label: &str) -> Self {
        let mut path = std::env::temp_dir();
        path.push(format!(
            "opto_sync_sqlite_{}_{}_{}.sqlite",
            std::process::id(),
            NEXT_PATH.fetch_add(1, Ordering::Relaxed),
            label
        ));
        remove_sqlite_files(&path);
        Self(path)
    }

    fn path(&self) -> &Path {
        &self.0
    }
}

impl Drop for TestDatabase {
    fn drop(&mut self) {
        remove_sqlite_files(&self.0);
    }
}

fn remove_sqlite_files(path: &Path) {
    let _ = fs::remove_file(path);
    let _ = fs::remove_file(format!("{}-wal", path.display()));
    let _ = fs::remove_file(format!("{}-shm", path.display()));
}

fn change(record_id: &str, record: Value, checkpoint: &str) -> Change {
    Change {
        checkpoint: checkpoint.to_string(),
        table: "tasks".to_string(),
        record_id: record_id.to_string(),
        operation: Operation::Upsert,
        record: Some(record),
        revision: checkpoint.to_string(),
        source: None,
    }
}

fn response(
    client_id: &str,
    mutation_id: &str,
    status: ResultStatus,
    original_status: Option<ResultStatus>,
) -> PushResponse {
    PushResponse {
        protocol_version: 1,
        client_id: client_id.to_string(),
        last_mutation_id: mutation_id.to_string(),
        checkpoint: "7".to_string(),
        results: vec![MutationResult {
            mutation_id: mutation_id.to_string(),
            status,
            original_status,
            checkpoint: (status != ResultStatus::Rejected).then(|| "7".to_string()),
            revision: (status == ResultStatus::Applied).then(|| "7".to_string()),
            code: (status == ResultStatus::Rejected).then(|| "REVISION_CONFLICT".to_string()),
            message: None,
        }],
    }
}

#[test]
fn optimistic_record_and_queue_survive_reopen_and_client_identity_is_bound() {
    let database = TestDatabase::new("restart");
    {
        let mut store = SqliteProtocolStore::open(database.path(), "device-a").unwrap();
        assert_eq!(
            store
                .queue_upsert_record(
                    "tasks",
                    "r1",
                    json!({"title": "offline", "nested": {"local": true}}),
                    None,
                    false,
                )
                .unwrap(),
            "1"
        );
        let local = store.local_record("tasks", "r1").unwrap().unwrap();
        assert_eq!(local.record["nested"]["local"], true);
    }

    let store = SqliteProtocolStore::open(database.path(), "device-a").unwrap();
    assert_eq!(store.load_queue().unwrap().pending().count(), 1);
    assert_eq!(
        store.local_record("tasks", "r1").unwrap().unwrap().record["title"],
        "offline"
    );
    drop(store);

    assert!(matches!(
        SqliteProtocolStore::open(database.path(), "other-device"),
        Err(SqliteStoreError::ClientMismatch { .. })
    ));
}

#[test]
fn application_failure_rolls_back_row_queue_and_mutation_sequence() {
    let database = TestDatabase::new("application-rollback");
    let mut store = SqliteProtocolStore::open(database.path(), "device-a").unwrap();
    store
        .connection()
        .execute_batch(
            "CREATE TABLE app_tasks (
               id TEXT PRIMARY KEY NOT NULL,
               document TEXT NOT NULL
             ) STRICT;",
        )
        .unwrap();

    let failure = store.queue_upsert_with(
        "tasks",
        "r1",
        json!({"title": "must roll back"}),
        None,
        false,
        |transaction, _, payload| {
            transaction.execute(
                "INSERT INTO app_tasks(id, document) VALUES (?1, ?2)",
                rusqlite::params!["r1", serde_json::to_string(payload).unwrap()],
            )?;
            Err(SqliteStoreError::Application(
                "injected failure".to_string(),
            ))
        },
    );
    assert!(matches!(failure, Err(SqliteStoreError::Application(_))));
    assert_eq!(
        store
            .connection()
            .query_row("SELECT count(*) FROM app_tasks", [], |row| row
                .get::<_, i64>(0))
            .unwrap(),
        0
    );
    assert_eq!(store.load_queue().unwrap().all().len(), 0);

    assert_eq!(
        store
            .queue_upsert_with(
                "tasks",
                "r1",
                json!({"title": "committed"}),
                None,
                false,
                |transaction, _, payload| {
                    transaction.execute(
                        "INSERT INTO app_tasks(id, document) VALUES (?1, ?2)",
                        rusqlite::params![
                            "r1",
                            serde_json::to_string(payload).expect("serializable payload")
                        ],
                    )?;
                    Ok(())
                },
            )
            .unwrap(),
        "1",
        "a rolled-back allocation must not leave a mutation-id gap"
    );
}

#[test]
fn concurrent_connections_cannot_race_past_queue_quota_or_duplicate_ids() {
    let database = TestDatabase::new("concurrency");
    drop(SqliteProtocolStore::open_with_limits(database.path(), "device-a", 1, 1024).unwrap());
    let barrier = Arc::new(Barrier::new(8));
    let path = Arc::new(database.path().to_path_buf());
    let handles = (0..8)
        .map(|worker| {
            let barrier = Arc::clone(&barrier);
            let path = Arc::clone(&path);
            std::thread::spawn(move || {
                let mut store =
                    SqliteProtocolStore::open_with_limits(path.as_path(), "device-a", 1, 1024)
                        .unwrap();
                barrier.wait();
                store.queue_upsert_record(
                    "tasks",
                    format!("r{worker}"),
                    json!({"worker": worker}),
                    None,
                    false,
                )
            })
        })
        .collect::<Vec<_>>();
    let outcomes = handles
        .into_iter()
        .map(|handle| handle.join().expect("worker panicked"))
        .collect::<Vec<_>>();

    assert_eq!(outcomes.iter().filter(|result| result.is_ok()).count(), 1);
    assert_eq!(
        outcomes
            .iter()
            .filter(|result| matches!(
                result,
                Err(SqliteStoreError::Protocol(ProtocolError::QueueFull))
            ))
            .count(),
        7
    );
    let store = SqliteProtocolStore::open(database.path(), "device-a").unwrap();
    let queue = store.load_queue().unwrap();
    assert_eq!(queue.pending().count(), 1);
    assert_eq!(queue.all()[0].mutation_id, "1");
    assert_eq!(
        store
            .connection()
            .query_row("SELECT count(*) FROM _opto_sync_local", [], |row| {
                row.get::<_, i64>(0)
            })
            .unwrap(),
        1
    );
}

#[test]
fn sync_commits_merge_concurrent_appends_instead_of_overwriting_them() {
    let database = TestDatabase::new("sync-append-race");
    let mut syncing = SqliteProtocolStore::open(database.path(), "device-a").unwrap();
    let mut writer = SqliteProtocolStore::open(database.path(), "device-a").unwrap();
    syncing
        .queue_upsert_record("tasks", "r1", json!({"value": 1}), None, false)
        .unwrap();
    let mut sync_queue = syncing.load_queue().unwrap();
    let request = sync_queue.push_request(1).unwrap();

    writer
        .queue_upsert_record("tasks", "r2", json!({"value": 2}), None, false)
        .unwrap();
    let acknowledgement = response("device-a", "1", ResultStatus::Applied, None);
    sync_queue.acknowledge(&acknowledgement, &request).unwrap();
    syncing
        .persist_acknowledgement(&mut sync_queue, &request, &acknowledgement)
        .unwrap();
    assert_eq!(
        sync_queue
            .pending()
            .map(|mutation| mutation.mutation_id.as_str())
            .collect::<Vec<_>>(),
        vec!["2"],
        "the store must feed a concurrently appended mutation back to the driver"
    );

    writer
        .queue_upsert_record("tasks", "r3", json!({"value": 3}), None, false)
        .unwrap();
    sync_queue.set_checkpoint("7").unwrap();
    syncing
        .apply_changes_and_persist(&[change("r1", json!({"value": 1}), "7")], &mut sync_queue)
        .unwrap();
    assert_eq!(
        sync_queue
            .pending()
            .map(|mutation| mutation.mutation_id.as_str())
            .collect::<Vec<_>>(),
        vec!["2", "3"]
    );
    assert_eq!(
        syncing
            .load_queue()
            .unwrap()
            .all()
            .iter()
            .map(|mutation| mutation.mutation_id.as_str())
            .collect::<Vec<_>>(),
        vec!["1", "2", "3"]
    );
    assert_eq!(
        syncing
            .queue_upsert_record("tasks", "r4", json!({"value": 4}), None, false)
            .unwrap(),
        "4"
    );
}

#[test]
fn semantic_queue_corruption_and_unknown_schema_fail_closed() {
    let invalid_state = TestDatabase::new("corrupt");
    let store = SqliteProtocolStore::open(invalid_state.path(), "device-a").unwrap();
    store
        .connection()
        .execute(
            "UPDATE _opto_sync_protocol_state SET queue_json = ?1",
            [json!({
                "clientId": "device-a",
                "nextMutationId": 1,
                "checkpoint": "0",
                "mutations": [{
                    "mutationId": "1",
                    "operation": "delete",
                    "table": "tasks",
                    "recordId": "r1"
                }],
                "maxPendingMutations": 10,
                "maxQueuedPayloadBytes": 1024
            })
            .to_string()],
        )
        .unwrap();
    assert!(matches!(store.load_queue(), Err(SqliteStoreError::Json(_))));
    assert!(store
        .connection()
        .execute(
            "UPDATE _opto_sync_protocol_state SET queue_json = 'not json'",
            []
        )
        .is_err());
    drop(store);

    let unknown_schema = TestDatabase::new("schema");
    let store = SqliteProtocolStore::open(unknown_schema.path(), "device-a").unwrap();
    store
        .connection()
        .execute(
            "UPDATE _opto_sync_meta SET value = '2' WHERE key = 'schema_version'",
            [],
        )
        .unwrap();
    drop(store);
    assert!(matches!(
        SqliteProtocolStore::open(unknown_schema.path(), "device-a"),
        Err(SqliteStoreError::UnsupportedSchema(2))
    ));
}

#[test]
fn rejected_ack_removes_overlay_but_applied_ack_waits_for_authoritative_echo() {
    let rejected_database = TestDatabase::new("rejected");
    let mut rejected =
        SqliteProtocolStore::open(rejected_database.path(), "device-rejected").unwrap();
    rejected
        .queue_upsert_record(
            "tasks",
            "r1",
            json!({"title": "will be rejected"}),
            None,
            false,
        )
        .unwrap();
    let mut rejected_queue = rejected.load_queue().unwrap();
    let rejected_request = rejected_queue.push_request(100).unwrap();
    let rejected_response = response(
        "device-rejected",
        "1",
        ResultStatus::Duplicate,
        Some(ResultStatus::Rejected),
    );
    rejected_queue
        .acknowledge(&rejected_response, &rejected_request)
        .unwrap();
    rejected
        .persist_acknowledgement(&mut rejected_queue, &rejected_request, &rejected_response)
        .unwrap();
    assert!(rejected.local_record("tasks", "r1").unwrap().is_none());
    drop(rejected);
    assert_eq!(
        SqliteProtocolStore::open(rejected_database.path(), "device-rejected")
            .unwrap()
            .load_queue()
            .unwrap()
            .pending()
            .count(),
        0
    );

    let applied_database = TestDatabase::new("applied");
    let mut applied = SqliteProtocolStore::open(applied_database.path(), "device-applied").unwrap();
    applied
        .queue_upsert_record("tasks", "r1", json!({"title": "optimistic"}), None, false)
        .unwrap();
    let mut applied_queue = applied.load_queue().unwrap();
    let applied_request = applied_queue.push_request(100).unwrap();
    let applied_response = response("device-applied", "1", ResultStatus::Applied, None);
    applied_queue
        .acknowledge(&applied_response, &applied_request)
        .unwrap();
    applied
        .persist_acknowledgement(&mut applied_queue, &applied_request, &applied_response)
        .unwrap();
    assert_eq!(
        applied.local_record("tasks", "r1").unwrap().unwrap().record["title"],
        "optimistic"
    );

    applied_queue.set_checkpoint("7").unwrap();
    applied
        .apply_changes_and_persist(
            &[change(
                "r1",
                json!({"title": "authoritative", "serverOnly": true}),
                "7",
            )],
            &mut applied_queue,
        )
        .unwrap();
    let local = applied.local_record("tasks", "r1").unwrap().unwrap();
    assert_eq!(local.record["title"], "authoritative");
    assert_eq!(local.record["serverOnly"], true);
    assert_eq!(applied.load_queue().unwrap().checkpoint(), "7");
}

#[test]
fn later_rejection_preserves_an_earlier_accepted_overlay_until_pull_catches_up() {
    let database = TestDatabase::new("accepted-overlay");
    let mut store = SqliteProtocolStore::open(database.path(), "device-a").unwrap();
    store
        .queue_upsert_record("tasks", "r1", json!({"title": "accepted"}), None, false)
        .unwrap();
    store
        .queue_upsert_record(
            "tasks",
            "r1",
            json!({"description": "rejected"}),
            None,
            false,
        )
        .unwrap();

    let mut queue = store.load_queue().unwrap();
    let first_request = queue.push_request(1).unwrap();
    let first_response = response("device-a", "1", ResultStatus::Applied, None);
    queue.acknowledge(&first_response, &first_request).unwrap();
    store
        .persist_acknowledgement(&mut queue, &first_request, &first_response)
        .unwrap();

    let second_request = queue.push_request(1).unwrap();
    let second_response = response("device-a", "2", ResultStatus::Rejected, None);
    queue
        .acknowledge(&second_response, &second_request)
        .unwrap();
    store
        .persist_acknowledgement(&mut queue, &second_request, &second_response)
        .unwrap();
    let local = store.local_record("tasks", "r1").unwrap().unwrap();
    assert_eq!(local.record["title"], "accepted");
    assert!(local.record.get("description").is_none());
    drop(store);

    let mut reopened = SqliteProtocolStore::open(database.path(), "device-a").unwrap();
    assert_eq!(
        reopened
            .local_record("tasks", "r1")
            .unwrap()
            .unwrap()
            .record["title"],
        "accepted"
    );
    queue.set_checkpoint("7").unwrap();
    reopened
        .apply_changes_and_persist(
            &[change("r1", json!({"title": "accepted"}), "7")],
            &mut queue,
        )
        .unwrap();
    assert_eq!(
        reopened
            .connection()
            .query_row(
                "SELECT count(*) FROM _opto_sync_accepted_overlays",
                [],
                |row| row.get::<_, i64>(0),
            )
            .unwrap(),
        0
    );
    assert_eq!(
        reopened
            .local_record("tasks", "r1")
            .unwrap()
            .unwrap()
            .record,
        json!({"title": "accepted"})
    );
}

#[test]
fn failed_pull_page_rolls_back_authoritative_local_and_checkpoint_together() {
    let database = TestDatabase::new("pull-rollback");
    let mut store = SqliteProtocolStore::open(database.path(), "device-a").unwrap();
    store
        .connection()
        .execute_batch(
            "CREATE TRIGGER reject_boom_local
             BEFORE INSERT ON _opto_sync_local
             WHEN NEW.record_id = 'boom'
             BEGIN
               SELECT RAISE(ABORT, 'injected local write failure');
             END;",
        )
        .unwrap();
    let mut advanced = store.load_queue().unwrap();
    advanced.set_checkpoint("9").unwrap();
    assert!(store
        .apply_changes_and_persist(
            &[change("boom", json!({"title": "must roll back"}), "9")],
            &mut advanced,
        )
        .is_err());
    assert!(store
        .authoritative_record("tasks", "boom")
        .unwrap()
        .is_none());
    assert!(store.local_record("tasks", "boom").unwrap().is_none());
    assert_eq!(store.load_queue().unwrap().checkpoint(), "0");

    store
        .connection()
        .execute_batch("DROP TRIGGER reject_boom_local;")
        .unwrap();
    store
        .apply_changes_and_persist(
            &[change("boom", json!({"title": "committed"}), "9")],
            &mut advanced,
        )
        .unwrap();
    drop(store);
    let reopened = SqliteProtocolStore::open(database.path(), "device-a").unwrap();
    assert_eq!(reopened.load_queue().unwrap().checkpoint(), "9");
    assert_eq!(
        reopened
            .authoritative_record("tasks", "boom")
            .unwrap()
            .unwrap()
            .record["title"],
        "committed"
    );
}

#[test]
fn snapshot_failure_rolls_back_and_success_rebases_pending_overlay() {
    let database = TestDatabase::new("snapshot");
    let mut store = SqliteProtocolStore::open(database.path(), "device-a").unwrap();
    let mut initial_queue = store.load_queue().unwrap();
    initial_queue.set_checkpoint("1").unwrap();
    store
        .apply_changes_and_persist(
            &[change("old", json!({"title": "old server row"}), "1")],
            &mut initial_queue,
        )
        .unwrap();
    store
        .queue_upsert_record(
            "tasks",
            "local",
            json!({"title": "pending local row"}),
            None,
            false,
        )
        .unwrap();
    let mut snapshot_queue = store.load_queue().unwrap();
    snapshot_queue.set_checkpoint("42").unwrap();
    let records = vec![SnapshotRecord {
        table: "tasks".to_string(),
        record_id: "server-new".to_string(),
        record: json!({"title": "snapshot server row"}),
        revision: "42".to_string(),
    }];
    store
        .connection()
        .execute_batch(
            "CREATE TRIGGER reject_snapshot_local
             BEFORE INSERT ON _opto_sync_local
             WHEN NEW.record_id = 'server-new'
             BEGIN
               SELECT RAISE(ABORT, 'injected snapshot failure');
             END;",
        )
        .unwrap();
    assert!(store
        .replace_authoritative_and_persist(&records, &mut snapshot_queue)
        .is_err());
    assert_eq!(store.load_queue().unwrap().checkpoint(), "1");
    assert!(store
        .authoritative_record("tasks", "old")
        .unwrap()
        .is_some());
    assert!(store
        .authoritative_record("tasks", "server-new")
        .unwrap()
        .is_none());
    assert_eq!(
        store
            .local_record("tasks", "local")
            .unwrap()
            .unwrap()
            .record["title"],
        "pending local row"
    );

    store
        .connection()
        .execute_batch("DROP TRIGGER reject_snapshot_local;")
        .unwrap();
    store
        .replace_authoritative_and_persist(&records, &mut snapshot_queue)
        .unwrap();
    assert!(store
        .authoritative_record("tasks", "old")
        .unwrap()
        .is_none());
    assert!(store
        .authoritative_record("tasks", "server-new")
        .unwrap()
        .is_some());
    assert_eq!(
        store
            .local_record("tasks", "local")
            .unwrap()
            .unwrap()
            .record["title"],
        "pending local row"
    );
    assert_eq!(store.load_queue().unwrap().checkpoint(), "42");
    assert_eq!(store.load_queue().unwrap().pending().count(), 1);
}

#[test]
fn delete_changes_and_pending_delete_remove_reference_local_rows() {
    let mut store = SqliteProtocolStore::open_in_memory("device-a").unwrap();
    let mut queue = store.load_queue().unwrap();
    queue.set_checkpoint("1").unwrap();
    store
        .apply_changes_and_persist(
            &[change("r1", json!({"title": "server row"}), "1")],
            &mut queue,
        )
        .unwrap();
    assert!(store.local_record("tasks", "r1").unwrap().is_some());

    store
        .queue_delete_record("tasks", "r1", Some("1".to_string()))
        .unwrap();
    assert!(store.local_record("tasks", "r1").unwrap().is_none());

    let mut delete_queue = store.load_queue().unwrap();
    let request = delete_queue.push_request(100).unwrap();
    let ack = response("device-a", "1", ResultStatus::Applied, None);
    delete_queue.acknowledge(&ack, &request).unwrap();
    delete_queue.set_checkpoint("2").unwrap();
    store
        .persist_acknowledgement(&mut delete_queue, &request, &ack)
        .unwrap();
    store
        .apply_changes_and_persist(
            &[Change {
                checkpoint: "2".to_string(),
                table: "tasks".to_string(),
                record_id: "r1".to_string(),
                operation: Operation::Delete,
                record: None,
                revision: "2".to_string(),
                source: None,
            }],
            &mut delete_queue,
        )
        .unwrap();
    assert!(store.authoritative_record("tasks", "r1").unwrap().is_none());
    assert!(store.local_record("tasks", "r1").unwrap().is_none());
}
