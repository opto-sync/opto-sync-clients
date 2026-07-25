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
//!   `updatedAt,syncedAt`, no First-Write-Wins keys, arrays merged
//!   element-by-identity on `id`.
//! - [`MutationStore`] / [`InMemoryStore`]: a queue of optimistic mutations
//!   with `Pending` / `Synced` / `Failed` lifecycle.
//! - [`OptoSyncClient`]: ties the two together, and stamps `updatedAt` from a
//!   [`HybridLogicalClock`] so last-write-wins is actually ordered.

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

pub mod clock;
pub use clock::{
    compare_hlc, compose_node_id, format_hlc, parse_hlc, random_node_id, system_now_ms, ClockError,
    ClockPersistence, HlcParts, HybridLogicalClock, NoPersistence, SystemClock,
    DEFAULT_MAX_DRIFT_MS,
};

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
    /// Comma-separated First-Write-Wins keys. **Default: empty** — see below.
    ///
    /// First-write-wins is not field protection, it is a **node-level veto**: if
    /// the incoming document's FWW key is newer, the engine rejects that whole
    /// node, discarding every other field of the write. `createdAt` used to be
    /// the default here, which meant a replica holding a later `createdAt` for a
    /// record could never be written to again — silently, with a successful
    /// merge. Two devices creating the same id offline guarantees it:
    ///
    /// ```text
    /// base     {"createdAt":100,"updatedAt":100,"v":"base"}
    /// incoming {"createdAt":200,"updatedAt":999999,"v":"NEWEST"}
    /// result   base, unchanged — the vastly newer write is thrown away
    /// ```
    ///
    /// The capability is intact for callers who genuinely want
    /// first-writer-owns-the-node; set this explicitly to opt in.
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
            // Deliberately empty. See the field docs: FWW vetoes the whole node.
            fww_keys: String::new(),
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
            // An empty list means "no FWW keys", which the core expresses as a
            // null pointer. Passing "" happens to work too, but None says it.
            fww_keys: Some(self.fww_keys.clone()).filter(|k| !k.is_empty()),
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
/// incoming writes lose by `updatedAt`/`syncedAt` (Last-Write-Wins), no key
/// gets First-Write-Wins treatment (see [`ReconcileOptions::fww_keys`] for why
/// `createdAt` no longer does), and arrays of objects are merged by `id`
/// identity.
pub fn reconcile(
    base_json: &str,
    incoming_json: &str,
    opts: &ReconcileOptions,
) -> Result<String, ReconcileError> {
    try_merge_json_with_options(base_json, incoming_json, &opts.to_merge_options())
        .ok_or(ReconcileError::InvalidJson)
}

/// Rebase un-confirmed local writes on top of authoritative server state.
///
/// This is the invariant that makes optimistic writes safe. A pull replaces the
/// base with server state, then every mutation the server has not yet confirmed
/// is replayed on top, so a user never watches their un-pushed edit disappear.
/// Replicache describes the same operation as a git rebase.
///
/// # Why the overlay ignores timestamps by default
///
/// Engines that replay *mutator functions* get this for free. opto-sync merges
/// *documents* under last-write-wins, so a naive replay reintroduces the very
/// bug rebase exists to prevent: a pending edit stamped before the server's
/// newer `updatedAt` is rejected as stale and vanishes from the view while
/// still sitting in the queue, so the record flips back once the push lands.
///
/// Pending mutations are this client's own latest intent, not a concurrent
/// writer to arbitrate against, so the overlay applies them unconditionally.
/// Authority still rests with the server: the queued payloads are untouched and
/// whatever the server decides arrives on the next pull. Set
/// `gate_overlay_by_timestamp` to opt into strict gating.
///
/// `pending` must be **oldest first** — the order they will reach the server.
pub fn rebase_pending<'a, I>(
    server_json: &str,
    pending: I,
    opts: &ReconcileOptions,
    gate_overlay_by_timestamp: bool,
) -> Result<String, ReconcileError>
where
    I: IntoIterator<Item = &'a str>,
{
    let mut overlay = opts.clone();
    if !gate_overlay_by_timestamp {
        overlay.resolve_by_timestamp = false;
    }

    let mut view = server_json.to_string();
    for payload in pending {
        view = reconcile(&view, payload, &overlay)?;
    }
    Ok(view)
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

    /// The view to render: authoritative server state with this client's
    /// still-pending writes replayed on top.
    ///
    /// Prefer this over [`Self::reconcile_incoming`] whenever the queue is in
    /// play. `reconcile_incoming` reconciles two documents and knows nothing
    /// about mutations awaiting push, so rendering its result drops any pending
    /// edit the server's timestamp outranks — the edit reappears when the push
    /// lands, which reads as the UI undoing and redoing the user's work.
    pub fn local_view(&self, server_json: &str) -> Result<String, ReconcileError> {
        let pending = self.store.pending();
        rebase_pending(
            server_json,
            pending.iter().map(|m| m.payload.as_str()),
            &self.options,
            false,
        )
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
    #[test]
    fn rebase_replays_pending_write_over_newer_server_state() {
        // The server's updatedAt is newer, so a plain reconcile rejects the
        // local edit as stale — correct for a remote writer, wrong for this
        // client's own un-pushed intent.
        let server = r#"{"id":"r1","title":"server title","updatedAt":"9000"}"#;
        let pending = r#"{"id":"r1","title":"my un-pushed edit","updatedAt":"1000"}"#;
        let opts = ReconcileOptions::default();

        let plain = reconcile(server, pending, &opts).unwrap();
        assert!(
            plain.contains("server title"),
            "plain reconcile drops the stale-looking local edit: {plain}"
        );

        let view = rebase_pending(server, [pending], &opts, false).unwrap();
        assert!(
            view.contains("my un-pushed edit"),
            "pending write must survive the pull: {view}"
        );
    }

    #[test]
    fn rebase_applies_pending_oldest_first() {
        let server = r#"{"id":"r1","title":"server","updatedAt":"9000"}"#;
        let first = r#"{"id":"r1","title":"first edit","updatedAt":"1"}"#;
        let second = r#"{"id":"r1","title":"second edit","updatedAt":"2"}"#;

        let view =
            rebase_pending(server, [first, second], &ReconcileOptions::default(), false).unwrap();
        assert!(view.contains("second edit"), "newest queued edit must win: {view}");
    }

    #[test]
    fn rebase_preserves_untouched_server_fields() {
        let server = r#"{"id":"r1","title":"server","owner":"alice","updatedAt":"9000"}"#;
        let pending = r#"{"id":"r1","title":"mine","updatedAt":"1"}"#;

        let view = rebase_pending(server, [pending], &ReconcileOptions::default(), false).unwrap();
        assert!(view.contains("alice"), "untouched server fields must survive: {view}");
        assert!(view.contains("mine"));
    }

    #[test]
    fn rebase_with_no_pending_is_server_state() {
        let server = r#"{"id":"r1","title":"server","updatedAt":"9000"}"#;
        let view = rebase_pending(server, [], &ReconcileOptions::default(), false).unwrap();
        assert!(view.contains("server"));
    }

    #[test]
    fn rebase_gating_restores_strict_last_write_wins() {
        let server = r#"{"id":"r1","title":"server title","updatedAt":"9000"}"#;
        let pending = r#"{"id":"r1","title":"stale local","updatedAt":"1000"}"#;

        let view = rebase_pending(server, [pending], &ReconcileOptions::default(), true).unwrap();
        assert!(view.contains("server title"), "opt-in gating must reject it: {view}");
    }

    #[test]
    fn rebase_surfaces_invalid_json_rather_than_yielding_empty() {
        let err = rebase_pending(
            r#"{"id":"r1"}"#,
            ["{not json"],
            &ReconcileOptions::default(),
            false,
        );
        assert!(matches!(err, Err(ReconcileError::InvalidJson)));
    }

    #[test]
    fn local_view_rebases_the_client_queue() {
        let mut client = OptoSyncClient::new(InMemoryStore::new());
        client.queue_mutation(r#"{"id":"t1","title":"my edit","updatedAt":"1"}"#.to_string());

        let server = r#"{"id":"t1","title":"server title","done":false,"updatedAt":"9000"}"#;
        let view = client.local_view(server).unwrap();

        assert!(view.contains("my edit"), "pending edit must show: {view}");
        assert!(view.contains("done"), "server-only fields survive: {view}");
    }

    #[test]
    fn local_view_settles_on_server_state_once_synced() {
        let mut client = OptoSyncClient::new(InMemoryStore::new());
        let id = client.queue_mutation(r#"{"id":"t1","title":"my edit","updatedAt":"1"}"#.to_string());
        let server = r#"{"id":"t1","title":"server title","updatedAt":"9000"}"#;
        assert!(client.local_view(server).unwrap().contains("my edit"));

        client.store_mut().mark_synced(id);
        let settled = client.local_view(server).unwrap();
        assert!(
            settled.contains("server title") && !settled.contains("my edit"),
            "a synced mutation must stop overriding server truth: {settled}"
        );
    }

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
