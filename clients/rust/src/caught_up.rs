//! Caller-visible authoritative freshness barriers.
//!
//! Rust keeps the protocol driver runtime-neutral and synchronous. This module
//! therefore checks cancellation/online/timeout between ordinary sync cycles;
//! it never invents a second scheduler and never treats a live notification as
//! freshness evidence. Completion is based on the durable `ProtocolQueue`
//! checkpoint after a cycle returns.

use crate::protocol::ProtocolQueue;
use crate::protocol_sync::{
    ProtocolQueuePersistence, ProtocolSyncCallbacks, ProtocolSyncDriver, ProtocolSyncError,
    ProtocolTransport,
};
use std::time::{Duration, Instant};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AuthoritativeCheckpointTarget {
    pub protocol_version: u8,
    pub checkpoint: String,
    pub generation: Option<String>,
}

impl AuthoritativeCheckpointTarget {
    pub fn new(checkpoint: impl Into<String>) -> Self {
        Self {
            protocol_version: 1,
            checkpoint: checkpoint.into(),
            generation: None,
        }
    }
}

pub trait AuthoritativeCheckpointRequester {
    type Error;

    fn request_checkpoint(&mut self) -> Result<AuthoritativeCheckpointTarget, Self::Error>;
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CaughtUpBarrierErrorCode {
    InvalidTarget,
    InvalidLocalCheckpoint,
    Invalidated,
    Timeout,
    Cancelled,
    Offline,
}

impl CaughtUpBarrierErrorCode {
    pub const fn wire_code(self) -> &'static str {
        match self {
            Self::InvalidTarget => "CAUGHT_UP_INVALID_TARGET",
            Self::InvalidLocalCheckpoint => "CAUGHT_UP_INVALID_LOCAL_CHECKPOINT",
            Self::Invalidated => "CAUGHT_UP_INVALIDATED",
            Self::Timeout => "CAUGHT_UP_TIMEOUT",
            Self::Cancelled => "CAUGHT_UP_CANCELLED",
            Self::Offline => "CAUGHT_UP_OFFLINE",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CaughtUpBarrierError {
    pub code: CaughtUpBarrierErrorCode,
    pub message: &'static str,
    pub target_checkpoint: Option<String>,
    pub local_checkpoint: Option<String>,
}

impl std::fmt::Display for CaughtUpBarrierError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{}: {}", self.code.wire_code(), self.message)
    }
}

impl std::error::Error for CaughtUpBarrierError {}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CaughtUpResult {
    pub target_checkpoint: String,
    pub checkpoint: String,
    pub generation: Option<String>,
    pub elapsed: Duration,
    pub cycles: usize,
    pub already_caught_up: bool,
}

#[derive(Debug)]
pub enum AwaitCaughtUpError<TransportError, ApplicationError, PersistenceError> {
    Barrier(CaughtUpBarrierError),
    Sync(ProtocolSyncError<TransportError, ApplicationError, PersistenceError>),
}

impl<T: std::fmt::Display, A: std::fmt::Display, P: std::fmt::Display> std::fmt::Display
    for AwaitCaughtUpError<T, A, P>
{
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Barrier(error) => error.fmt(formatter),
            Self::Sync(error) => error.fmt(formatter),
        }
    }
}

impl<
        T: std::fmt::Debug + std::fmt::Display,
        A: std::fmt::Debug + std::fmt::Display,
        P: std::fmt::Debug + std::fmt::Display,
    > std::error::Error for AwaitCaughtUpError<T, A, P>
{
}

#[derive(Debug)]
pub enum RequestAndAwaitCaughtUpError<
    RequestError,
    TransportError,
    ApplicationError,
    PersistenceError,
> {
    Request(RequestError),
    Await(AwaitCaughtUpError<TransportError, ApplicationError, PersistenceError>),
}

fn canonical_checkpoint(value: &str) -> bool {
    !value.is_empty()
        && !(value.len() > 1 && value.starts_with('0'))
        && value.bytes().all(|byte| byte.is_ascii_digit())
}

fn barrier_error(
    code: CaughtUpBarrierErrorCode,
    message: &'static str,
    target: Option<&str>,
    local: Option<&str>,
) -> CaughtUpBarrierError {
    CaughtUpBarrierError {
        code,
        message,
        target_checkpoint: target.map(str::to_owned),
        local_checkpoint: local.map(str::to_owned),
    }
}

/// Compare arbitrary-size canonical decimal checkpoints without integer overflow.
pub fn checkpoint_reached(local: &str, target: &str) -> Result<bool, CaughtUpBarrierError> {
    if !canonical_checkpoint(local) {
        return Err(barrier_error(
            CaughtUpBarrierErrorCode::InvalidLocalCheckpoint,
            "local checkpoint must be a canonical unsigned decimal string",
            None,
            Some(local),
        ));
    }
    if !canonical_checkpoint(target) {
        return Err(barrier_error(
            CaughtUpBarrierErrorCode::InvalidTarget,
            "target checkpoint must be a canonical unsigned decimal string",
            Some(target),
            None,
        ));
    }
    Ok(match local.len().cmp(&target.len()) {
        std::cmp::Ordering::Greater => true,
        std::cmp::Ordering::Less => false,
        std::cmp::Ordering::Equal => local >= target,
    })
}

pub fn validate_authoritative_checkpoint_target(
    target: &AuthoritativeCheckpointTarget,
    expected_generation: Option<&str>,
) -> Result<(), CaughtUpBarrierError> {
    if target.protocol_version != 1 || !canonical_checkpoint(&target.checkpoint) {
        return Err(barrier_error(
            CaughtUpBarrierErrorCode::InvalidTarget,
            "authoritative checkpoint target is invalid",
            Some(&target.checkpoint),
            None,
        ));
    }
    if target.generation.as_deref().is_some_and(str::is_empty) {
        return Err(barrier_error(
            CaughtUpBarrierErrorCode::InvalidTarget,
            "authoritative checkpoint generation must be non-empty when present",
            Some(&target.checkpoint),
            None,
        ));
    }
    if expected_generation.is_some() && target.generation.as_deref() != expected_generation {
        return Err(barrier_error(
            CaughtUpBarrierErrorCode::Invalidated,
            "checkpoint generation does not match the expected generation",
            Some(&target.checkpoint),
            None,
        ));
    }
    Ok(())
}

/// Drive ordinary protocol cycles until the durable queue checkpoint reaches
/// `target`. The caller supplies online/cancellation probes so no async runtime
/// or executor is imposed on consumers.
pub fn await_caught_up<T, C, P, Online, Cancelled>(
    driver: &ProtocolSyncDriver,
    queue: &mut ProtocolQueue,
    transport: &mut T,
    callbacks: &mut C,
    persistence: &mut P,
    target: &AuthoritativeCheckpointTarget,
    timeout: Duration,
    poll_interval: Duration,
    expected_generation: Option<&str>,
    mut is_online: Online,
    mut is_cancelled: Cancelled,
) -> Result<CaughtUpResult, AwaitCaughtUpError<T::Error, C::Error, P::Error>>
where
    T: ProtocolTransport,
    C: ProtocolSyncCallbacks,
    P: ProtocolQueuePersistence,
    Online: FnMut() -> bool,
    Cancelled: FnMut() -> bool,
{
    validate_authoritative_checkpoint_target(target, expected_generation)
        .map_err(AwaitCaughtUpError::Barrier)?;
    let started = Instant::now();
    let mut checkpoint = queue.checkpoint().to_string();
    if checkpoint_reached(&checkpoint, &target.checkpoint).map_err(AwaitCaughtUpError::Barrier)? {
        return Ok(CaughtUpResult {
            target_checkpoint: target.checkpoint.clone(),
            checkpoint,
            generation: target.generation.clone(),
            elapsed: started.elapsed(),
            cycles: 0,
            already_caught_up: true,
        });
    }

    let mut cycles = 0;
    loop {
        if is_cancelled() {
            return Err(AwaitCaughtUpError::Barrier(barrier_error(
                CaughtUpBarrierErrorCode::Cancelled,
                "caught-up wait was cancelled",
                Some(&target.checkpoint),
                Some(&checkpoint),
            )));
        }
        if !is_online() {
            return Err(AwaitCaughtUpError::Barrier(barrier_error(
                CaughtUpBarrierErrorCode::Offline,
                "cannot establish authoritative freshness while offline",
                Some(&target.checkpoint),
                Some(&checkpoint),
            )));
        }
        if started.elapsed() >= timeout {
            return Err(AwaitCaughtUpError::Barrier(barrier_error(
                CaughtUpBarrierErrorCode::Timeout,
                "caught-up wait timed out before the durable checkpoint reached the target",
                Some(&target.checkpoint),
                Some(&checkpoint),
            )));
        }

        let before = checkpoint.clone();
        driver
            .sync_cycle(queue, transport, callbacks, persistence)
            .map_err(AwaitCaughtUpError::Sync)?;
        cycles += 1;
        // The queue is the durable protocol state represented in memory only
        // after persistence has succeeded. Never trust only cycle-result state.
        checkpoint = queue.checkpoint().to_string();
        if checkpoint_reached(&checkpoint, &target.checkpoint)
            .map_err(AwaitCaughtUpError::Barrier)?
        {
            return Ok(CaughtUpResult {
                target_checkpoint: target.checkpoint.clone(),
                checkpoint,
                generation: target.generation.clone(),
                elapsed: started.elapsed(),
                cycles,
                already_caught_up: false,
            });
        }
        if checkpoint == before && !poll_interval.is_zero() {
            let remaining = timeout.saturating_sub(started.elapsed());
            if remaining.is_zero() {
                continue;
            }
            std::thread::sleep(poll_interval.min(remaining));
        }
    }
}

pub fn request_and_await_caught_up<R, T, C, P, Online, Cancelled>(
    requester: &mut R,
    driver: &ProtocolSyncDriver,
    queue: &mut ProtocolQueue,
    transport: &mut T,
    callbacks: &mut C,
    persistence: &mut P,
    timeout: Duration,
    poll_interval: Duration,
    expected_generation: Option<&str>,
    is_online: Online,
    is_cancelled: Cancelled,
) -> Result<CaughtUpResult, RequestAndAwaitCaughtUpError<R::Error, T::Error, C::Error, P::Error>>
where
    R: AuthoritativeCheckpointRequester,
    T: ProtocolTransport,
    C: ProtocolSyncCallbacks,
    P: ProtocolQueuePersistence,
    Online: FnMut() -> bool,
    Cancelled: FnMut() -> bool,
{
    let started = Instant::now();
    let target = requester
        .request_checkpoint()
        .map_err(RequestAndAwaitCaughtUpError::Request)?;
    let remaining = timeout.saturating_sub(started.elapsed());
    if remaining.is_zero() && !timeout.is_zero() {
        return Err(RequestAndAwaitCaughtUpError::Await(
            AwaitCaughtUpError::Barrier(barrier_error(
                CaughtUpBarrierErrorCode::Timeout,
                "caught-up wait timed out while requesting the authoritative checkpoint",
                Some(&target.checkpoint),
                Some(queue.checkpoint()),
            )),
        ));
    }
    await_caught_up(
        driver,
        queue,
        transport,
        callbacks,
        persistence,
        &target,
        remaining,
        poll_interval,
        expected_generation,
        is_online,
        is_cancelled,
    )
    .map_err(RequestAndAwaitCaughtUpError::Await)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compares_arbitrary_size_decimal_checkpoints() {
        assert!(!checkpoint_reached("9", "10").unwrap());
        assert!(checkpoint_reached("10", "10").unwrap());
        assert!(checkpoint_reached("100000000000000000000", "99").unwrap());
        assert_eq!(
            checkpoint_reached("01", "1").unwrap_err().code,
            CaughtUpBarrierErrorCode::InvalidLocalCheckpoint
        );
    }

    #[test]
    fn target_generation_mismatch_fails_closed() {
        let target = AuthoritativeCheckpointTarget {
            protocol_version: 1,
            checkpoint: "42".to_owned(),
            generation: Some("scope-b".to_owned()),
        };
        assert_eq!(
            validate_authoritative_checkpoint_target(&target, Some("scope-a"))
                .unwrap_err()
                .code,
            CaughtUpBarrierErrorCode::Invalidated
        );
    }

    #[test]
    fn wire_error_codes_match_shared_contract() {
        assert_eq!(
            CaughtUpBarrierErrorCode::InvalidTarget.wire_code(),
            "CAUGHT_UP_INVALID_TARGET"
        );
        assert_eq!(
            CaughtUpBarrierErrorCode::InvalidLocalCheckpoint.wire_code(),
            "CAUGHT_UP_INVALID_LOCAL_CHECKPOINT"
        );
        assert_eq!(
            CaughtUpBarrierErrorCode::Invalidated.wire_code(),
            "CAUGHT_UP_INVALIDATED"
        );
        assert_eq!(
            CaughtUpBarrierErrorCode::Timeout.wire_code(),
            "CAUGHT_UP_TIMEOUT"
        );
        assert_eq!(
            CaughtUpBarrierErrorCode::Cancelled.wire_code(),
            "CAUGHT_UP_CANCELLED"
        );
        assert_eq!(
            CaughtUpBarrierErrorCode::Offline.wire_code(),
            "CAUGHT_UP_OFFLINE"
        );
    }
}
