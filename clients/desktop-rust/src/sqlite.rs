//! Store-authoritative SQLite coordination for Rust desktop hosts.
//!
//! The coordinator stores only local ownership metadata around the existing
//! protocol-v1 queue. HTTP push/pull and immutable `(client_id, mutation_id)`
//! identities remain the remote commit contract.

use std::path::Path;
use std::thread;
use std::time::{Duration, Instant};

use rusqlite::{params, Connection, OptionalExtension, Transaction, TransactionBehavior};

use crate::{DesktopLeaseGrant, DesktopLeaseRequest, DesktopLeaseStore, DesktopWakeReason};

pub const SQLITE_DESKTOP_COORDINATION_SCHEMA_VERSION: u32 = 1;
const TABLE: &str = "opto_sync_desktop_coordination_v1";
const MIN_TTL_MS: u64 = 1_000;
const MAX_TTL_MS: u64 = 15 * 60_000;
const MAX_BUSY_TIMEOUT_MS: u64 = 60_000;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct SqliteDesktopCoordinatorOptions {
    pub busy_timeout_ms: u64,
    pub initialize_pragmas: bool,
}

impl Default for SqliteDesktopCoordinatorOptions {
    fn default() -> Self {
        Self {
            busy_timeout_ms: 5_000,
            initialize_pragmas: true,
        }
    }
}

#[derive(Debug)]
pub enum SqliteDesktopError {
    Sqlite(rusqlite::Error),
    InvalidConfiguration(String),
    MissingCoordinationRow,
    GenerationExhausted(&'static str),
    StaleFence,
}

impl std::fmt::Display for SqliteDesktopError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Sqlite(error) => write!(formatter, "SQLite coordination failed: {error}"),
            Self::InvalidConfiguration(message) => formatter.write_str(message),
            Self::MissingCoordinationRow => {
                formatter.write_str("SQLite coordination row disappeared")
            }
            Self::GenerationExhausted(name) => {
                write!(formatter, "{name} exhausted SQLite's signed 64-bit range")
            }
            Self::StaleFence => formatter
                .write_str("desktop SQLite fence is stale, expired, or no longer owned"),
        }
    }
}

impl std::error::Error for SqliteDesktopError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Sqlite(error) => Some(error),
            _ => None,
        }
    }
}

impl From<rusqlite::Error> for SqliteDesktopError {
    fn from(error: rusqlite::Error) -> Self {
        Self::Sqlite(error)
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SqliteDesktopAcquireRequest {
    pub key: String,
    pub owner_id: String,
    pub token: String,
    pub lease_ttl_ms: u64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SqliteDesktopLeaseGrant {
    pub key: String,
    pub owner_id: String,
    pub token: String,
    pub fence: String,
    pub acquired_at_ms: u64,
    pub expires_at_ms: u64,
    pub wake_generation: String,
    pub handled_generation: String,
}

impl SqliteDesktopLeaseGrant {
    #[must_use]
    pub fn desktop_grant(&self) -> DesktopLeaseGrant {
        DesktopLeaseGrant {
            key: self.key.clone(),
            owner_id: self.owner_id.clone(),
            token: self.token.clone(),
            fence: self.fence.clone(),
            expires_at_ms: self.expires_at_ms,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SqliteDesktopWakeReceipt {
    pub generation: String,
    pub handled_generation: String,
    pub dirty: bool,
    pub retry_after_ms: u64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SqliteDesktopBusy {
    pub retry_after_ms: u64,
    pub wake_generation: String,
    pub handled_generation: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum SqliteDesktopAcquireResult {
    Busy(SqliteDesktopBusy),
    Acquired(SqliteDesktopLeaseGrant),
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SqliteDesktopCompletion {
    pub released: bool,
    pub current_wake_generation: String,
    pub handled_generation: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SqliteDesktopState {
    pub key: String,
    pub fence: String,
    pub expires_at_ms: u64,
    pub wake_generation: String,
    pub handled_generation: String,
    pub dirty: bool,
    pub owned: bool,
    pub retry_after_ms: u64,
}

#[derive(Clone, Debug)]
struct CoordinationRow {
    owner_token: Option<String>,
    fence: i64,
    expires_at_ms: i64,
    wake_generation: i64,
    handled_generation: i64,
}

/// Shared SQLite coordinator for Rust-native desktop processes and services.
///
/// The table contains only the lease key, opaque owner token, fence, expiry,
/// and wake/handled generations. Queue payloads, credentials, database URLs,
/// tenant secrets, and stable device identifiers do not belong here.
pub struct SqliteDesktopCoordinator {
    connection: Connection,
}

impl SqliteDesktopCoordinator {
    pub fn open(
        path: impl AsRef<Path>,
        options: SqliteDesktopCoordinatorOptions,
    ) -> Result<Self, SqliteDesktopError> {
        if path.as_ref().as_os_str().is_empty() {
            return Err(SqliteDesktopError::InvalidConfiguration(
                "SQLite path must not be empty".to_owned(),
            ));
        }
        if options.busy_timeout_ms > MAX_BUSY_TIMEOUT_MS {
            return Err(SqliteDesktopError::InvalidConfiguration(format!(
                "busy_timeout_ms must be from 0 through {MAX_BUSY_TIMEOUT_MS}"
            )));
        }

        let connection = Connection::open(path)?;
        if options.initialize_pragmas {
            connection.busy_timeout(Duration::from_millis(options.busy_timeout_ms))?;
            connection.execute_batch(
                "PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA synchronous = FULL;",
            )?;
        }
        connection.execute_batch(&format!(
            r#"CREATE TABLE IF NOT EXISTS {TABLE} (
                 lease_key TEXT PRIMARY KEY NOT NULL,
                 owner_token TEXT,
                 fence INTEGER NOT NULL DEFAULT 0 CHECK (fence >= 0),
                 expires_at_ms INTEGER NOT NULL DEFAULT 0 CHECK (expires_at_ms >= 0),
                 wake_generation INTEGER NOT NULL DEFAULT 0 CHECK (wake_generation >= 0),
                 handled_generation INTEGER NOT NULL DEFAULT 0 CHECK (
                   handled_generation >= 0 AND handled_generation <= wake_generation
                 ),
                 updated_at_ms INTEGER NOT NULL DEFAULT 0 CHECK (updated_at_ms >= 0)
               ) STRICT;"#
        ))?;
        Ok(Self { connection })
    }

    pub fn signal_wake(
        &mut self,
        key: &str,
    ) -> Result<SqliteDesktopWakeReceipt, SqliteDesktopError> {
        validate_identifier("lease key", key)?;
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let now_ms = store_now_ms(&transaction)?;
        ensure_row(&transaction, key, now_ms)?;
        let before = read_row(&transaction, key)?;
        if before.wake_generation == i64::MAX {
            return Err(SqliteDesktopError::GenerationExhausted("wake generation"));
        }
        transaction.execute(
            &format!(
                "UPDATE {TABLE} SET wake_generation = wake_generation + 1, \
                 updated_at_ms = ?1 WHERE lease_key = ?2"
            ),
            params![now_ms, key],
        )?;
        let row = read_row(&transaction, key)?;
        let receipt = SqliteDesktopWakeReceipt {
            generation: row.wake_generation.to_string(),
            handled_generation: row.handled_generation.to_string(),
            dirty: row.wake_generation != row.handled_generation,
            retry_after_ms: retry_after_ms(&row, now_ms)?,
        };
        transaction.commit()?;
        Ok(receipt)
    }

    pub fn acquire(
        &mut self,
        request: SqliteDesktopAcquireRequest,
    ) -> Result<SqliteDesktopAcquireResult, SqliteDesktopError> {
        validate_identifier("lease key", &request.key)?;
        validate_identifier("owner id", &request.owner_id)?;
        validate_identifier("owner token", &request.token)?;
        validate_ttl(request.lease_ttl_ms)?;

        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let now_ms = store_now_ms(&transaction)?;
        ensure_row(&transaction, &request.key, now_ms)?;
        let current = read_row(&transaction, &request.key)?;
        if current.owner_token.is_some() && current.expires_at_ms > now_ms {
            let busy = SqliteDesktopBusy {
                retry_after_ms: non_negative_difference(current.expires_at_ms, now_ms)?,
                wake_generation: current.wake_generation.to_string(),
                handled_generation: current.handled_generation.to_string(),
            };
            transaction.commit()?;
            return Ok(SqliteDesktopAcquireResult::Busy(busy));
        }
        if current.fence == i64::MAX {
            return Err(SqliteDesktopError::GenerationExhausted("lease fence"));
        }
        let ttl_ms = i64::try_from(request.lease_ttl_ms).map_err(|_| {
            SqliteDesktopError::InvalidConfiguration("lease_ttl_ms is too large".to_owned())
        })?;
        let expires_at_ms = now_ms.checked_add(ttl_ms).ok_or_else(|| {
            SqliteDesktopError::InvalidConfiguration("lease expiry overflowed".to_owned())
        })?;
        transaction.execute(
            &format!(
                "UPDATE {TABLE} SET owner_token = ?1, fence = fence + 1, \
                 expires_at_ms = ?2, updated_at_ms = ?3 WHERE lease_key = ?4"
            ),
            params![request.token, expires_at_ms, now_ms, request.key],
        )?;
        let granted = read_row(&transaction, &request.key)?;
        let grant = SqliteDesktopLeaseGrant {
            key: request.key,
            owner_id: request.owner_id,
            token: request.token,
            fence: granted.fence.to_string(),
            acquired_at_ms: non_negative_i64(now_ms, "store clock")?,
            expires_at_ms: non_negative_i64(granted.expires_at_ms, "lease expiry")?,
            wake_generation: granted.wake_generation.to_string(),
            handled_generation: granted.handled_generation.to_string(),
        };
        transaction.commit()?;
        Ok(SqliteDesktopAcquireResult::Acquired(grant))
    }

    pub fn renew(
        &mut self,
        grant: &SqliteDesktopLeaseGrant,
        lease_ttl_ms: u64,
    ) -> Result<Option<SqliteDesktopLeaseGrant>, SqliteDesktopError> {
        validate_sqlite_grant(grant)?;
        validate_ttl(lease_ttl_ms)?;
        let fence = parse_decimal("fence", &grant.fence)?;
        let ttl_ms = i64::try_from(lease_ttl_ms).map_err(|_| {
            SqliteDesktopError::InvalidConfiguration("lease_ttl_ms is too large".to_owned())
        })?;
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let now_ms = store_now_ms(&transaction)?;
        let expires_at_ms = now_ms.checked_add(ttl_ms).ok_or_else(|| {
            SqliteDesktopError::InvalidConfiguration("lease expiry overflowed".to_owned())
        })?;
        let changed = transaction.execute(
            &format!(
                "UPDATE {TABLE} SET expires_at_ms = ?1, updated_at_ms = ?2 \
                 WHERE lease_key = ?3 AND owner_token = ?4 \
                 AND fence = ?5 AND expires_at_ms > ?6"
            ),
            params![
                expires_at_ms,
                now_ms,
                grant.key,
                grant.token,
                fence,
                now_ms
            ],
        )?;
        if changed != 1 {
            transaction.commit()?;
            return Ok(None);
        }
        let row = read_row(&transaction, &grant.key)?;
        let renewed = SqliteDesktopLeaseGrant {
            key: grant.key.clone(),
            owner_id: grant.owner_id.clone(),
            token: grant.token.clone(),
            fence: grant.fence.clone(),
            acquired_at_ms: grant.acquired_at_ms,
            expires_at_ms: non_negative_i64(row.expires_at_ms, "lease expiry")?,
            wake_generation: row.wake_generation.to_string(),
            handled_generation: row.handled_generation.to_string(),
        };
        transaction.commit()?;
        Ok(Some(renewed))
    }

    pub fn complete(
        &mut self,
        grant: &SqliteDesktopLeaseGrant,
        observed_wake_generation: &str,
    ) -> Result<SqliteDesktopCompletion, SqliteDesktopError> {
        validate_sqlite_grant(grant)?;
        let observed = parse_decimal("observed wake generation", observed_wake_generation)?;
        let fence = parse_decimal("fence", &grant.fence)?;
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let now_ms = store_now_ms(&transaction)?;
        let row = read_owned_unexpired_row(&transaction, &grant.desktop_grant(), fence, now_ms)?;
        if observed > row.wake_generation {
            return Err(SqliteDesktopError::InvalidConfiguration(
                "observed wake generation is ahead of durable state".to_owned(),
            ));
        }
        let next_handled = observed.max(row.handled_generation);
        let released = observed == row.wake_generation;
        let changed = transaction.execute(
            &format!(
                "UPDATE {TABLE} SET handled_generation = ?1, \
                 owner_token = CASE WHEN ?2 THEN NULL ELSE owner_token END, \
                 expires_at_ms = CASE WHEN ?2 THEN 0 ELSE expires_at_ms END, \
                 updated_at_ms = ?3 WHERE lease_key = ?4 AND owner_token = ?5 \
                 AND fence = ?6 AND expires_at_ms > ?7"
            ),
            params![
                next_handled,
                if released { 1_i64 } else { 0_i64 },
                now_ms,
                grant.key,
                grant.token,
                fence,
                now_ms
            ],
        )?;
        if changed != 1 {
            return Err(SqliteDesktopError::StaleFence);
        }
        let completion = SqliteDesktopCompletion {
            released,
            current_wake_generation: row.wake_generation.to_string(),
            handled_generation: next_handled.to_string(),
        };
        transaction.commit()?;
        Ok(completion)
    }

    pub fn release_lease(
        &mut self,
        grant: &DesktopLeaseGrant,
    ) -> Result<(), SqliteDesktopError> {
        validate_grant(grant)?;
        let fence = parse_decimal("fence", &grant.fence)?;
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let now_ms = store_now_ms(&transaction)?;
        transaction.execute(
            &format!(
                "UPDATE {TABLE} SET owner_token = NULL, expires_at_ms = 0, \
                 updated_at_ms = ?1 WHERE lease_key = ?2 \
                 AND owner_token = ?3 AND fence = ?4"
            ),
            params![now_ms, grant.key, grant.token, fence],
        )?;
        transaction.commit()?;
        Ok(())
    }

    pub fn with_fenced_write<T, Write>(
        &mut self,
        grant: &DesktopLeaseGrant,
        write: Write,
    ) -> Result<T, SqliteDesktopError>
    where
        Write: FnOnce(&Transaction<'_>) -> Result<T, SqliteDesktopError>,
    {
        validate_grant(grant)?;
        let fence = parse_decimal("fence", &grant.fence)?;
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let before_ms = store_now_ms(&transaction)?;
        read_owned_unexpired_row(&transaction, grant, fence, before_ms)?;
        let result = write(&transaction)?;
        let after_ms = store_now_ms(&transaction)?;
        read_owned_unexpired_row(&transaction, grant, fence, after_ms)?;
        transaction.commit()?;
        Ok(result)
    }

    pub fn assert_current_fence(
        &mut self,
        grant: &DesktopLeaseGrant,
    ) -> Result<(), SqliteDesktopError> {
        validate_grant(grant)?;
        let fence = parse_decimal("fence", &grant.fence)?;
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let now_ms = store_now_ms(&transaction)?;
        read_owned_unexpired_row(&transaction, grant, fence, now_ms)?;
        transaction.commit()?;
        Ok(())
    }

    pub fn read_state(&mut self, key: &str) -> Result<SqliteDesktopState, SqliteDesktopError> {
        validate_identifier("lease key", key)?;
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let now_ms = store_now_ms(&transaction)?;
        ensure_row(&transaction, key, now_ms)?;
        let row = read_row(&transaction, key)?;
        let state = SqliteDesktopState {
            key: key.to_owned(),
            fence: row.fence.to_string(),
            expires_at_ms: non_negative_i64(row.expires_at_ms, "lease expiry")?,
            wake_generation: row.wake_generation.to_string(),
            handled_generation: row.handled_generation.to_string(),
            dirty: row.wake_generation != row.handled_generation,
            owned: row.owner_token.is_some() && row.expires_at_ms > now_ms,
            retry_after_ms: retry_after_ms(&row, now_ms)?,
        };
        transaction.commit()?;
        Ok(state)
    }

    pub fn store_now_ms(&self) -> Result<u64, SqliteDesktopError> {
        non_negative_i64(store_now_ms(&self.connection)?, "store clock")
    }
}

impl DesktopLeaseStore for SqliteDesktopCoordinator {
    type Error = SqliteDesktopError;

    fn try_acquire(
        &mut self,
        request: DesktopLeaseRequest,
    ) -> Result<Option<DesktopLeaseGrant>, Self::Error> {
        let lease_ttl_ms = request
            .expires_at_ms
            .checked_sub(request.now_ms)
            .ok_or_else(|| {
                SqliteDesktopError::InvalidConfiguration(
                    "expires_at_ms must be after now_ms".to_owned(),
                )
            })?;
        match self.acquire(SqliteDesktopAcquireRequest {
            key: request.key,
            owner_id: request.owner_id,
            token: request.token,
            lease_ttl_ms,
        })? {
            SqliteDesktopAcquireResult::Busy(_) => Ok(None),
            SqliteDesktopAcquireResult::Acquired(grant) => Ok(Some(grant.desktop_grant())),
        }
    }

    fn release(&mut self, grant: &DesktopLeaseGrant) -> Result<(), Self::Error> {
        self.release_lease(grant)
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SqliteDesktopCycleContext {
    pub reasons: Vec<DesktopWakeReason>,
    pub owner_id: String,
    pub lease_key: String,
    pub fence: String,
    pub wake_generation: String,
    pub deadline_ms: u64,
    pub grant: SqliteDesktopLeaseGrant,
}

#[derive(Debug)]
pub struct SqliteDesktopCompleted<ResultValue> {
    pub result: ResultValue,
    pub reasons: Vec<DesktopWakeReason>,
    pub fence: String,
    pub wake_generation: String,
    pub handled_generation: String,
}

#[derive(Debug)]
pub enum SqliteDesktopRunError<CycleError> {
    Coordinator(SqliteDesktopError),
    Busy {
        reasons: Vec<DesktopWakeReason>,
        retry_after_ms: u64,
        wake_generation: String,
        handled_generation: String,
    },
    Cycle {
        error: CycleError,
        release_error: Option<SqliteDesktopError>,
        reasons: Vec<DesktopWakeReason>,
        fence: String,
        wake_generation: String,
    },
}

/// Synchronous Rust-native runner with durable wake-before-acquire ordering.
///
/// The callback is cooperative and receives a store-time deadline. Every local
/// queue or checkpoint mutation must use `with_fenced_write` (or an equivalent
/// check in the same SQLite transaction). A newer wake forces a trailing cycle
/// under the same renewed fence before ownership can be released.
pub struct SqliteCoordinatedDesktopSyncRunner {
    coordinator: SqliteDesktopCoordinator,
    lease_key: String,
    owner_id: String,
    cycle_budget_ms: u64,
    lease_ttl_ms: u64,
    busy_retry_cap_ms: u64,
    busy_wait_budget_ms: u64,
}

impl SqliteCoordinatedDesktopSyncRunner {
    pub fn new(
        coordinator: SqliteDesktopCoordinator,
        lease_key: impl Into<String>,
        owner_id: impl Into<String>,
        cycle_budget_ms: u64,
        lease_ttl_ms: u64,
        busy_retry_cap_ms: u64,
        busy_wait_budget_ms: u64,
    ) -> Result<Self, SqliteDesktopError> {
        let lease_key = lease_key.into();
        let owner_id = owner_id.into();
        validate_identifier("lease key", &lease_key)?;
        validate_identifier("owner id", &owner_id)?;
        if !(1_000..=600_000).contains(&cycle_budget_ms) {
            return Err(SqliteDesktopError::InvalidConfiguration(
                "cycle_budget_ms must be from 1000 through 600000".to_owned(),
            ));
        }
        validate_ttl(lease_ttl_ms)?;
        if lease_ttl_ms < cycle_budget_ms.saturating_add(1_000) {
            return Err(SqliteDesktopError::InvalidConfiguration(
                "lease_ttl_ms must cover cycle_budget_ms plus 1000".to_owned(),
            ));
        }
        if busy_retry_cap_ms == 0 || busy_retry_cap_ms > lease_ttl_ms {
            return Err(SqliteDesktopError::InvalidConfiguration(
                "busy_retry_cap_ms must be from 1 through lease_ttl_ms".to_owned(),
            ));
        }
        if busy_wait_budget_ms < busy_retry_cap_ms
            || busy_wait_budget_ms > MAX_TTL_MS.saturating_mul(2)
        {
            return Err(SqliteDesktopError::InvalidConfiguration(
                "busy_wait_budget_ms must cover busy_retry_cap_ms and be at most 1800000"
                    .to_owned(),
            ));
        }
        Ok(Self {
            coordinator,
            lease_key,
            owner_id,
            cycle_budget_ms,
            lease_ttl_ms,
            busy_retry_cap_ms,
            busy_wait_budget_ms,
        })
    }

    pub fn coordinator(&self) -> &SqliteDesktopCoordinator {
        &self.coordinator
    }

    pub fn coordinator_mut(&mut self) -> &mut SqliteDesktopCoordinator {
        &mut self.coordinator
    }

    pub fn wake_and_run<ResultValue, CycleError, TokenFactory, Cycle>(
        &mut self,
        reason: DesktopWakeReason,
        mut token_factory: TokenFactory,
        mut cycle: Cycle,
    ) -> Result<Vec<SqliteDesktopCompleted<ResultValue>>, SqliteDesktopRunError<CycleError>>
    where
        TokenFactory: FnMut() -> String,
        Cycle: FnMut(
            &mut SqliteDesktopCoordinator,
            &SqliteDesktopCycleContext,
        ) -> Result<ResultValue, CycleError>,
    {
        self.coordinator
            .signal_wake(&self.lease_key)
            .map_err(SqliteDesktopRunError::Coordinator)?;
        let reasons = vec![reason];
        let busy_started = Instant::now();
        let mut grant = loop {
            let token = token_factory();
            match self
                .coordinator
                .acquire(SqliteDesktopAcquireRequest {
                    key: self.lease_key.clone(),
                    owner_id: self.owner_id.clone(),
                    token,
                    lease_ttl_ms: self.lease_ttl_ms,
                })
                .map_err(SqliteDesktopRunError::Coordinator)?
            {
                SqliteDesktopAcquireResult::Acquired(grant) => break grant,
                SqliteDesktopAcquireResult::Busy(busy) => {
                    let elapsed_ms = u64::try_from(busy_started.elapsed().as_millis())
                        .unwrap_or(u64::MAX);
                    if elapsed_ms >= self.busy_wait_budget_ms {
                        return Err(SqliteDesktopRunError::Busy {
                            reasons,
                            retry_after_ms: busy.retry_after_ms,
                            wake_generation: busy.wake_generation,
                            handled_generation: busy.handled_generation,
                        });
                    }
                    let remaining_budget = self.busy_wait_budget_ms - elapsed_ms;
                    let delay_ms = self
                        .busy_retry_cap_ms
                        .min(busy.retry_after_ms.max(1))
                        .min(remaining_budget.max(1));
                    thread::sleep(Duration::from_millis(delay_ms));
                }
            }
        };

        let mut completed = Vec::new();
        loop {
            let deadline_ms = self
                .coordinator
                .store_now_ms()
                .map_err(SqliteDesktopRunError::Coordinator)?
                .saturating_add(self.cycle_budget_ms);
            let context = SqliteDesktopCycleContext {
                reasons: reasons.clone(),
                owner_id: self.owner_id.clone(),
                lease_key: self.lease_key.clone(),
                fence: grant.fence.clone(),
                wake_generation: grant.wake_generation.clone(),
                deadline_ms,
                grant: grant.clone(),
            };
            let result = match cycle(&mut self.coordinator, &context) {
                Ok(result) => result,
                Err(error) => {
                    let release_error = self
                        .coordinator
                        .release_lease(&grant.desktop_grant())
                        .err();
                    return Err(SqliteDesktopRunError::Cycle {
                        error,
                        release_error,
                        reasons,
                        fence: grant.fence,
                        wake_generation: grant.wake_generation,
                    });
                }
            };
            let completion = self
                .coordinator
                .complete(&grant, &grant.wake_generation)
                .map_err(SqliteDesktopRunError::Coordinator)?;
            completed.push(SqliteDesktopCompleted {
                result,
                reasons: reasons.clone(),
                fence: grant.fence.clone(),
                wake_generation: grant.wake_generation.clone(),
                handled_generation: completion.handled_generation.clone(),
            });
            if completion.released {
                return Ok(completed);
            }
            grant = self
                .coordinator
                .renew(&grant, self.lease_ttl_ms)
                .map_err(SqliteDesktopRunError::Coordinator)?
                .ok_or_else(|| {
                    SqliteDesktopRunError::Coordinator(SqliteDesktopError::StaleFence)
                })?;
            grant.wake_generation = completion.current_wake_generation;
            grant.handled_generation = completion.handled_generation;
        }
    }
}

fn validate_identifier(name: &str, value: &str) -> Result<(), SqliteDesktopError> {
    if value.is_empty() || value.len() > 512 {
        return Err(SqliteDesktopError::InvalidConfiguration(format!(
            "{name} must be 1 through 512 bytes"
        )));
    }
    Ok(())
}

fn validate_ttl(ttl_ms: u64) -> Result<(), SqliteDesktopError> {
    if !(MIN_TTL_MS..=MAX_TTL_MS).contains(&ttl_ms) {
        return Err(SqliteDesktopError::InvalidConfiguration(format!(
            "lease_ttl_ms must be from {MIN_TTL_MS} through {MAX_TTL_MS}"
        )));
    }
    Ok(())
}

fn validate_grant(grant: &DesktopLeaseGrant) -> Result<(), SqliteDesktopError> {
    validate_identifier("lease key", &grant.key)?;
    validate_identifier("owner token", &grant.token)?;
    parse_decimal("fence", &grant.fence)?;
    Ok(())
}

fn validate_sqlite_grant(grant: &SqliteDesktopLeaseGrant) -> Result<(), SqliteDesktopError> {
    validate_identifier("lease key", &grant.key)?;
    validate_identifier("owner id", &grant.owner_id)?;
    validate_identifier("owner token", &grant.token)?;
    parse_decimal("fence", &grant.fence)?;
    parse_decimal("wake generation", &grant.wake_generation)?;
    parse_decimal("handled generation", &grant.handled_generation)?;
    Ok(())
}

fn parse_decimal(name: &str, value: &str) -> Result<i64, SqliteDesktopError> {
    if value.is_empty()
        || !value.bytes().all(|byte| byte.is_ascii_digit())
        || (value.len() > 1 && value.starts_with('0'))
    {
        return Err(SqliteDesktopError::InvalidConfiguration(format!(
            "{name} must be a non-negative canonical decimal integer"
        )));
    }
    value.parse::<i64>().map_err(|_| {
        SqliteDesktopError::InvalidConfiguration(format!(
            "{name} exceeds SQLite's signed 64-bit range"
        ))
    })
}

fn non_negative_i64(value: i64, name: &str) -> Result<u64, SqliteDesktopError> {
    u64::try_from(value).map_err(|_| {
        SqliteDesktopError::InvalidConfiguration(format!(
            "SQLite returned a negative {name}"
        ))
    })
}

fn non_negative_difference(later: i64, earlier: i64) -> Result<u64, SqliteDesktopError> {
    non_negative_i64(later.saturating_sub(earlier).max(0), "retry interval")
}

fn retry_after_ms(row: &CoordinationRow, now_ms: i64) -> Result<u64, SqliteDesktopError> {
    if row.owner_token.is_none() {
        return Ok(0);
    }
    non_negative_difference(row.expires_at_ms, now_ms)
}

fn store_now_ms(connection: &Connection) -> Result<i64, SqliteDesktopError> {
    let now_ms = connection.query_row(
        "SELECT CAST(unixepoch('subsec') * 1000 AS INTEGER)",
        [],
        |row| row.get::<_, i64>(0),
    )?;
    if now_ms < 0 {
        return Err(SqliteDesktopError::InvalidConfiguration(
            "SQLite returned a negative store clock".to_owned(),
        ));
    }
    Ok(now_ms)
}

fn ensure_row(
    connection: &Connection,
    key: &str,
    now_ms: i64,
) -> Result<(), SqliteDesktopError> {
    connection.execute(
        &format!(
            "INSERT INTO {TABLE} (lease_key, owner_token, fence, expires_at_ms, \
             wake_generation, handled_generation, updated_at_ms) \
             VALUES (?1, NULL, 0, 0, 0, 0, ?2) \
             ON CONFLICT(lease_key) DO NOTHING"
        ),
        params![key, now_ms],
    )?;
    Ok(())
}

fn read_row(connection: &Connection, key: &str) -> Result<CoordinationRow, SqliteDesktopError> {
    connection
        .query_row(
            &format!(
                "SELECT owner_token, fence, expires_at_ms, wake_generation, \
                 handled_generation FROM {TABLE} WHERE lease_key = ?1"
            ),
            params![key],
            |row| {
                Ok(CoordinationRow {
                    owner_token: row.get(0)?,
                    fence: row.get(1)?,
                    expires_at_ms: row.get(2)?,
                    wake_generation: row.get(3)?,
                    handled_generation: row.get(4)?,
                })
            },
        )
        .optional()?
        .ok_or(SqliteDesktopError::MissingCoordinationRow)
}

fn read_owned_unexpired_row(
    connection: &Connection,
    grant: &DesktopLeaseGrant,
    fence: i64,
    now_ms: i64,
) -> Result<CoordinationRow, SqliteDesktopError> {
    let row = read_row(connection, &grant.key)?;
    if row.owner_token.as_deref() != Some(grant.token.as_str())
        || row.fence != fence
        || row.expires_at_ms <= now_ms
    {
        return Err(SqliteDesktopError::StaleFence);
    }
    Ok(row)
}
