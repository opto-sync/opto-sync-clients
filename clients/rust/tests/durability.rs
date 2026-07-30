//! Durability of the mutation queue.
//!
//! `InMemoryStore` is deliberately not durable — persistence is the
//! integrator's choice (SQLite, sled, a file, an existing app database). What
//! must be true is that [`MutationStore`] is a *sufficient* seam to implement
//! durability against: an optimistic local-first write has to survive the
//! process dying before it reaches the server.
//!
//! This test implements a minimal file-backed store to prove the trait is
//! adequate, then drops and reloads it to show that both queued payloads and
//! status transitions survive.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use opto_sync_client::{Mutation, MutationStatus, MutationStore, OptoSyncClient};

/// Line-oriented file store: `id \t status \t payload`.
/// Payloads in this test are single-line JSON, which keeps the fixture trivial;
/// a real implementation would use its database's own encoding.
struct FileStore {
    path: PathBuf,
    next_id: u64,
    rows: BTreeMap<u64, (MutationStatus, String)>,
}

impl FileStore {
    fn open(path: impl AsRef<Path>) -> Self {
        let path = path.as_ref().to_path_buf();
        let mut rows = BTreeMap::new();
        let mut max_id = 0;
        if let Ok(text) = fs::read_to_string(&path) {
            for line in text.lines().filter(|l| !l.trim().is_empty()) {
                let mut parts = line.splitn(3, '\t');
                let id: u64 = parts.next().unwrap().parse().unwrap();
                let status = match parts.next().unwrap() {
                    "pending" => MutationStatus::Pending,
                    "synced" => MutationStatus::Synced,
                    _ => MutationStatus::Failed,
                };
                let payload = parts.next().unwrap_or("").to_string();
                max_id = max_id.max(id);
                rows.insert(id, (status, payload));
            }
        }
        Self {
            path,
            next_id: max_id + 1,
            rows,
        }
    }

    /// Flush synchronously: an fsync-less queue would lose exactly the writes
    /// this test exists to protect.
    fn flush(&self) {
        let mut out = String::new();
        for (id, (status, payload)) in &self.rows {
            let s = match status {
                MutationStatus::Pending => "pending",
                MutationStatus::Synced => "synced",
                MutationStatus::Failed => "failed",
            };
            out.push_str(&format!("{id}\t{s}\t{payload}\n"));
        }
        fs::write(&self.path, out).expect("queue must be writable");
    }

    fn set_status(&mut self, id: u64, status: MutationStatus) -> bool {
        match self.rows.get_mut(&id) {
            Some(entry) => {
                entry.0 = status;
                self.flush();
                true
            }
            None => false,
        }
    }
}

impl MutationStore for FileStore {
    fn queue_mutation(&mut self, payload: String) -> u64 {
        let id = self.next_id;
        self.next_id += 1;
        self.rows.insert(id, (MutationStatus::Pending, payload));
        self.flush();
        id
    }

    fn pending(&self) -> Vec<Mutation> {
        self.rows
            .iter()
            .filter(|(_, (status, _))| *status == MutationStatus::Pending)
            .map(|(id, (status, payload))| Mutation {
                id: *id,
                payload: payload.clone(),
                status: *status,
            })
            .collect()
    }

    fn mark_synced(&mut self, id: u64) -> bool {
        self.set_status(id, MutationStatus::Synced)
    }

    fn mark_failed(&mut self, id: u64) -> bool {
        self.set_status(id, MutationStatus::Failed)
    }
}

/// Unique per test process; no clock or RNG needed (both are unavailable in
/// some sandboxes and would make the test non-deterministic anyway).
fn temp_queue_path(tag: &str) -> PathBuf {
    let mut p = std::env::temp_dir();
    p.push(format!(
        "opto_sync_durability_{}_{tag}.tsv",
        std::process::id()
    ));
    let _ = fs::remove_file(&p);
    p
}

#[test]
fn queued_mutations_and_statuses_survive_a_reload() {
    let path = temp_queue_path("queue");

    // ── Session 1: queue two writes "offline", then die. ────────────────
    let kept_id;
    {
        let mut client = OptoSyncClient::new(FileStore::open(&path));
        kept_id = client
            .queue_mutation(r#"{"id":"r1","title":"survive a restart"}"#.to_string())
            .unwrap();
        client
            .queue_mutation(r#"{"id":"r2","title":"also survive"}"#.to_string())
            .unwrap();
        assert_eq!(client.store().pending().len(), 2);
    } // dropped — as an app exit would

    assert!(path.exists(), "queue must be on disk, not only in memory");

    // ── Session 2: relaunch over the same file. ─────────────────────────
    {
        let store = FileStore::open(&path);
        let pending = store.pending();
        assert_eq!(pending.len(), 2, "both pending writes must be recovered");
        assert!(
            pending.iter().all(|m| m.status == MutationStatus::Pending),
            "recovered writes are still pending, not silently marked synced"
        );
        assert!(pending
            .iter()
            .any(|m| m.payload.contains("survive a restart")));

        let mut client = OptoSyncClient::new(store);
        assert!(client.store_mut().mark_synced(kept_id));
    }

    // ── Session 3: the status transition must also be durable, or a
    //    relaunch would re-send work the server already accepted. ────────
    {
        let store = FileStore::open(&path);
        let pending = store.pending();
        assert_eq!(
            pending.len(),
            1,
            "the synced mutation must not come back as pending"
        );
        assert!(pending[0].payload.contains("also survive"));
    }

    fs::remove_file(&path).ok();
}

#[test]
fn reconcile_still_works_against_a_recovered_queue() {
    // Recovery must not change merge semantics: a payload replayed from disk
    // reconciles exactly as one queued in memory would.
    let path = temp_queue_path("reconcile");
    let local = r#"{"rows":[{"id":"a","updatedAt":9000,"v":"local"}]}"#;
    let stale_incoming = r#"{"rows":[{"id":"a","updatedAt":1,"v":"stale"}]}"#;

    {
        let mut client = OptoSyncClient::new(FileStore::open(&path));
        client.queue_mutation(stale_incoming.to_string()).unwrap();
    }

    let store = FileStore::open(&path);
    let recovered = store.pending().remove(0).payload;
    let client = OptoSyncClient::new(store);
    let merged = client
        .reconcile_incoming(local, &recovered)
        .expect("merge must succeed");

    assert!(
        merged.contains("local"),
        "stale replayed write must be rejected: {merged}"
    );
    assert!(!merged.contains("stale"));

    fs::remove_file(&path).ok();
}
