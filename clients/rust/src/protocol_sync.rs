//! Runtime-neutral protocol v1 synchronization.
//!
//! This module owns the correctness-sensitive cycle while leaving HTTP,
//! authentication, timers, and executor selection to the application. Run
//! [`ProtocolSyncDriver::sync_cycle`] on a worker thread or from a runtime's
//! blocking boundary. Live notifications are wake-up hints; the pull checkpoint
//! remains authoritative.

use crate::protocol::{
    Change, Operation, ProtocolError, ProtocolQueue, PullResponse, PushRequest, PushResponse,
    SnapshotInstallError, SnapshotRecord, SnapshotResponse,
};
use serde::{Deserialize, Serialize};
use std::time::Duration;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResetRequired {
    pub protocol_version: u8,
    pub error: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub snapshot_url: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub enum PullResult {
    Changes(PullResponse),
    ResetRequired(ResetRequired),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TransportFailure<E> {
    pub source: E,
    pub retryable: bool,
    pub retry_after: Option<Duration>,
}

impl<E> TransportFailure<E> {
    pub const fn retryable(source: E) -> Self {
        Self {
            source,
            retryable: true,
            retry_after: None,
        }
    }

    pub const fn permanent(source: E) -> Self {
        Self {
            source,
            retryable: false,
            retry_after: None,
        }
    }

    pub const fn with_retry_after(source: E, retry_after: Duration) -> Self {
        Self {
            source,
            retryable: true,
            retry_after: Some(retry_after),
        }
    }
}

/// Application-owned network boundary.
pub trait ProtocolTransport {
    type Error;

    fn push(
        &mut self,
        request: &PushRequest,
    ) -> Result<PushResponse, TransportFailure<Self::Error>>;

    fn pull(
        &mut self,
        checkpoint: &str,
        limit: usize,
    ) -> Result<PullResult, TransportFailure<Self::Error>>;

    fn snapshot(
        &mut self,
        reset: &ResetRequired,
    ) -> Result<SnapshotResponse, TransportFailure<Self::Error>>;
}

pub trait ProtocolSyncCallbacks {
    type Error;

    /// Apply one pull page idempotently.
    ///
    /// A persistence failure after this returns reverts the in-memory
    /// checkpoint, so the page is replayed after restart.
    fn apply_changes(&mut self, changes: &[Change]) -> Result<(), Self::Error>;

    /// Atomically replace the authoritative synced store.
    fn replace_authoritative(&mut self, records: &[SnapshotRecord]) -> Result<(), Self::Error>;
}

/// Durable storage boundary for [`ProtocolQueue`] after every state transition.
pub trait ProtocolQueuePersistence {
    type Error;

    fn persist(&mut self, queue: &ProtocolQueue) -> Result<(), Self::Error>;
}

/// One storage adapter that can commit authoritative rows and queue metadata in
/// the same database transaction.
///
/// Use [`ProtocolSyncDriver::sync_cycle_atomic`] when the downloaded store and
/// serialized [`ProtocolQueue`] share a transactional backend. The original
/// callback + persistence API remains appropriate for separate stores whose
/// page application is idempotent.
pub trait AtomicProtocolSyncStore {
    type Error;

    /// Persist queue-only transitions such as push acknowledgement.
    fn persist_queue(&mut self, queue: &mut ProtocolQueue) -> Result<(), Self::Error>;

    /// Persist a validated push acknowledgement.
    ///
    /// The default only stores queue state. Stores that also materialize an
    /// optimistic local view can inspect durable rejection results here and
    /// remove rejected overlays without waiting for a pull that will never
    /// contain an effect for them.
    fn persist_acknowledgement(
        &mut self,
        queue: &mut ProtocolQueue,
        _request: &PushRequest,
        _response: &PushResponse,
    ) -> Result<(), Self::Error> {
        self.persist_queue(queue)
    }

    /// Commit one authoritative pull page with `queue.checkpoint()`.
    fn apply_changes_and_persist(
        &mut self,
        changes: &[Change],
        queue: &mut ProtocolQueue,
    ) -> Result<(), Self::Error>;

    /// Replace authoritative rows and commit the snapshot checkpoint.
    fn replace_authoritative_and_persist(
        &mut self,
        records: &[SnapshotRecord],
        queue: &mut ProtocolQueue,
    ) -> Result<(), Self::Error>;
}

#[derive(Debug)]
pub enum ProtocolSyncError<TransportError, ApplicationError, PersistenceError> {
    Transport(TransportFailure<TransportError>),
    Application(ApplicationError),
    Persistence(PersistenceError),
    Protocol(ProtocolError),
    InvalidResponse(&'static str),
}

pub type ProtocolSyncResult<ResultValue, TransportError, ApplicationError, PersistenceError> =
    Result<ResultValue, ProtocolSyncError<TransportError, ApplicationError, PersistenceError>>;

impl<T: std::fmt::Display, A: std::fmt::Display, P: std::fmt::Display> std::fmt::Display
    for ProtocolSyncError<T, A, P>
{
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Transport(error) => write!(formatter, "sync transport failed: {}", error.source),
            Self::Application(error) => {
                write!(formatter, "authoritative store update failed: {error}")
            }
            Self::Persistence(error) => write!(formatter, "queue persistence failed: {error}"),
            Self::Protocol(error) => write!(formatter, "{error}"),
            Self::InvalidResponse(message) => formatter.write_str(message),
        }
    }
}

impl<
        T: std::fmt::Debug + std::fmt::Display,
        A: std::fmt::Debug + std::fmt::Display,
        P: std::fmt::Debug + std::fmt::Display,
    > std::error::Error for ProtocolSyncError<T, A, P>
{
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ProtocolSyncOptions {
    pub push_limit: usize,
    pub pull_limit: usize,
    pub max_push_batches_per_cycle: usize,
    pub max_pull_pages_per_phase: usize,
}

impl Default for ProtocolSyncOptions {
    fn default() -> Self {
        Self {
            push_limit: 100,
            pull_limit: 100,
            max_push_batches_per_cycle: 10,
            max_pull_pages_per_phase: 100,
        }
    }
}

impl ProtocolSyncOptions {
    fn validate(self) -> Result<Self, ProtocolError> {
        if !(1..=100).contains(&self.push_limit)
            || !(1..=1000).contains(&self.pull_limit)
            || self.max_push_batches_per_cycle == 0
            || self.max_pull_pages_per_phase == 0
        {
            return Err(ProtocolError::InvalidLimit);
        }
        Ok(self)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProtocolSyncCycleResult {
    pub pushed_mutations: usize,
    pub acknowledged_mutations: usize,
    pub pulled_changes: usize,
    pub installed_snapshots: usize,
    pub checkpoint: String,
    pub has_more_pending: bool,
}

pub struct ProtocolSyncDriver {
    options: ProtocolSyncOptions,
}

impl ProtocolSyncDriver {
    pub fn new(options: ProtocolSyncOptions) -> Result<Self, ProtocolError> {
        Ok(Self {
            options: options.validate()?,
        })
    }

    /// Pull to current, push immutable batches, then pull the server echo.
    ///
    /// Mutable access makes a driver single-flight by construction. Persisted
    /// queue changes are rolled back in memory if [ProtocolQueuePersistence]
    /// fails, preserving safe retry behavior in the current process too.
    pub fn sync_cycle<T, C, P>(
        &self,
        queue: &mut ProtocolQueue,
        transport: &mut T,
        callbacks: &mut C,
        persistence: &mut P,
    ) -> ProtocolSyncResult<ProtocolSyncCycleResult, T::Error, C::Error, P::Error>
    where
        T: ProtocolTransport,
        C: ProtocolSyncCallbacks,
        P: ProtocolQueuePersistence,
    {
        let mut result = ProtocolSyncCycleResult {
            pushed_mutations: 0,
            acknowledged_mutations: 0,
            pulled_changes: 0,
            installed_snapshots: 0,
            checkpoint: queue.checkpoint().to_string(),
            has_more_pending: false,
        };

        self.pull_to_current(queue, transport, callbacks, persistence, &mut result)?;

        for _ in 0..self.options.max_push_batches_per_cycle {
            let request = queue
                .push_request(self.options.push_limit)
                .map_err(ProtocolSyncError::Protocol)?;
            if request.mutations.is_empty() {
                break;
            }
            let response = transport
                .push(&request)
                .map_err(ProtocolSyncError::Transport)?;
            let prior = queue.clone();
            let acknowledged = queue
                .acknowledge(&response, &request)
                .map_err(ProtocolSyncError::Protocol)?;
            if let Err(error) = persistence.persist(queue) {
                *queue = prior;
                return Err(ProtocolSyncError::Persistence(error));
            }
            result.pushed_mutations += request.mutations.len();
            result.acknowledged_mutations += acknowledged;
        }

        result.has_more_pending = queue.pending().next().is_some();
        self.pull_to_current(queue, transport, callbacks, persistence, &mut result)?;
        result.checkpoint = queue.checkpoint().to_string();
        Ok(result)
    }

    /// Pull/push/pull using one transactional authoritative + queue store.
    ///
    /// The driver updates an in-memory clone first, asks `store` to commit the
    /// corresponding rows and serialized queue together, and restores the
    /// clone on failure. This removes the crash window between applying a page
    /// and persisting its checkpoint.
    pub fn sync_cycle_atomic<T, S>(
        &self,
        queue: &mut ProtocolQueue,
        transport: &mut T,
        store: &mut S,
    ) -> ProtocolSyncResult<ProtocolSyncCycleResult, T::Error, S::Error, S::Error>
    where
        T: ProtocolTransport,
        S: AtomicProtocolSyncStore,
    {
        let mut result = ProtocolSyncCycleResult {
            pushed_mutations: 0,
            acknowledged_mutations: 0,
            pulled_changes: 0,
            installed_snapshots: 0,
            checkpoint: queue.checkpoint().to_string(),
            has_more_pending: false,
        };

        self.pull_to_current_atomic(queue, transport, store, &mut result)?;

        for _ in 0..self.options.max_push_batches_per_cycle {
            let request = queue
                .push_request(self.options.push_limit)
                .map_err(ProtocolSyncError::Protocol)?;
            if request.mutations.is_empty() {
                break;
            }
            let response = transport
                .push(&request)
                .map_err(ProtocolSyncError::Transport)?;
            let prior = queue.clone();
            let acknowledged = queue
                .acknowledge(&response, &request)
                .map_err(ProtocolSyncError::Protocol)?;
            if let Err(error) = store.persist_acknowledgement(queue, &request, &response) {
                *queue = prior;
                return Err(ProtocolSyncError::Persistence(error));
            }
            result.pushed_mutations += request.mutations.len();
            result.acknowledged_mutations += acknowledged;
        }

        result.has_more_pending = queue.pending().next().is_some();
        self.pull_to_current_atomic(queue, transport, store, &mut result)?;
        result.checkpoint = queue.checkpoint().to_string();
        Ok(result)
    }

    fn pull_to_current_atomic<T, S>(
        &self,
        queue: &mut ProtocolQueue,
        transport: &mut T,
        store: &mut S,
        result: &mut ProtocolSyncCycleResult,
    ) -> ProtocolSyncResult<(), T::Error, S::Error, S::Error>
    where
        T: ProtocolTransport,
        S: AtomicProtocolSyncStore,
    {
        for _ in 0..self.options.max_pull_pages_per_phase {
            let prior_checkpoint = queue.checkpoint().to_string();
            match transport
                .pull(&prior_checkpoint, self.options.pull_limit)
                .map_err(ProtocolSyncError::Transport)?
            {
                PullResult::ResetRequired(reset) => {
                    if reset.protocol_version != 1 || reset.error != "RESET_REQUIRED" {
                        return Err(ProtocolSyncError::InvalidResponse(
                            "invalid protocol reset response",
                        ));
                    }
                    let snapshot = transport
                        .snapshot(&reset)
                        .map_err(ProtocolSyncError::Transport)?;
                    validate_snapshot(&snapshot, &prior_checkpoint)
                        .map_err(ProtocolSyncError::InvalidResponse)?;
                    let prior = queue.clone();
                    queue
                        .set_checkpoint(snapshot.checkpoint.clone())
                        .map_err(ProtocolSyncError::Protocol)?;
                    if let Err(error) =
                        store.replace_authoritative_and_persist(&snapshot.records, queue)
                    {
                        *queue = prior;
                        return Err(ProtocolSyncError::Application(error));
                    }
                    result.installed_snapshots += 1;
                }
                PullResult::Changes(page) => {
                    validate_pull_page(&page, &prior_checkpoint)
                        .map_err(ProtocolSyncError::InvalidResponse)?;
                    let prior = queue.clone();
                    queue
                        .set_checkpoint(page.checkpoint.clone())
                        .map_err(ProtocolSyncError::Protocol)?;
                    if let Err(error) = store.apply_changes_and_persist(&page.changes, queue) {
                        *queue = prior;
                        return Err(ProtocolSyncError::Application(error));
                    }
                    result.pulled_changes += page.changes.len();
                    if !page.has_more {
                        return Ok(());
                    }
                    if page.checkpoint == prior_checkpoint {
                        return Err(ProtocolSyncError::InvalidResponse(
                            "pull response hasMore without checkpoint progress",
                        ));
                    }
                }
            }
        }
        Err(ProtocolSyncError::InvalidResponse(
            "pull page safety limit exceeded",
        ))
    }

    fn pull_to_current<T, C, P>(
        &self,
        queue: &mut ProtocolQueue,
        transport: &mut T,
        callbacks: &mut C,
        persistence: &mut P,
        result: &mut ProtocolSyncCycleResult,
    ) -> ProtocolSyncResult<(), T::Error, C::Error, P::Error>
    where
        T: ProtocolTransport,
        C: ProtocolSyncCallbacks,
        P: ProtocolQueuePersistence,
    {
        for _ in 0..self.options.max_pull_pages_per_phase {
            let prior_checkpoint = queue.checkpoint().to_string();
            match transport
                .pull(&prior_checkpoint, self.options.pull_limit)
                .map_err(ProtocolSyncError::Transport)?
            {
                PullResult::ResetRequired(reset) => {
                    if reset.protocol_version != 1 || reset.error != "RESET_REQUIRED" {
                        return Err(ProtocolSyncError::InvalidResponse(
                            "invalid protocol reset response",
                        ));
                    }
                    let snapshot = transport
                        .snapshot(&reset)
                        .map_err(ProtocolSyncError::Transport)?;
                    validate_snapshot(&snapshot, &prior_checkpoint)
                        .map_err(ProtocolSyncError::InvalidResponse)?;
                    let prior = queue.clone();
                    match queue.install_snapshot(&snapshot, |records| {
                        callbacks.replace_authoritative(records)
                    }) {
                        Ok(()) => {}
                        Err(SnapshotInstallError::Protocol(error)) => {
                            return Err(ProtocolSyncError::Protocol(error));
                        }
                        Err(SnapshotInstallError::Replace(error)) => {
                            return Err(ProtocolSyncError::Application(error));
                        }
                    }
                    if let Err(error) = persistence.persist(queue) {
                        *queue = prior;
                        return Err(ProtocolSyncError::Persistence(error));
                    }
                    result.installed_snapshots += 1;
                }
                PullResult::Changes(page) => {
                    validate_pull_page(&page, &prior_checkpoint)
                        .map_err(ProtocolSyncError::InvalidResponse)?;
                    if !page.changes.is_empty() {
                        callbacks
                            .apply_changes(&page.changes)
                            .map_err(ProtocolSyncError::Application)?;
                        result.pulled_changes += page.changes.len();
                    }
                    let prior = queue.clone();
                    queue
                        .set_checkpoint(page.checkpoint.clone())
                        .map_err(ProtocolSyncError::Protocol)?;
                    if let Err(error) = persistence.persist(queue) {
                        *queue = prior;
                        return Err(ProtocolSyncError::Persistence(error));
                    }
                    if !page.has_more {
                        return Ok(());
                    }
                    if page.checkpoint == prior_checkpoint {
                        return Err(ProtocolSyncError::InvalidResponse(
                            "pull response hasMore without checkpoint progress",
                        ));
                    }
                }
            }
        }
        Err(ProtocolSyncError::InvalidResponse(
            "pull page safety limit exceeded",
        ))
    }
}

fn parse_decimal(value: &str) -> Option<u64> {
    if value.is_empty()
        || (value.len() > 1 && value.starts_with('0'))
        || !value.bytes().all(|byte| byte.is_ascii_digit())
    {
        return None;
    }
    value.parse().ok()
}

fn validate_snapshot(
    snapshot: &SnapshotResponse,
    prior_checkpoint: &str,
) -> Result<(), &'static str> {
    let Some(checkpoint) = parse_decimal(&snapshot.checkpoint) else {
        return Err("invalid protocol snapshot response");
    };
    let Some(prior) = parse_decimal(prior_checkpoint) else {
        return Err("invalid local protocol checkpoint");
    };
    if snapshot.protocol_version != 1
        || checkpoint < prior
        || snapshot.records.iter().any(|record| {
            record.table.is_empty()
                || record.record_id.is_empty()
                || !record.record.is_object()
                || parse_decimal(&record.revision).is_none_or(|revision| revision == 0)
        })
    {
        return Err("invalid protocol snapshot response");
    }
    Ok(())
}

fn validate_pull_page(page: &PullResponse, prior_checkpoint: &str) -> Result<(), &'static str> {
    let Some(page_checkpoint) = parse_decimal(&page.checkpoint) else {
        return Err("invalid protocol pull response");
    };
    let Some(mut last) = parse_decimal(prior_checkpoint) else {
        return Err("invalid local protocol checkpoint");
    };
    if page.protocol_version != 1 || page_checkpoint < last {
        return Err("invalid protocol pull response");
    }
    for change in &page.changes {
        let Some(checkpoint) = parse_decimal(&change.checkpoint) else {
            return Err("invalid protocol pull change");
        };
        if checkpoint <= last
            || checkpoint > page_checkpoint
            || change.table.is_empty()
            || change.record_id.is_empty()
            || parse_decimal(&change.revision).is_none_or(|revision| revision == 0)
            || match change.operation {
                Operation::Upsert => change
                    .record
                    .as_ref()
                    .is_none_or(|record| !record.is_object()),
                Operation::Delete => change.record.is_some(),
            }
            || change.source.as_ref().is_some_and(|source| {
                source.client_id.is_empty()
                    || parse_decimal(&source.mutation_id).is_none_or(|mutation_id| mutation_id == 0)
            })
        {
            return Err("invalid protocol pull change");
        }
        last = checkpoint;
    }
    Ok(())
}

/// Full-jitter exponential backoff with Retry-After as a floor.
pub fn compute_protocol_retry_delay(
    consecutive_failure: u32,
    base: Duration,
    maximum: Duration,
    sample: f64,
    retry_after: Duration,
) -> Result<Duration, ProtocolError> {
    if consecutive_failure == 0
        || base.is_zero()
        || maximum < base
        || !sample.is_finite()
        || !(0.0..=1.0).contains(&sample)
    {
        return Err(ProtocolError::InvalidLimit);
    }
    let exponent = consecutive_failure.saturating_sub(1).min(30);
    let ceiling = base
        .checked_mul(1_u32 << exponent)
        .unwrap_or(maximum)
        .min(maximum);
    let jittered = Duration::from_secs_f64(ceiling.as_secs_f64() * sample);
    Ok(jittered.max(retry_after))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::{ChangeSource, MutationResult, ResultStatus};
    use serde_json::json;
    use std::cell::RefCell;
    use std::collections::VecDeque;
    use std::convert::Infallible;
    use std::rc::Rc;

    type Events = Rc<RefCell<Vec<String>>>;

    fn change(checkpoint: &str, record_id: &str) -> Change {
        Change {
            checkpoint: checkpoint.to_string(),
            table: "docs".to_string(),
            record_id: record_id.to_string(),
            operation: Operation::Upsert,
            record: Some(json!({"id": record_id})),
            revision: checkpoint.to_string(),
            source: None,
        }
    }

    struct FakeTransport {
        events: Events,
        pulls: VecDeque<PullResult>,
        push_response: Option<PushResponse>,
        snapshot: Option<SnapshotResponse>,
    }

    impl ProtocolTransport for FakeTransport {
        type Error = &'static str;

        fn push(
            &mut self,
            request: &PushRequest,
        ) -> Result<PushResponse, TransportFailure<Self::Error>> {
            self.events.borrow_mut().push(format!(
                "push:{}",
                request
                    .mutations
                    .iter()
                    .map(|mutation| mutation.mutation_id.as_str())
                    .collect::<Vec<_>>()
                    .join(",")
            ));
            Ok(self.push_response.take().expect("unexpected push"))
        }

        fn pull(
            &mut self,
            _checkpoint: &str,
            _limit: usize,
        ) -> Result<PullResult, TransportFailure<Self::Error>> {
            Ok(self.pulls.pop_front().expect("unexpected pull"))
        }

        fn snapshot(
            &mut self,
            _reset: &ResetRequired,
        ) -> Result<SnapshotResponse, TransportFailure<Self::Error>> {
            Ok(self.snapshot.take().expect("unexpected snapshot"))
        }
    }

    struct FakeCallbacks {
        events: Events,
        fail_apply: bool,
        fail_replace: bool,
    }

    impl ProtocolSyncCallbacks for FakeCallbacks {
        type Error = &'static str;

        fn apply_changes(&mut self, changes: &[Change]) -> Result<(), Self::Error> {
            self.events.borrow_mut().push(format!(
                "apply:{}",
                changes
                    .iter()
                    .map(|change| change.checkpoint.as_str())
                    .collect::<Vec<_>>()
                    .join(",")
            ));
            if self.fail_apply {
                Err("injected apply failure")
            } else {
                Ok(())
            }
        }

        fn replace_authoritative(&mut self, records: &[SnapshotRecord]) -> Result<(), Self::Error> {
            self.events
                .borrow_mut()
                .push(format!("replace:{}", records[0].record_id));
            if self.fail_replace {
                Err("injected replace failure")
            } else {
                Ok(())
            }
        }
    }

    struct FakePersistence {
        events: Events,
        fail: bool,
    }

    impl ProtocolQueuePersistence for FakePersistence {
        type Error = &'static str;

        fn persist(&mut self, queue: &ProtocolQueue) -> Result<(), Self::Error> {
            self.events
                .borrow_mut()
                .push(format!("persist:{}", queue.checkpoint()));
            if self.fail {
                Err("injected persistence failure")
            } else {
                Ok(())
            }
        }
    }

    struct FakeAtomicStore {
        events: Events,
        fail_apply: bool,
        fail_replace: bool,
    }

    impl AtomicProtocolSyncStore for FakeAtomicStore {
        type Error = &'static str;

        fn persist_queue(&mut self, queue: &mut ProtocolQueue) -> Result<(), Self::Error> {
            self.events
                .borrow_mut()
                .push(format!("atomic_queue:{}", queue.checkpoint()));
            Ok(())
        }

        fn apply_changes_and_persist(
            &mut self,
            changes: &[Change],
            queue: &mut ProtocolQueue,
        ) -> Result<(), Self::Error> {
            self.events.borrow_mut().push(format!(
                "atomic_apply:{}:{}",
                changes.len(),
                queue.checkpoint()
            ));
            if self.fail_apply {
                Err("injected atomic apply failure")
            } else {
                Ok(())
            }
        }

        fn replace_authoritative_and_persist(
            &mut self,
            records: &[SnapshotRecord],
            queue: &mut ProtocolQueue,
        ) -> Result<(), Self::Error> {
            self.events.borrow_mut().push(format!(
                "atomic_replace:{}:{}",
                records[0].record_id,
                queue.checkpoint()
            ));
            if self.fail_replace {
                Err("injected atomic replace failure")
            } else {
                Ok(())
            }
        }
    }

    fn driver() -> ProtocolSyncDriver {
        ProtocolSyncDriver::new(ProtocolSyncOptions::default()).unwrap()
    }

    #[test]
    fn cycle_pulls_pushes_acknowledges_and_pulls_echo() {
        let events = Events::default();
        let mut queue = ProtocolQueue::new("device-a").unwrap();
        queue
            .queue_upsert("docs", "record-1", json!({"id": "1"}), None, false)
            .unwrap();
        let response = PushResponse {
            protocol_version: 1,
            client_id: "device-a".to_string(),
            last_mutation_id: "1".to_string(),
            checkpoint: "2".to_string(),
            results: vec![MutationResult {
                mutation_id: "1".to_string(),
                status: ResultStatus::Applied,
                original_status: None,
                checkpoint: Some("2".to_string()),
                revision: Some("1".to_string()),
                code: None,
                message: None,
            }],
        };
        let mut transport = FakeTransport {
            events: events.clone(),
            pulls: VecDeque::from([
                PullResult::Changes(PullResponse {
                    protocol_version: 1,
                    checkpoint: "1".to_string(),
                    has_more: false,
                    changes: vec![change("1", "remote")],
                }),
                PullResult::Changes(PullResponse {
                    protocol_version: 1,
                    checkpoint: "2".to_string(),
                    has_more: false,
                    changes: vec![Change {
                        source: Some(ChangeSource {
                            client_id: "device-a".to_string(),
                            mutation_id: "1".to_string(),
                        }),
                        ..change("2", "record-1")
                    }],
                }),
            ]),
            push_response: Some(response),
            snapshot: None,
        };
        let mut callbacks = FakeCallbacks {
            events: events.clone(),
            fail_apply: false,
            fail_replace: false,
        };
        let mut persistence = FakePersistence {
            events: events.clone(),
            fail: false,
        };

        let result = driver()
            .sync_cycle(&mut queue, &mut transport, &mut callbacks, &mut persistence)
            .unwrap();
        assert_eq!(result.pushed_mutations, 1);
        assert_eq!(result.acknowledged_mutations, 1);
        assert_eq!(result.pulled_changes, 2);
        assert_eq!(result.checkpoint, "2");
        assert!(!result.has_more_pending);
        assert_eq!(
            *events.borrow(),
            [
                "apply:1",
                "persist:1",
                "push:1",
                "persist:1",
                "apply:2",
                "persist:2",
            ]
        );
    }

    #[test]
    fn application_failure_does_not_advance_checkpoint() {
        let events = Events::default();
        let mut queue = ProtocolQueue::new("device-a").unwrap();
        let mut transport = FakeTransport {
            events: events.clone(),
            pulls: VecDeque::from([PullResult::Changes(PullResponse {
                protocol_version: 1,
                checkpoint: "1".to_string(),
                has_more: false,
                changes: vec![change("1", "unsafe")],
            })]),
            push_response: None,
            snapshot: None,
        };
        let mut callbacks = FakeCallbacks {
            events: events.clone(),
            fail_apply: true,
            fail_replace: false,
        };
        let mut persistence = FakePersistence {
            events,
            fail: false,
        };
        let error = driver()
            .sync_cycle(&mut queue, &mut transport, &mut callbacks, &mut persistence)
            .unwrap_err();
        assert!(matches!(
            error,
            ProtocolSyncError::Application("injected apply failure")
        ));
        assert_eq!(queue.checkpoint(), "0");
    }

    #[test]
    fn reset_replaces_authoritative_state_before_persisting_checkpoint() {
        let events = Events::default();
        let mut queue = ProtocolQueue::new("device-a").unwrap();
        let mut transport = FakeTransport {
            events: events.clone(),
            pulls: VecDeque::from([
                PullResult::ResetRequired(ResetRequired {
                    protocol_version: 1,
                    error: "RESET_REQUIRED".to_string(),
                    snapshot_url: Some("/v1/sync/snapshot".to_string()),
                }),
                PullResult::Changes(PullResponse {
                    protocol_version: 1,
                    checkpoint: "8".to_string(),
                    has_more: false,
                    changes: vec![],
                }),
                PullResult::Changes(PullResponse {
                    protocol_version: 1,
                    checkpoint: "8".to_string(),
                    has_more: false,
                    changes: vec![],
                }),
            ]),
            push_response: None,
            snapshot: Some(SnapshotResponse {
                protocol_version: 1,
                checkpoint: "8".to_string(),
                records: vec![SnapshotRecord {
                    table: "docs".to_string(),
                    record_id: "fresh".to_string(),
                    record: json!({"fresh": true}),
                    revision: "1".to_string(),
                }],
            }),
        };
        let mut callbacks = FakeCallbacks {
            events: events.clone(),
            fail_apply: false,
            fail_replace: false,
        };
        let mut persistence = FakePersistence {
            events: events.clone(),
            fail: false,
        };

        let result = driver()
            .sync_cycle(&mut queue, &mut transport, &mut callbacks, &mut persistence)
            .unwrap();
        assert_eq!(result.installed_snapshots, 1);
        assert_eq!(queue.checkpoint(), "8");
        let observed = events.borrow();
        let replace = observed
            .iter()
            .position(|event| event == "replace:fresh")
            .unwrap();
        let checkpoint = observed
            .iter()
            .position(|event| event == "persist:8")
            .unwrap();
        assert!(replace < checkpoint);
    }

    #[test]
    fn persistence_failure_rolls_back_in_memory_checkpoint() {
        let events = Events::default();
        let mut queue = ProtocolQueue::new("device-a").unwrap();
        let mut transport = FakeTransport {
            events: events.clone(),
            pulls: VecDeque::from([PullResult::Changes(PullResponse {
                protocol_version: 1,
                checkpoint: "1".to_string(),
                has_more: false,
                changes: vec![change("1", "replay-me")],
            })]),
            push_response: None,
            snapshot: None,
        };
        let mut callbacks = FakeCallbacks {
            events: events.clone(),
            fail_apply: false,
            fail_replace: false,
        };
        let mut persistence = FakePersistence { events, fail: true };
        let error = driver()
            .sync_cycle(&mut queue, &mut transport, &mut callbacks, &mut persistence)
            .unwrap_err();
        assert!(matches!(
            error,
            ProtocolSyncError::Persistence("injected persistence failure")
        ));
        assert_eq!(queue.checkpoint(), "0");
    }

    #[test]
    fn atomic_store_commits_pull_pages_with_their_checkpoints() {
        let events = Events::default();
        let mut queue = ProtocolQueue::new("device-a").unwrap();
        let mut transport = FakeTransport {
            events: events.clone(),
            pulls: VecDeque::from([
                PullResult::Changes(PullResponse {
                    protocol_version: 1,
                    checkpoint: "1".to_string(),
                    has_more: false,
                    changes: vec![change("1", "first")],
                }),
                PullResult::Changes(PullResponse {
                    protocol_version: 1,
                    checkpoint: "2".to_string(),
                    has_more: false,
                    changes: vec![change("2", "second")],
                }),
            ]),
            push_response: None,
            snapshot: None,
        };
        let mut store = FakeAtomicStore {
            events: events.clone(),
            fail_apply: false,
            fail_replace: false,
        };

        let result = driver()
            .sync_cycle_atomic(&mut queue, &mut transport, &mut store)
            .unwrap();
        assert_eq!(result.pulled_changes, 2);
        assert_eq!(result.checkpoint, "2");
        assert_eq!(*events.borrow(), ["atomic_apply:1:1", "atomic_apply:1:2"]);
    }

    #[test]
    fn atomic_store_failure_restores_the_in_memory_checkpoint() {
        let events = Events::default();
        let mut queue = ProtocolQueue::new("device-a").unwrap();
        let mut transport = FakeTransport {
            events: events.clone(),
            pulls: VecDeque::from([PullResult::Changes(PullResponse {
                protocol_version: 1,
                checkpoint: "1".to_string(),
                has_more: false,
                changes: vec![change("1", "unsafe")],
            })]),
            push_response: None,
            snapshot: None,
        };
        let mut store = FakeAtomicStore {
            events,
            fail_apply: true,
            fail_replace: false,
        };

        let error = driver()
            .sync_cycle_atomic(&mut queue, &mut transport, &mut store)
            .unwrap_err();
        assert!(matches!(
            error,
            ProtocolSyncError::Application("injected atomic apply failure")
        ));
        assert_eq!(queue.checkpoint(), "0");
    }

    #[test]
    fn atomic_store_replaces_a_snapshot_with_its_checkpoint() {
        let events = Events::default();
        let mut queue = ProtocolQueue::new("device-a").unwrap();
        let mut transport = FakeTransport {
            events: events.clone(),
            pulls: VecDeque::from([
                PullResult::ResetRequired(ResetRequired {
                    protocol_version: 1,
                    error: "RESET_REQUIRED".to_string(),
                    snapshot_url: None,
                }),
                PullResult::Changes(PullResponse {
                    protocol_version: 1,
                    checkpoint: "8".to_string(),
                    has_more: false,
                    changes: vec![],
                }),
                PullResult::Changes(PullResponse {
                    protocol_version: 1,
                    checkpoint: "8".to_string(),
                    has_more: false,
                    changes: vec![],
                }),
            ]),
            push_response: None,
            snapshot: Some(SnapshotResponse {
                protocol_version: 1,
                checkpoint: "8".to_string(),
                records: vec![SnapshotRecord {
                    table: "docs".to_string(),
                    record_id: "fresh".to_string(),
                    record: json!({"fresh": true}),
                    revision: "1".to_string(),
                }],
            }),
        };
        let mut store = FakeAtomicStore {
            events: events.clone(),
            fail_apply: false,
            fail_replace: false,
        };

        let result = driver()
            .sync_cycle_atomic(&mut queue, &mut transport, &mut store)
            .unwrap();
        assert_eq!(result.installed_snapshots, 1);
        assert_eq!(queue.checkpoint(), "8");
        assert_eq!(
            *events.borrow(),
            [
                "atomic_replace:fresh:8",
                "atomic_apply:0:8",
                "atomic_apply:0:8"
            ]
        );
    }

    #[test]
    fn malformed_page_is_rejected_before_application() {
        let events = Events::default();
        let mut queue = ProtocolQueue::new("device-a").unwrap();
        let mut transport = FakeTransport {
            events: events.clone(),
            pulls: VecDeque::from([PullResult::Changes(PullResponse {
                protocol_version: 1,
                checkpoint: "0".to_string(),
                has_more: false,
                changes: vec![change("1", "past-page")],
            })]),
            push_response: None,
            snapshot: None,
        };
        let mut callbacks = FakeCallbacks {
            events: events.clone(),
            fail_apply: false,
            fail_replace: false,
        };
        let mut persistence = FakePersistence {
            events: events.clone(),
            fail: false,
        };
        let error = driver()
            .sync_cycle(&mut queue, &mut transport, &mut callbacks, &mut persistence)
            .unwrap_err();
        assert!(matches!(
            error,
            ProtocolSyncError::InvalidResponse("invalid protocol pull change")
        ));
        assert!(events.borrow().is_empty());
    }

    #[test]
    fn retry_delay_is_bounded_full_jitter_with_a_floor() {
        assert_eq!(
            compute_protocol_retry_delay(
                1,
                Duration::from_millis(500),
                Duration::from_secs(30),
                0.0,
                Duration::ZERO,
            )
            .unwrap(),
            Duration::ZERO
        );
        assert_eq!(
            compute_protocol_retry_delay(
                4,
                Duration::from_millis(500),
                Duration::from_secs(30),
                1.0,
                Duration::ZERO,
            )
            .unwrap(),
            Duration::from_secs(4)
        );
        assert_eq!(
            compute_protocol_retry_delay(
                2,
                Duration::from_millis(500),
                Duration::from_secs(30),
                0.25,
                Duration::from_secs(12),
            )
            .unwrap(),
            Duration::from_secs(12)
        );
        let _: Infallible = match compute_protocol_retry_delay(
            0,
            Duration::from_millis(500),
            Duration::from_secs(30),
            0.5,
            Duration::ZERO,
        ) {
            Err(ProtocolError::InvalidLimit) => return,
            _ => panic!("invalid retry policy was accepted"),
        };
    }
}
