//! Restart-safe desktop background synchronization contracts for opto-sync.
//!
//! This crate deliberately does not contain another queue or reconciliation
//! engine. Hosts supply one durable, atomic lease store and run one bounded
//! protocol-v1 push/pull cycle against the existing opto-sync client. Server
//! `(client_id, mutation_id)` deduplication remains the final correctness
//! boundary if a process dies after a remote commit but before local release.

use std::collections::BTreeMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

/// A reason a desktop host asked the durable queue to be inspected.
#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub enum DesktopWakeReason {
    ProcessStart,
    LocalMutation,
    RemoteChange,
    Connectivity,
    Resume,
    AppUpdate,
    Manual,
}

/// Concrete runtime embedding the opto-sync client.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DesktopRuntime {
    Node,
    Electron,
    Flutter,
    RustNative,
    WasmWebView,
}

/// Honest lifecycle class for a concrete host.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DesktopExecutionClass {
    PersistentNativeRunner,
    ServiceWorkerEvents,
    ForegroundOnly,
}

/// Where TCP capability comes from.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DesktopTcpCapability {
    Native,
    HostBridge,
    Unsupported,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct DesktopCapabilityInput {
    pub runtime: DesktopRuntime,
    pub service_worker_available: bool,
    pub native_host_bridge_available: bool,
    pub persistent_native_runner_available: bool,
    pub tcp_available: bool,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct DesktopSyncCapability {
    pub runtime: DesktopRuntime,
    pub execution_class: DesktopExecutionClass,
    pub http: bool,
    pub websocket_lives_for_host_process: bool,
    pub tcp: DesktopTcpCapability,
    pub survives_window_closure: bool,
    pub survives_host_termination: bool,
    pub exact_intervals_guaranteed: bool,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DesktopCapabilityError {
    WasmPersistentRunnerNeedsNativeBridge,
}

impl std::fmt::Display for DesktopCapabilityError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::WasmPersistentRunnerNeedsNativeBridge => formatter.write_str(
                "a WASM webview needs a native host bridge to claim a persistent runner",
            ),
        }
    }
}

impl std::error::Error for DesktopCapabilityError {}

/// Resolve capabilities without misrepresenting WASM as an operating-system daemon.
pub fn resolve_desktop_sync_capability(
    input: DesktopCapabilityInput,
) -> Result<DesktopSyncCapability, DesktopCapabilityError> {
    if input.runtime == DesktopRuntime::WasmWebView
        && input.persistent_native_runner_available
        && !input.native_host_bridge_available
    {
        return Err(DesktopCapabilityError::WasmPersistentRunnerNeedsNativeBridge);
    }

    let execution_class = if input.persistent_native_runner_available {
        DesktopExecutionClass::PersistentNativeRunner
    } else if input.service_worker_available {
        DesktopExecutionClass::ServiceWorkerEvents
    } else {
        DesktopExecutionClass::ForegroundOnly
    };
    let tcp = if !input.tcp_available {
        DesktopTcpCapability::Unsupported
    } else if input.runtime == DesktopRuntime::WasmWebView {
        if input.native_host_bridge_available {
            DesktopTcpCapability::HostBridge
        } else {
            DesktopTcpCapability::Unsupported
        }
    } else {
        DesktopTcpCapability::Native
    };

    Ok(DesktopSyncCapability {
        runtime: input.runtime,
        execution_class,
        http: true,
        websocket_lives_for_host_process: execution_class
            == DesktopExecutionClass::PersistentNativeRunner,
        tcp,
        survives_window_closure: execution_class
            == DesktopExecutionClass::PersistentNativeRunner
            || input.service_worker_available,
        survives_host_termination: execution_class
            == DesktopExecutionClass::PersistentNativeRunner,
        exact_intervals_guaranteed: false,
    })
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DesktopLeaseRequest {
    pub key: String,
    pub owner_id: String,
    pub token: String,
    pub now_ms: u64,
    pub expires_at_ms: u64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DesktopLeaseGrant {
    pub key: String,
    pub owner_id: String,
    pub token: String,
    /// Monotonic, lossless fencing identity assigned atomically by the store.
    pub fence: String,
    pub expires_at_ms: u64,
}

/// Durable cross-process compare-and-swap boundary.
///
/// `try_acquire` must increment the fence whenever it replaces an absent or
/// expired lease. `release` must compare token plus fence and never delete a
/// newer owner's lease.
pub trait DesktopLeaseStore {
    type Error;

    fn try_acquire(
        &mut self,
        request: DesktopLeaseRequest,
    ) -> Result<Option<DesktopLeaseGrant>, Self::Error>;

    fn release(&mut self, grant: &DesktopLeaseGrant) -> Result<(), Self::Error>;
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DesktopSyncContext {
    pub reasons: Vec<DesktopWakeReason>,
    pub owner_id: String,
    pub lease_key: String,
    pub fence: String,
    /// Cooperative deadline. The host transport must stop or return by this time.
    pub deadline_ms: u64,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DesktopBusyReason {
    InProcess,
    DurableLease,
}

#[derive(Debug)]
pub enum DesktopReleaseError<StoreError> {
    Store(StoreError),
    StorePoisoned,
}

#[derive(Debug)]
pub enum DesktopSyncOutcome<ResultValue, CycleError, StoreError> {
    Busy {
        reason: DesktopBusyReason,
        reasons: Vec<DesktopWakeReason>,
    },
    Completed {
        result: ResultValue,
        reasons: Vec<DesktopWakeReason>,
        fence: String,
        release_error: Option<DesktopReleaseError<StoreError>>,
    },
    Failed {
        error: CycleError,
        reasons: Vec<DesktopWakeReason>,
        fence: String,
        release_error: Option<DesktopReleaseError<StoreError>>,
    },
}

#[derive(Debug)]
pub enum DesktopRunnerError<StoreError> {
    InvalidConfiguration(&'static str),
    Store(StoreError),
    StorePoisoned,
}

impl<StoreError: std::fmt::Display> std::fmt::Display for DesktopRunnerError<StoreError> {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidConfiguration(message) => formatter.write_str(message),
            Self::Store(error) => write!(formatter, "desktop lease store failed: {error}"),
            Self::StorePoisoned => formatter.write_str("desktop lease store mutex is poisoned"),
        }
    }
}

impl<StoreError> std::error::Error for DesktopRunnerError<StoreError> where
    StoreError: std::error::Error + 'static
{
}

/// One bounded, durably fenced desktop protocol-cycle runner.
///
/// The cycle callback is synchronous and cooperative: it receives a deadline
/// and must bound its own HTTP/socket work. The runner does not detach an
/// uncooperative callback and release its lease behind it, because doing so
/// would allow two processes to drain concurrently.
pub struct DesktopSyncRunner<Store> {
    store: Arc<Mutex<Store>>,
    lease_key: String,
    owner_id: String,
    cycle_budget_ms: u64,
    lease_ttl_ms: u64,
    in_process: AtomicBool,
}

impl<Store> DesktopSyncRunner<Store> {
    pub fn new(
        store: Arc<Mutex<Store>>,
        lease_key: impl Into<String>,
        owner_id: impl Into<String>,
        cycle_budget_ms: u64,
        lease_ttl_ms: u64,
    ) -> Result<Self, DesktopRunnerError<std::convert::Infallible>> {
        let lease_key = lease_key.into();
        let owner_id = owner_id.into();
        if lease_key.is_empty() || lease_key.len() > 512 {
            return Err(DesktopRunnerError::InvalidConfiguration(
                "lease_key must be 1 through 512 bytes",
            ));
        }
        if owner_id.is_empty() || owner_id.len() > 512 {
            return Err(DesktopRunnerError::InvalidConfiguration(
                "owner_id must be 1 through 512 bytes",
            ));
        }
        if !(1_000..=600_000).contains(&cycle_budget_ms) {
            return Err(DesktopRunnerError::InvalidConfiguration(
                "cycle_budget_ms must be from 1000 through 600000",
            ));
        }
        if lease_ttl_ms < cycle_budget_ms.saturating_add(1_000)
            || lease_ttl_ms > 900_000
        {
            return Err(DesktopRunnerError::InvalidConfiguration(
                "lease_ttl_ms must cover cycle_budget_ms plus 1000 and be at most 900000",
            ));
        }
        Ok(Self {
            store,
            lease_key,
            owner_id,
            cycle_budget_ms,
            lease_ttl_ms,
            in_process: AtomicBool::new(false),
        })
    }

    pub fn run_once<ResultValue, CycleError, Cycle>(
        &self,
        mut reasons: Vec<DesktopWakeReason>,
        now_ms: u64,
        token: impl Into<String>,
        cycle: Cycle,
    ) -> Result<DesktopSyncOutcome<ResultValue, CycleError, Store::Error>, DesktopRunnerError<Store::Error>>
    where
        Store: DesktopLeaseStore,
        Cycle: FnOnce(&DesktopSyncContext) -> Result<ResultValue, CycleError>,
    {
        reasons.sort_unstable();
        reasons.dedup();
        if reasons.is_empty() {
            reasons.push(DesktopWakeReason::Manual);
        }
        if self
            .in_process
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_err()
        {
            return Ok(DesktopSyncOutcome::Busy {
                reason: DesktopBusyReason::InProcess,
                reasons,
            });
        }
        let _guard = InProcessGuard(&self.in_process);

        let token = token.into();
        if token.is_empty() || token.len() > 512 {
            return Err(DesktopRunnerError::InvalidConfiguration(
                "lease token must be 1 through 512 bytes",
            ));
        }
        let request = DesktopLeaseRequest {
            key: self.lease_key.clone(),
            owner_id: self.owner_id.clone(),
            token,
            now_ms,
            expires_at_ms: now_ms.saturating_add(self.lease_ttl_ms),
        };
        let grant = {
            let mut store = self
                .store
                .lock()
                .map_err(|_| DesktopRunnerError::StorePoisoned)?;
            store
                .try_acquire(request)
                .map_err(DesktopRunnerError::Store)?
        };
        let Some(grant) = grant else {
            return Ok(DesktopSyncOutcome::Busy {
                reason: DesktopBusyReason::DurableLease,
                reasons,
            });
        };
        let context = DesktopSyncContext {
            reasons: reasons.clone(),
            owner_id: self.owner_id.clone(),
            lease_key: self.lease_key.clone(),
            fence: grant.fence.clone(),
            deadline_ms: now_ms.saturating_add(self.cycle_budget_ms),
        };
        let cycle_result = cycle(&context);
        let release_error = match self.store.lock() {
            Ok(mut store) => store
                .release(&grant)
                .err()
                .map(DesktopReleaseError::Store),
            Err(_) => Some(DesktopReleaseError::StorePoisoned),
        };

        Ok(match cycle_result {
            Ok(result) => DesktopSyncOutcome::Completed {
                result,
                reasons,
                fence: grant.fence,
                release_error,
            },
            Err(error) => DesktopSyncOutcome::Failed {
                error,
                reasons,
                fence: grant.fence,
                release_error,
            },
        })
    }
}

struct InProcessGuard<'a>(&'a AtomicBool);

impl Drop for InProcessGuard<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

/// Deterministic lease store for tests and single-process demonstrations.
///
/// Production hosts must persist the same compare-and-swap contract in SQLite
/// or another store shared by every process that can drain the queue.
#[derive(Debug, Default)]
pub struct InMemoryDesktopLeaseStore {
    leases: BTreeMap<String, DesktopLeaseGrant>,
    fences: BTreeMap<String, u128>,
}

impl DesktopLeaseStore for InMemoryDesktopLeaseStore {
    type Error = std::convert::Infallible;

    fn try_acquire(
        &mut self,
        request: DesktopLeaseRequest,
    ) -> Result<Option<DesktopLeaseGrant>, Self::Error> {
        if self
            .leases
            .get(&request.key)
            .is_some_and(|current| current.expires_at_ms > request.now_ms)
        {
            return Ok(None);
        }
        let fence = self.fences.entry(request.key.clone()).or_default();
        *fence = fence.saturating_add(1);
        let grant = DesktopLeaseGrant {
            key: request.key.clone(),
            owner_id: request.owner_id,
            token: request.token,
            fence: fence.to_string(),
            expires_at_ms: request.expires_at_ms,
        };
        self.leases.insert(request.key, grant.clone());
        Ok(Some(grant))
    }

    fn release(&mut self, grant: &DesktopLeaseGrant) -> Result<(), Self::Error> {
        if self.leases.get(&grant.key).is_some_and(|current| {
            current.token == grant.token && current.fence == grant.fence
        }) {
            self.leases.remove(&grant.key);
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;
    use std::thread;

    fn runner(
        store: Arc<Mutex<InMemoryDesktopLeaseStore>>,
        owner: &str,
    ) -> DesktopSyncRunner<InMemoryDesktopLeaseStore> {
        DesktopSyncRunner::new(store, "account:shared", owner, 2_000, 4_000)
            .expect("valid runner")
    }

    #[test]
    fn wasm_does_not_claim_a_daemon_without_a_native_bridge() {
        let capability = resolve_desktop_sync_capability(DesktopCapabilityInput {
            runtime: DesktopRuntime::WasmWebView,
            service_worker_available: true,
            native_host_bridge_available: false,
            persistent_native_runner_available: false,
            tcp_available: true,
        })
        .expect("valid capability");
        assert_eq!(
            capability.execution_class,
            DesktopExecutionClass::ServiceWorkerEvents
        );
        assert_eq!(capability.tcp, DesktopTcpCapability::Unsupported);
        assert!(!capability.survives_host_termination);
        assert!(!capability.exact_intervals_guaranteed);

        assert_eq!(
            resolve_desktop_sync_capability(DesktopCapabilityInput {
                runtime: DesktopRuntime::WasmWebView,
                service_worker_available: false,
                native_host_bridge_available: false,
                persistent_native_runner_available: true,
                tcp_available: false,
            }),
            Err(DesktopCapabilityError::WasmPersistentRunnerNeedsNativeBridge)
        );
    }

    #[test]
    fn durable_lease_excludes_a_second_process_and_fences_retry() {
        let store = Arc::new(Mutex::new(InMemoryDesktopLeaseStore::default()));
        let first = Arc::new(runner(Arc::clone(&store), "process-a"));
        let second = runner(store, "process-b");
        let (started_tx, started_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        let first_thread = {
            let first = Arc::clone(&first);
            thread::spawn(move || {
                first.run_once(
                    vec![DesktopWakeReason::ProcessStart],
                    1_000,
                    "token-a",
                    |context| -> Result<String, &'static str> {
                        started_tx.send(context.fence.clone()).expect("start signal");
                        release_rx.recv().expect("release signal");
                        Ok("first".to_owned())
                    },
                )
            })
        };
        assert_eq!(started_rx.recv().expect("first started"), "1");

        let blocked = second
            .run_once(
                vec![DesktopWakeReason::Manual],
                1_001,
                "token-b-1",
                |_| -> Result<String, &'static str> { Ok("unexpected".to_owned()) },
            )
            .expect("runner result");
        assert!(matches!(
            blocked,
            DesktopSyncOutcome::Busy {
                reason: DesktopBusyReason::DurableLease,
                ..
            }
        ));

        release_tx.send(()).expect("release first");
        let first_result = first_thread.join().expect("thread joined").expect("run");
        assert!(matches!(
            first_result,
            DesktopSyncOutcome::Completed { ref fence, .. } if fence == "1"
        ));

        let retry = second
            .run_once(
                vec![
                    DesktopWakeReason::Connectivity,
                    DesktopWakeReason::Connectivity,
                ],
                2_000,
                "token-b-2",
                |context| -> Result<String, &'static str> {
                    assert_eq!(context.reasons, vec![DesktopWakeReason::Connectivity]);
                    Ok("second".to_owned())
                },
            )
            .expect("retry result");
        assert!(matches!(
            retry,
            DesktopSyncOutcome::Completed { ref fence, .. } if fence == "2"
        ));
    }

    #[test]
    fn invalid_timing_contract_is_rejected() {
        let result = DesktopSyncRunner::new(
            Arc::new(Mutex::new(InMemoryDesktopLeaseStore::default())),
            "account",
            "owner",
            2_000,
            2_500,
        );
        assert!(matches!(
            result,
            Err(DesktopRunnerError::InvalidConfiguration(_))
        ));
    }
}
