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

/// Recursively feed every string-valued LWW key to the clock.
///
/// Only strings are observed: a numeric `updatedAt` is a legacy epoch value on a
/// different scale, and `HybridLogicalClock::observe` would ignore it anyway.
fn observe_tree(
    clock: &mut SystemClock,
    node: &serde_json::Value,
    keys: &[&str],
) -> Result<(), ClientError> {
    match node {
        serde_json::Value::Array(items) => {
            for item in items {
                observe_tree(clock, item, keys)?;
            }
        }
        serde_json::Value::Object(map) => {
            for key in keys {
                if let Some(serde_json::Value::String(ts)) = map.get(*key) {
                    clock.observe(ts)?;
                }
            }
            for value in map.values() {
                observe_tree(clock, value, keys)?;
            }
        }
        _ => {}
    }
    Ok(())
}

/// Errors from the client's payload-handling entry points.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ClientError {
    /// The payload is not valid JSON.
    InvalidJson,
    /// The payload parsed but is not a JSON object, so there is nowhere to put
    /// `updatedAt`. Reported rather than silently skipped: a write that quietly
    /// goes out unstamped loses every conflict against a stamped one.
    NotAJsonObject,
    /// The clock refused something — in practice [`ClockError::Drift`] from
    /// [`OptoSyncClient::observe_incoming`].
    Clock(ClockError),
}

impl std::fmt::Display for ClientError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ClientError::InvalidJson => write!(f, "payload is not valid JSON"),
            ClientError::NotAJsonObject => {
                write!(f, "payload is not a JSON object, so it cannot be stamped")
            }
            ClientError::Clock(e) => write!(f, "{e}"),
        }
    }
}

impl std::error::Error for ClientError {}

impl From<ClockError> for ClientError {
    fn from(e: ClockError) -> Self {
        ClientError::Clock(e)
    }
}

/// Client for optimistic writes + reconciliation.
///
/// Queued payloads get `updatedAt` stamped from a [`HybridLogicalClock`] unless
/// the caller supplied one — see [`Self::queue_mutation`].
///
/// ```
/// use opto_sync_client::{InMemoryStore, MutationStore, OptoSyncClient};
///
/// let mut client = OptoSyncClient::new(InMemoryStore::new());
/// let id = client
///     .queue_mutation(r#"{"title":"draft","updatedAt":100}"#.to_string())
///     .unwrap();
/// let merged = client
///     .reconcile_incoming(
///         r#"{"title":"draft","updatedAt":100}"#,
///         r#"{"title":"server","updatedAt":200}"#,
///     )
///     .unwrap();
/// assert!(merged.contains("server"));
/// client.store_mut().mark_synced(id);
/// ```
///
/// A durable client persists the clock alongside the queue:
///
/// ```
/// use opto_sync_client::{
///     compose_node_id, ClockPersistence, InMemoryStore, OptoSyncClient, SystemClock,
/// };
///
/// # #[derive(Default)]
/// # struct MyStore(Option<String>);
/// # impl ClockPersistence for MyStore {
/// #     fn load(&self) -> Option<String> { self.0.clone() }
/// #     fn save(&mut self, ts: &str) { self.0 = Some(ts.to_string()); }
/// # }
/// // `device_id` comes from your own durable storage, generated once per install
/// // with `random_node_id(6)`; the per-instance suffix stops two writers over
/// // one store from issuing identical timestamps.
/// let node_id = compose_node_id("9f3a2b", None);
/// let clock = SystemClock::system(node_id, Box::new(MyStore::default())).unwrap();
/// let client = OptoSyncClient::new(InMemoryStore::new()).with_clock(clock);
/// ```
pub struct OptoSyncClient<S: MutationStore> {
    store: S,
    options: ReconcileOptions,
    /// The clock lives on the client, NOT on [`MutationStore`].
    ///
    /// `MutationStore` is implemented by integrators over their own database, so
    /// adding clock methods to it would break every existing implementation and
    /// force everyone to hand-roll HLC persistence. It also conflates two
    /// concerns: the queue holds writes, the clock holds one string. Keeping the
    /// seam separate lets an integrator back both with the same database while
    /// implementing only what they need — and lets a caller drop stamping
    /// entirely with [`Self::without_clock`].
    clock: Option<SystemClock>,
}

/// Manual because [`SystemClock`] holds a `Box<dyn Fn>`, which is not `Debug`.
impl<S: MutationStore + std::fmt::Debug> std::fmt::Debug for OptoSyncClient<S> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("OptoSyncClient")
            .field("store", &self.store)
            .field("options", &self.options)
            .field("clock_node_id", &self.clock.as_ref().map(|c| c.node_id()))
            .finish()
    }
}

impl<S: MutationStore> OptoSyncClient<S> {
    /// Create a client with default (CRDT-flavored) [`ReconcileOptions`] and a
    /// stamping clock over the system wall clock.
    ///
    /// The default clock is **not durable** and its node id is fresh per
    /// process. That is a deliberate trade: stamping by default is what keeps a
    /// mixed fleet ordered, and a client that stamps nothing loses every
    /// conflict to one that does. For a real device pass a persisted device id
    /// and durable storage via [`Self::with_clock`].
    pub fn new(store: S) -> Self {
        Self::with_options(store, ReconcileOptions::default())
    }

    pub fn with_options(store: S, options: ReconcileOptions) -> Self {
        let clock = SystemClock::system(
            compose_node_id(&random_node_id(6), None),
            Box::new(NoPersistence),
        )
        .ok();
        Self { store, options, clock }
    }

    /// Install a clock — typically one with durable persistence and a device id
    /// that survives a restart.
    pub fn with_clock(mut self, clock: SystemClock) -> Self {
        self.clock = Some(clock);
        self
    }

    /// Stop stamping `updatedAt`.
    ///
    /// Only correct when something else supplies an ordered `updatedAt` — a
    /// server-authoritative timestamp, or callers that always stamp themselves.
    /// With no stamp at all the engine's last-write-wins falls back to raw
    /// device clocks, and a fast or non-HLC writer wins every conflict.
    pub fn without_clock(mut self) -> Self {
        self.clock = None;
        self
    }

    pub fn options(&self) -> &ReconcileOptions {
        &self.options
    }

    /// The clock used for stamping, if any.
    pub fn clock(&self) -> Option<&SystemClock> {
        self.clock.as_ref()
    }

    pub fn clock_mut(&mut self) -> Option<&mut SystemClock> {
        self.clock.as_mut()
    }

    /// Stable identity of this writer: the clock's node id. `None` when
    /// stamping is disabled.
    pub fn client_id(&self) -> Option<&str> {
        self.clock.as_ref().map(|c| c.node_id())
    }

    pub fn store(&self) -> &S {
        &self.store
    }

    pub fn store_mut(&mut self) -> &mut S {
        &mut self.store
    }

    /// Queue an optimistic local write; returns the store-assigned id.
    ///
    /// `updatedAt` is stamped from this client's [`HybridLogicalClock`] when the
    /// payload does not already carry one. Without a logically-ordered stamp the
    /// engine's last-write-wins is decided by device clock skew — and worse, the
    /// C core compares non-digit strings *lexicographically*, so a writer
    /// supplying an ISO-8601 date beats an HLC writer on every conflict until the
    /// year 2286. Stamping here is what stops a mixed fleet from having a
    /// silently privileged writer.
    ///
    /// `createdAt` is deliberately never stamped: it belongs to whoever created
    /// the record, and a client inventing one only manufactures conflicts.
    ///
    /// The payload is an opaque JSON string, so it is parsed and re-serialized
    /// to insert the field. Key order is therefore not preserved; JSON objects
    /// are unordered and the merge core does not depend on it.
    pub fn queue_mutation(&mut self, payload: String) -> Result<u64, ClientError> {
        let value: serde_json::Value =
            serde_json::from_str(&payload).map_err(|_| ClientError::InvalidJson)?;
        self.queue_mutation_value(value)
    }

    /// [`Self::queue_mutation`] for callers that already hold a parsed payload,
    /// which avoids a redundant parse/serialize round trip.
    pub fn queue_mutation_value(
        &mut self,
        mut payload: serde_json::Value,
    ) -> Result<u64, ClientError> {
        let obj = payload.as_object_mut().ok_or(ClientError::NotAJsonObject)?;
        if let Some(clock) = self.clock.as_mut() {
            if !obj.contains_key("updatedAt") {
                obj.insert("updatedAt".to_string(), serde_json::Value::String(clock.next()));
            }
        }
        Ok(self.store.queue_mutation(payload.to_string()))
    }

    /// Advance this client's clock past the timestamps in a payload received
    /// from elsewhere, so its next write is ordered *after* what it has already
    /// seen. Call this when pulling server state; [`Self::reconcile_incoming`]
    /// is pure and cannot do it.
    ///
    /// Walks every LWW key (see [`ReconcileOptions::lww_keys`]) at every depth,
    /// because a pull commonly returns a collection or a nested document rather
    /// than one flat record.
    ///
    /// # Errors
    ///
    /// [`ClientError::Clock`] wrapping [`ClockError::Drift`] if a peer's
    /// timestamp is implausibly far in the future. The clock keeps whatever it
    /// legitimately adopted before the refusal; the payload itself is fine to
    /// merge, so a caller may log and continue.
    pub fn observe_incoming(&mut self, payload: &str) -> Result<(), ClientError> {
        let value: serde_json::Value =
            serde_json::from_str(payload).map_err(|_| ClientError::InvalidJson)?;
        let Some(clock) = self.clock.as_mut() else { return Ok(()) };
        let keys: Vec<&str> = self
            .options
            .lww_keys
            .split(',')
            .map(str::trim)
            .filter(|k| !k.is_empty())
            .collect();
        observe_tree(clock, &value, &keys)
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
        client.queue_mutation(r#"{"id":"t1","title":"my edit","updatedAt":"1"}"#.to_string()).unwrap();

        let server = r#"{"id":"t1","title":"server title","done":false,"updatedAt":"9000"}"#;
        let view = client.local_view(server).unwrap();

        assert!(view.contains("my edit"), "pending edit must show: {view}");
        assert!(view.contains("done"), "server-only fields survive: {view}");
    }

    #[test]
    fn local_view_settles_on_server_state_once_synced() {
        let mut client = OptoSyncClient::new(InMemoryStore::new());
        let id = client.queue_mutation(r#"{"id":"t1","title":"my edit","updatedAt":"1"}"#.to_string()).unwrap();
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
        let a = client.queue_mutation(r#"{"op":"a"}"#.to_string()).unwrap();
        let b = client.queue_mutation(r#"{"op":"b"}"#.to_string()).unwrap();
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
    fn default_policy_has_no_first_write_wins_keys() {
        // Pins the default. FWW is a node-level veto, so shipping `createdAt`
        // here silently made whole records unwritable.
        let opts = ReconcileOptions::default();
        assert_eq!(opts.lww_keys, "updatedAt,syncedAt");
        assert_eq!(opts.fww_keys, "", "createdAt must not be a default FWW key");
        assert!(opts.to_merge_options().fww_keys.is_none());
    }

    #[test]
    fn a_later_created_at_no_longer_vetoes_a_newer_write() {
        // REGRESSION. With `createdAt` in fww_keys the engine discarded this
        // entire incoming node — the vastly newer write vanished, silently, and
        // any replica holding a later createdAt could never write to the record
        // again. Two devices creating the same id offline guarantees that state.
        let merged = reconcile(
            r#"{"createdAt":100,"updatedAt":100,"v":"base"}"#,
            r#"{"createdAt":200,"updatedAt":999999,"v":"NEWEST"}"#,
            &ReconcileOptions::default(),
        )
        .unwrap();
        assert!(merged.contains(r#""v":"NEWEST""#), "newer write must land: {merged}");
        assert!(!merged.contains(r#""v":"base""#), "{merged}");
    }

    #[test]
    fn first_write_wins_is_still_available_when_asked_for() {
        // The capability is intact — it is just no longer the default. An
        // incoming "re-creation" with a newer createdAt is vetoed on request.
        let opts = ReconcileOptions {
            fww_keys: "createdAt".to_string(),
            ..ReconcileOptions::default()
        };
        let merged = reconcile(
            r#"{"owner":"original","createdAt":100}"#,
            r#"{"owner":"recreated","createdAt":900}"#,
            &opts,
        )
        .unwrap();
        assert!(merged.contains(r#""owner":"original""#), "{merged}");
        assert!(!merged.contains("recreated"), "{merged}");
        assert!(merged.contains(r#""createdAt":100"#), "{merged}");
    }

    #[test]
    fn created_at_still_merges_without_fww() {
        // Dropping the veto must not lose the field: an incoming createdAt on a
        // record that has none is still adopted, and the LWW rule still decides.
        let merged = reconcile(
            r#"{"id":"r1","updatedAt":100}"#,
            r#"{"id":"r1","createdAt":50,"updatedAt":200}"#,
            &ReconcileOptions::default(),
        )
        .unwrap();
        assert!(merged.contains(r#""createdAt":50"#), "{merged}");
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

    /* -------------------------------------------------------------------- */
    /* Clock stamping                                                      */
    /* -------------------------------------------------------------------- */

    /// Clock pinned to a fixed wall time so stamps are assertable.
    fn fixed_clock(node_id: &str, ms: u64) -> SystemClock {
        let persistence: Box<dyn ClockPersistence> = Box::new(NoPersistence);
        HybridLogicalClock::new(node_id, Box::new(move || ms), persistence).unwrap()
    }

    fn queued_payload<S: MutationStore>(client: &OptoSyncClient<S>) -> serde_json::Value {
        serde_json::from_str(&client.store().pending()[0].payload).unwrap()
    }

    #[test]
    fn queue_mutation_stamps_updated_at_from_the_clock() {
        // The actual bug this fixes: an unstamped payload leaves last-write-wins
        // at the mercy of raw device clocks, and the C core's lexicographic
        // comparison lets an ISO-8601 writer beat an HLC writer until 2286.
        let mut client = OptoSyncClient::new(InMemoryStore::new())
            .with_clock(fixed_clock("rust1", 1_721_822_400_000));
        client.queue_mutation(r#"{"id":"t1","title":"no timestamp"}"#.to_string()).unwrap();

        let stamped = queued_payload(&client);
        let ts = stamped["updatedAt"].as_str().expect("updatedAt must be stamped");
        assert_eq!(ts, "1721822400000-0000-rust1");
        assert!(parse_hlc(ts).is_some(), "the stamp must be a parseable HLC: {ts}");
        assert_eq!(stamped["title"], "no timestamp", "other fields must survive");
    }

    #[test]
    fn queue_mutation_does_not_overwrite_a_caller_supplied_updated_at() {
        let mut client = OptoSyncClient::new(InMemoryStore::new())
            .with_clock(fixed_clock("rust1", 1_721_822_400_000));
        client
            .queue_mutation(r#"{"id":"t1","updatedAt":"caller-owned"}"#.to_string())
            .unwrap();
        assert_eq!(queued_payload(&client)["updatedAt"], "caller-owned");
    }

    #[test]
    fn queue_mutation_never_stamps_created_at() {
        // createdAt belongs to whoever created the record. Inventing one only
        // manufactures conflicts.
        let mut client = OptoSyncClient::new(InMemoryStore::new())
            .with_clock(fixed_clock("rust1", 1_721_822_400_000));
        client.queue_mutation(r#"{"id":"t1"}"#.to_string()).unwrap();
        assert!(queued_payload(&client).get("createdAt").is_none());
    }

    #[test]
    fn queue_mutation_stamps_by_default() {
        // Parity with the TypeScript client: stamping is on unless opted out. A
        // client that silently does not stamp loses every conflict to one that
        // does.
        let mut client = OptoSyncClient::new(InMemoryStore::new());
        assert!(client.client_id().is_some(), "the default client must have a clock");
        client.queue_mutation(r#"{"id":"t1"}"#.to_string()).unwrap();
        assert!(queued_payload(&client)["updatedAt"].is_string());
    }

    #[test]
    fn without_clock_queues_the_payload_untouched() {
        let mut client = OptoSyncClient::new(InMemoryStore::new()).without_clock();
        client.queue_mutation(r#"{"id":"t1"}"#.to_string()).unwrap();
        assert!(queued_payload(&client).get("updatedAt").is_none());
        assert!(client.client_id().is_none());
    }

    #[test]
    fn queue_mutation_reports_payloads_it_cannot_stamp() {
        let mut client = OptoSyncClient::new(InMemoryStore::new());
        assert_eq!(client.queue_mutation("{not json".to_string()), Err(ClientError::InvalidJson));
        assert_eq!(
            client.queue_mutation("[1,2,3]".to_string()),
            Err(ClientError::NotAJsonObject),
            "a non-object payload must be reported, not quietly queued unstamped"
        );
        assert!(client.store().pending().is_empty(), "nothing may be queued on error");
    }

    #[test]
    fn stamped_writes_are_ordered_by_the_merge_engine() {
        // End-to-end reason stamping exists: two clients whose wall clocks
        // disagree still converge on the causally-later write.
        let mut fast = OptoSyncClient::new(InMemoryStore::new())
            .with_clock(fixed_clock("fast", 1_721_822_430_000)); // 30s ahead
        let mut slow = OptoSyncClient::new(InMemoryStore::new())
            .with_clock(fixed_clock("slow", 1_721_822_400_000));

        fast.queue_mutation(r#"{"id":"r1","title":"from fast device"}"#.to_string()).unwrap();
        let fast_edit = fast.store().pending()[0].payload.clone();

        // The slow device sees the fast write, then makes a genuinely later edit.
        slow.observe_incoming(&fast_edit).unwrap();
        slow.queue_mutation(r#"{"id":"r1","title":"from slow device"}"#.to_string()).unwrap();
        let slow_edit = slow.store().pending()[0].payload.clone();

        for (base, incoming) in [(&fast_edit, &slow_edit), (&slow_edit, &fast_edit)] {
            let merged = reconcile(base, incoming, &ReconcileOptions::default()).unwrap();
            assert!(
                merged.contains("from slow device"),
                "the causally-later edit must survive in either order: {merged}"
            );
        }
    }

    #[test]
    fn observe_incoming_walks_nested_payloads() {
        // A pull returns collections, not one flat record, so a top-level-only
        // walk would leave the clock behind timestamps it has already seen.
        let mut client = OptoSyncClient::new(InMemoryStore::new())
            .with_clock(fixed_clock("me", 1_721_822_400_000));
        let remote = "1721822405000-00ff-peer";
        client
            .observe_incoming(&format!(r#"{{"rows":[{{"id":"a","updatedAt":"{remote}"}}]}}"#))
            .unwrap();

        client.queue_mutation(r#"{"id":"a","v":1}"#.to_string()).unwrap();
        let stamp = queued_payload(&client)["updatedAt"].as_str().unwrap().to_string();
        assert!(stamp > remote.to_string(), "{stamp} must outrank observed {remote}");
    }

    #[test]
    fn observe_incoming_refuses_an_implausible_peer_timestamp() {
        // Bounded trust end to end: one peer with a broken clock must not be
        // able to drag this client's clock into the future, or every honest
        // write here loses forever.
        let wall = 1_721_822_400_000u64;
        let mut client =
            OptoSyncClient::new(InMemoryStore::new()).with_clock(fixed_clock("me", wall));
        let poisoned = format!("{}-0000-evil", wall + DEFAULT_MAX_DRIFT_MS + 60_000);
        let err = client
            .observe_incoming(&format!(r#"{{"id":"a","updatedAt":"{poisoned}"}}"#))
            .unwrap_err();
        assert!(matches!(err, ClientError::Clock(ClockError::Drift { .. })), "{err:?}");

        client.queue_mutation(r#"{"id":"a"}"#.to_string()).unwrap();
        let stamp = queued_payload(&client)["updatedAt"].as_str().unwrap().to_string();
        assert!(stamp < poisoned, "a refused timestamp must not be adopted: {stamp}");
    }

    #[test]
    fn observe_incoming_ignores_legacy_timestamp_scales() {
        let mut client = OptoSyncClient::new(InMemoryStore::new())
            .with_clock(fixed_clock("me", 1_721_822_400_000));
        client
            .observe_incoming(r#"{"a":{"updatedAt":"2026-07-25T00:00:00Z"},"b":{"updatedAt":1}}"#)
            .unwrap();
        assert_eq!(client.clock().unwrap().peek().millis, 0);
    }
}
