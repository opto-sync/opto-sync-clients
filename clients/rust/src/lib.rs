//! opto-sync client library.
//!
//! External projects import this crate to perform optimistic local writes and
//! reconcile them against server state. The heavy lifting (deep JSON merge
//! with CRDT-style timestamp resolution) is done by the statically linked
//! `syncer` C core via the `syncer-rs` binding.
//!
//! Building blocks:
//!
//! - [`reconcile`] / [`ReconcileOptions`]: merge a base document with an
//!   incoming one. Defaults are CRDT-flavored: Last-Write-Wins on
//!   `updatedAt,syncedAt`, First-Write-Wins on `createdAt`, arrays merged
//!   element-by-identity on `id`.
//! - [`MutationStore`] / [`InMemoryStore`]: a queue of optimistic mutations
//!   with `Pending` / `Synced` / `Failed` lifecycle.
//! - [`OptoSyncClient`]: ties the two together.

use syncer_rs::{try_merge_json_with_options, MergeOptions};

pub use syncer_rs::version as core_version;

/* ------------------------------------------------------------------------ */
/* Reconciliation                                                           */
/* ------------------------------------------------------------------------ */

/// How array elements are matched during reconciliation.
///
/// Re-exported from `syncer-rs`; [`ArrayStrategy::MergeByKey`] (the default)
/// matches object elements by identity keys and deep-merges matched pairs.
pub use syncer_rs::ArrayMergeStrategy as ArrayStrategy;

/// Options controlling [`reconcile`].
#[derive(Debug, Clone)]
pub struct ReconcileOptions {
    /// Array merge strategy. Default: [`ArrayStrategy::MergeByKey`].
    pub array_strategy: ArrayStrategy,
    /// Comma-separated identity keys for `MergeByKey` (e.g. `"uuid,id"`).
    /// Default: `"id"`. A numeric id `42` matches the string `"42"`.
    pub array_match_keys: String,
    /// Enable CRDT-like timestamp resolution. Default: `true`.
    pub resolve_by_timestamp: bool,
    /// Comma-separated Last-Write-Wins keys. Default: `"updatedAt,syncedAt"`.
    pub lww_keys: String,
    /// Comma-separated First-Write-Wins keys. Default: `"createdAt"`.
    pub fww_keys: String,
    /// Maximum merge recursion depth; `0` = unlimited. Default: `0`.
    pub max_depth: u32,
}

impl Default for ReconcileOptions {
    fn default() -> Self {
        Self {
            array_strategy: ArrayStrategy::MergeByKey,
            array_match_keys: "id".to_string(),
            resolve_by_timestamp: true,
            lww_keys: "updatedAt,syncedAt".to_string(),
            fww_keys: "createdAt".to_string(),
            max_depth: 0,
        }
    }
}

impl ReconcileOptions {
    fn to_merge_options(&self) -> MergeOptions {
        MergeOptions {
            array_strategy: Some(self.array_strategy),
            max_depth: Some(self.max_depth),
            detect_circular_refs: false,
            resolve_by_timestamp: self.resolve_by_timestamp,
            lww_keys: Some(self.lww_keys.clone()),
            fww_keys: Some(self.fww_keys.clone()),
            array_match_keys: Some(self.array_match_keys.clone()),
        }
    }
}

/// Errors from [`reconcile`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ReconcileError {
    /// An input was not valid JSON (or contained an interior NUL byte).
    InvalidJson,
}

impl std::fmt::Display for ReconcileError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ReconcileError::InvalidJson => write!(f, "input is not valid JSON"),
        }
    }
}

impl std::error::Error for ReconcileError {}

/// Reconcile `incoming_json` on top of `base_json`.
///
/// Returns the merged document as a JSON string. With default options, stale
/// incoming writes lose by `updatedAt`/`syncedAt` (Last-Write-Wins), the
/// earliest `createdAt` sticks (First-Write-Wins), and arrays of objects are
/// merged by `id` identity.
pub fn reconcile(
    base_json: &str,
    incoming_json: &str,
    opts: &ReconcileOptions,
) -> Result<String, ReconcileError> {
    try_merge_json_with_options(base_json, incoming_json, &opts.to_merge_options())
        .ok_or(ReconcileError::InvalidJson)
}

/* ------------------------------------------------------------------------ */
/* Mutation queue                                                           */
/* ------------------------------------------------------------------------ */

/// Lifecycle state of a queued optimistic mutation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MutationStatus {
    Pending,
    Synced,
    Failed,
}

/// A locally queued optimistic write.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Mutation {
    /// Store-assigned id, unique within the store.
    pub id: u64,
    /// The JSON payload of the optimistic write.
    pub payload: String,
    pub status: MutationStatus,
}

/// Storage backend for the optimistic mutation queue.
///
/// Implement this over your persistence of choice (sqlite, IndexedDB via
/// wasm, files, ...). [`InMemoryStore`] is provided for tests and simple
/// clients.
pub trait MutationStore {
    /// Queue a new mutation as [`MutationStatus::Pending`]; returns its id.
    fn queue_mutation(&mut self, payload: String) -> u64;
    /// All mutations currently in [`MutationStatus::Pending`], oldest first.
    fn pending(&self) -> Vec<Mutation>;
    /// Mark a mutation [`MutationStatus::Synced`]. Returns `false` if the id
    /// is unknown.
    fn mark_synced(&mut self, id: u64) -> bool;
    /// Mark a mutation [`MutationStatus::Failed`]. Returns `false` if the id
    /// is unknown.
    fn mark_failed(&mut self, id: u64) -> bool;
}

/// Simple in-memory [`MutationStore`].
#[derive(Debug, Default)]
pub struct InMemoryStore {
    next_id: u64,
    mutations: Vec<Mutation>,
}

impl InMemoryStore {
    pub fn new() -> Self {
        Self::default()
    }

    /// Every mutation ever queued, regardless of status, oldest first.
    pub fn all(&self) -> &[Mutation] {
        &self.mutations
    }

    fn set_status(&mut self, id: u64, status: MutationStatus) -> bool {
        match self.mutations.iter_mut().find(|m| m.id == id) {
            Some(m) => {
                m.status = status;
                true
            }
            None => false,
        }
    }
}

impl MutationStore for InMemoryStore {
    fn queue_mutation(&mut self, payload: String) -> u64 {
        let id = self.next_id;
        self.next_id += 1;
        self.mutations.push(Mutation {
            id,
            payload,
            status: MutationStatus::Pending,
        });
        id
    }

    fn pending(&self) -> Vec<Mutation> {
        self.mutations
            .iter()
            .filter(|m| m.status == MutationStatus::Pending)
            .cloned()
            .collect()
    }

    fn mark_synced(&mut self, id: u64) -> bool {
        self.set_status(id, MutationStatus::Synced)
    }

    fn mark_failed(&mut self, id: u64) -> bool {
        self.set_status(id, MutationStatus::Failed)
    }
}

/* ------------------------------------------------------------------------ */
/* Client                                                                   */
/* ------------------------------------------------------------------------ */

/// Client for optimistic writes + reconciliation.
///
/// ```
/// use opto_sync_client::{InMemoryStore, MutationStore, OptoSyncClient};
///
/// let mut client = OptoSyncClient::new(InMemoryStore::new());
/// let id = client.queue_mutation(r#"{"title":"draft","updatedAt":100}"#.to_string());
/// let merged = client
///     .reconcile_incoming(
///         r#"{"title":"draft","updatedAt":100}"#,
///         r#"{"title":"server","updatedAt":200}"#,
///     )
///     .unwrap();
/// assert!(merged.contains("server"));
/// client.store_mut().mark_synced(id);
/// ```
#[derive(Debug)]
pub struct OptoSyncClient<S: MutationStore> {
    store: S,
    options: ReconcileOptions,
}

impl<S: MutationStore> OptoSyncClient<S> {
    /// Create a client with default (CRDT-flavored) [`ReconcileOptions`].
    pub fn new(store: S) -> Self {
        Self::with_options(store, ReconcileOptions::default())
    }

    pub fn with_options(store: S, options: ReconcileOptions) -> Self {
        Self { store, options }
    }

    pub fn options(&self) -> &ReconcileOptions {
        &self.options
    }

    pub fn store(&self) -> &S {
        &self.store
    }

    pub fn store_mut(&mut self) -> &mut S {
        &mut self.store
    }

    /// Queue an optimistic local write; returns the store-assigned id.
    pub fn queue_mutation(&mut self, payload: String) -> u64 {
        self.store.queue_mutation(payload)
    }

    /// Reconcile server-`incoming` state on top of `local` state using this
    /// client's options.
    pub fn reconcile_incoming(
        &self,
        local: &str,
        incoming: &str,
    ) -> Result<String, ReconcileError> {
        reconcile(local, incoming, &self.options)
    }
}

/* ------------------------------------------------------------------------ */
/* Tests                                                                    */
/* ------------------------------------------------------------------------ */

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn queue_lifecycle() {
        let mut client = OptoSyncClient::new(InMemoryStore::new());
        let a = client.queue_mutation(r#"{"op":"a"}"#.to_string());
        let b = client.queue_mutation(r#"{"op":"b"}"#.to_string());
        assert_ne!(a, b);

        let pending = client.store().pending();
        assert_eq!(pending.len(), 2);
        assert_eq!(pending[0].id, a);
        assert_eq!(pending[0].status, MutationStatus::Pending);

        assert!(client.store_mut().mark_synced(a));
        assert!(client.store_mut().mark_failed(b));
        assert!(client.store().pending().is_empty());

        let all = client.store().all().to_vec();
        assert_eq!(all[0].status, MutationStatus::Synced);
        assert_eq!(all[1].status, MutationStatus::Failed);

        // Unknown ids are reported, not swallowed.
        assert!(!client.store_mut().mark_synced(999));
        assert!(!client.store_mut().mark_failed(999));
    }

    #[test]
    fn reconcile_stale_vs_fresh_by_updated_at() {
        let client = OptoSyncClient::new(InMemoryStore::new());

        // Incoming is fresher: it wins.
        let merged = client
            .reconcile_incoming(
                r#"{"title":"local","updatedAt":100}"#,
                r#"{"title":"server","updatedAt":200}"#,
            )
            .unwrap();
        assert!(merged.contains(r#""title":"server""#), "{merged}");

        // Incoming is stale: local wins.
        let merged = client
            .reconcile_incoming(
                r#"{"title":"local","updatedAt":300}"#,
                r#"{"title":"server","updatedAt":200}"#,
            )
            .unwrap();
        assert!(merged.contains(r#""title":"local""#), "{merged}");
        assert!(!merged.contains("server"), "{merged}");
    }

    #[test]
    fn created_at_first_write_wins() {
        // An incoming "re-creation" with a newer createdAt must not clobber
        // the original.
        let merged = reconcile(
            r#"{"owner":"original","createdAt":100}"#,
            r#"{"owner":"recreated","createdAt":900}"#,
            &ReconcileOptions::default(),
        )
        .unwrap();
        assert!(merged.contains(r#""owner":"original""#), "{merged}");
        assert!(!merged.contains("recreated"), "{merged}");
        assert!(merged.contains(r#""createdAt":100"#), "{merged}");
    }

    #[test]
    fn merge_by_key_array_reconciliation() {
        // id:1 only local (kept), id:2 both (merged; incoming fresher wins),
        // id:3 only incoming (appended). Order in incoming is shuffled to
        // prove matching is by identity, not index.
        let local = r#"{"todos":[
            {"id":1,"text":"keep me"},
            {"id":2,"text":"old","updatedAt":100}
        ]}"#;
        let incoming = r#"{"todos":[
            {"id":3,"text":"new row"},
            {"id":2,"text":"newer","updatedAt":200}
        ]}"#;
        let merged = reconcile(local, incoming, &ReconcileOptions::default()).unwrap();
        assert!(merged.contains(r#""text":"keep me""#), "{merged}");
        assert!(merged.contains(r#""text":"newer""#), "{merged}");
        assert!(!merged.contains(r#""text":"old""#), "{merged}");
        assert!(merged.contains(r#""text":"new row""#), "{merged}");
        assert_eq!(merged.matches(r#""id":2"#).count(), 1, "{merged}");
    }

    #[test]
    fn custom_match_keys() {
        let mut opts = ReconcileOptions::default();
        opts.array_match_keys = "uuid,id".to_string();
        let merged = reconcile(
            r#"{"rows":[{"uuid":"u1","id":1,"v":"a"}]}"#,
            r#"{"rows":[{"uuid":"u1","id":999,"v":"b"}]}"#,
            &opts,
        )
        .unwrap();
        assert_eq!(merged.matches("u1").count(), 1, "{merged}");
        assert!(merged.contains(r#""v":"b""#), "{merged}");
    }

    #[test]
    fn invalid_json_errors() {
        let client = OptoSyncClient::new(InMemoryStore::new());
        assert_eq!(
            client.reconcile_incoming("{not json", "{}"),
            Err(ReconcileError::InvalidJson)
        );
        assert_eq!(
            reconcile("{}", "also not json", &ReconcileOptions::default()),
            Err(ReconcileError::InvalidJson)
        );
    }

    #[test]
    fn core_version_is_linked() {
        assert!(core_version() >= "0.2.0");
    }
}
