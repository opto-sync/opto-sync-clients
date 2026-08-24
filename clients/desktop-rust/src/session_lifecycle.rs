//! Authenticated login/logout ordering shared with the Dart/Flutter adapter.
//!
//! Authentication and telemetry providers remain application-owned. This
//! module only makes the sync/flush/credential-clear ordering explicit and
//! prevents a transport acknowledgement from masquerading as durable delivery.

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SessionSyncReason {
    Login,
    Logout,
}

/// Largest integer represented exactly by every supported Dart/JS/Rust host.
pub const MAX_PORTABLE_SESSION_INTEGER: u64 = 9_007_199_254_740_991;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SessionIdentity {
    pub subject: String,
    pub tenant: String,
    pub auth_epoch: u64,
}

impl SessionIdentity {
    pub fn new(
        subject: impl Into<String>,
        tenant: impl Into<String>,
        auth_epoch: u64,
    ) -> Result<Self, &'static str> {
        let subject = subject.into();
        let tenant = tenant.into();
        if subject.trim().is_empty() || subject.len() > 512 {
            return Err("subject must be 1 through 512 bytes");
        }
        if tenant.trim().is_empty() || tenant.len() > 512 {
            return Err("tenant must be 1 through 512 bytes");
        }
        if auth_epoch > MAX_PORTABLE_SESSION_INTEGER {
            return Err("auth_epoch exceeds the portable integer domain");
        }
        Ok(Self {
            subject,
            tenant,
            auth_epoch,
        })
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct DurableSyncReceipt {
    pub pending_before: u64,
    pub acknowledged: u64,
    pub admitted_during_drain: u64,
    pub pending_after: u64,
    pub checkpoint_committed: bool,
    pub admission_fenced: bool,
}

impl DurableSyncReceipt {
    pub fn new(
        pending_before: u64,
        acknowledged: u64,
        admitted_during_drain: u64,
        pending_after: u64,
        checkpoint_committed: bool,
        admission_fenced: bool,
    ) -> Result<Self, &'static str> {
        if [
            pending_before,
            acknowledged,
            admitted_during_drain,
            pending_after,
        ]
        .into_iter()
        .any(|value| value > MAX_PORTABLE_SESSION_INTEGER)
        {
            return Err("durable sync counters exceed the portable integer domain");
        }
        let expected_pending = pending_before
            .checked_sub(acknowledged)
            .and_then(|value| value.checked_add(admitted_during_drain));
        if expected_pending != Some(pending_after) {
            return Err(
                "durable sync receipt violates queue conservation: pending_after must equal pending_before - acknowledged + admitted_during_drain",
            );
        }
        Ok(Self {
            pending_before,
            acknowledged,
            admitted_during_drain,
            pending_after,
            checkpoint_committed,
            admission_fenced,
        })
    }

    #[must_use]
    pub fn durably_drained(self) -> bool {
        self.pending_after == 0
            && self.acknowledged == self.pending_before
            && self.admitted_during_drain == 0
            && self.checkpoint_committed
            && self.admission_fenced
    }
}

#[derive(Debug)]
pub struct SessionLoginReport<SyncError> {
    pub session: SessionIdentity,
    pub sync_triggered: bool,
    pub receipt: Option<DurableSyncReceipt>,
    pub sync_error: Option<SyncError>,
}

impl<SyncError> SessionLoginReport<SyncError> {
    #[must_use]
    pub fn sync_succeeded(&self) -> bool {
        self.sync_triggered && self.sync_error.is_none()
    }
}

#[derive(Debug)]
pub struct SessionLogoutReport<SyncError, TelemetryError, CredentialError> {
    pub had_session: bool,
    pub credentials_cleared: bool,
    pub receipt: Option<DurableSyncReceipt>,
    pub sync_error: Option<SyncError>,
    pub telemetry_error: Option<TelemetryError>,
    pub credential_error: Option<CredentialError>,
}

impl<SyncError, TelemetryError, CredentialError>
    SessionLogoutReport<SyncError, TelemetryError, CredentialError>
{
    #[must_use]
    pub fn data_durably_drained(&self) -> bool {
        !self.had_session
            || (self.sync_error.is_none()
                && self
                    .receipt
                    .is_some_and(DurableSyncReceipt::durably_drained))
    }

    #[must_use]
    pub fn telemetry_flushed(&self) -> bool {
        self.telemetry_error.is_none()
    }

    #[must_use]
    pub fn complete(&self) -> bool {
        self.data_durably_drained() && self.telemetry_flushed() && self.credentials_cleared
    }
}

#[derive(Debug, Default)]
pub struct AuthenticatedSessionLifecycle {
    session: Option<SessionIdentity>,
}

impl AuthenticatedSessionLifecycle {
    #[must_use]
    pub fn session(&self) -> Option<&SessionIdentity> {
        self.session.as_ref()
    }

    pub fn on_login<SyncError, Sync>(
        &mut self,
        next: SessionIdentity,
        sync: Sync,
    ) -> Result<SessionLoginReport<SyncError>, &'static str>
    where
        Sync: FnOnce(SessionSyncReason) -> Result<DurableSyncReceipt, SyncError>,
    {
        if let Some(current) = self.session.as_ref() {
            if current != &next {
                return Err("logout must complete before a tenant, subject, or auth-epoch switch");
            }
            return Ok(SessionLoginReport {
                session: current.clone(),
                sync_triggered: false,
                receipt: None,
                sync_error: None,
            });
        }

        self.session = Some(next.clone());
        let (receipt, sync_error) = match sync(SessionSyncReason::Login) {
            Ok(receipt) => (Some(receipt), None),
            Err(error) => (None, Some(error)),
        };
        Ok(SessionLoginReport {
            session: next,
            sync_triggered: true,
            receipt,
            sync_error,
        })
    }

    pub fn on_logout<SyncError, TelemetryError, CredentialError, Sync, Flush, Clear>(
        &mut self,
        sync: Sync,
        force_flush_telemetry: Flush,
        clear_credentials: Clear,
    ) -> SessionLogoutReport<SyncError, TelemetryError, CredentialError>
    where
        Sync: FnOnce(SessionSyncReason) -> Result<DurableSyncReceipt, SyncError>,
        Flush: FnOnce() -> Result<(), TelemetryError>,
        Clear: FnOnce(Option<&SessionIdentity>) -> Result<(), CredentialError>,
    {
        let current = self.session.take();
        let (receipt, sync_error) = if current.is_some() {
            match sync(SessionSyncReason::Logout) {
                Ok(receipt) => (Some(receipt), None),
                Err(error) => (None, Some(error)),
            }
        } else {
            (None, None)
        };
        let telemetry_error = force_flush_telemetry().err();
        let credential_result = clear_credentials(current.as_ref());
        let credentials_cleared = credential_result.is_ok();

        SessionLogoutReport {
            had_session: current.is_some(),
            credentials_cleared,
            receipt,
            sync_error,
            telemetry_error,
            credential_error: credential_result.err(),
        }
    }

    /// Async-host adapter with the same ordering and ownership semantics.
    pub async fn on_login_async<SyncError, Sync, SyncFuture>(
        &mut self,
        next: SessionIdentity,
        sync: Sync,
    ) -> Result<SessionLoginReport<SyncError>, &'static str>
    where
        Sync: FnOnce(SessionSyncReason) -> SyncFuture,
        SyncFuture: std::future::Future<Output = Result<DurableSyncReceipt, SyncError>>,
    {
        if let Some(current) = self.session.as_ref() {
            if current != &next {
                return Err("logout must complete before a tenant, subject, or auth-epoch switch");
            }
            return Ok(SessionLoginReport {
                session: current.clone(),
                sync_triggered: false,
                receipt: None,
                sync_error: None,
            });
        }

        self.session = Some(next.clone());
        let (receipt, sync_error) = match sync(SessionSyncReason::Login).await {
            Ok(receipt) => (Some(receipt), None),
            Err(error) => (None, Some(error)),
        };
        Ok(SessionLoginReport {
            session: next,
            sync_triggered: true,
            receipt,
            sync_error,
        })
    }

    /// Async-host logout: durable sync, provider force-flush, credential clear.
    pub async fn on_logout_async<
        SyncError,
        TelemetryError,
        CredentialError,
        Sync,
        SyncFuture,
        Flush,
        FlushFuture,
        Clear,
        ClearFuture,
    >(
        &mut self,
        sync: Sync,
        force_flush_telemetry: Flush,
        clear_credentials: Clear,
    ) -> SessionLogoutReport<SyncError, TelemetryError, CredentialError>
    where
        Sync: FnOnce(SessionSyncReason) -> SyncFuture,
        SyncFuture: std::future::Future<Output = Result<DurableSyncReceipt, SyncError>>,
        Flush: FnOnce() -> FlushFuture,
        FlushFuture: std::future::Future<Output = Result<(), TelemetryError>>,
        Clear: FnOnce(Option<SessionIdentity>) -> ClearFuture,
        ClearFuture: std::future::Future<Output = Result<(), CredentialError>>,
    {
        let current = self.session.take();
        let (receipt, sync_error) = if current.is_some() {
            match sync(SessionSyncReason::Logout).await {
                Ok(receipt) => (Some(receipt), None),
                Err(error) => (None, Some(error)),
            }
        } else {
            (None, None)
        };
        let telemetry_error = force_flush_telemetry().await.err();
        let credential_result = clear_credentials(current.clone()).await;
        let credentials_cleared = credential_result.is_ok();

        SessionLogoutReport {
            had_session: current.is_some(),
            credentials_cleared,
            receipt,
            sync_error,
            telemetry_error,
            credential_error: credential_result.err(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn identity() -> SessionIdentity {
        SessionIdentity::new("subject-1", "tenant-a", 7).expect("valid identity")
    }

    fn drained(count: u64) -> DurableSyncReceipt {
        DurableSyncReceipt::new(count, count, 0, 0, true, true).expect("valid receipt")
    }

    #[test]
    fn login_syncs_once_and_rejects_an_implicit_tenant_switch() {
        let mut lifecycle = AuthenticatedSessionLifecycle::default();
        let first = lifecycle
            .on_login(identity(), |reason| {
                assert_eq!(reason, SessionSyncReason::Login);
                Ok::<_, ()>(drained(2))
            })
            .expect("login accepted");
        assert!(first.sync_succeeded());

        let duplicate = lifecycle
            .on_login(identity(), |_| -> Result<DurableSyncReceipt, ()> {
                panic!("duplicate login must coalesce")
            })
            .expect("duplicate accepted");
        assert!(!duplicate.sync_triggered);

        assert!(lifecycle
            .on_login(
                SessionIdentity::new("subject-1", "tenant-b", 8).expect("identity"),
                |_| Ok::<_, ()>(drained(0)),
            )
            .is_err());
    }

    #[test]
    fn logout_orders_durable_sync_then_force_flush_then_credential_clear() {
        let mut lifecycle = AuthenticatedSessionLifecycle::default();
        lifecycle
            .on_login(identity(), |_| Ok::<_, ()>(drained(0)))
            .expect("login accepted");
        let order = std::cell::RefCell::new(Vec::new());
        let report = lifecycle.on_logout(
            |_| {
                order.borrow_mut().push("logout-sync");
                Ok::<_, ()>(drained(3))
            },
            || {
                order.borrow_mut().push("telemetry-force-flush");
                Ok::<_, ()>(())
            },
            |session| {
                assert_eq!(session, Some(&identity()));
                order.borrow_mut().push("credentials-clear");
                Ok::<_, ()>(())
            },
        );
        assert_eq!(
            *order.borrow(),
            ["logout-sync", "telemetry-force-flush", "credentials-clear"]
        );
        assert!(report.complete());
        assert!(lifecycle.session().is_none());
    }

    #[test]
    fn incomplete_acknowledgement_is_never_reported_as_a_drained_logout() {
        let mut lifecycle = AuthenticatedSessionLifecycle::default();
        lifecycle
            .on_login(identity(), |_| Ok::<_, ()>(drained(0)))
            .expect("login accepted");
        let report = lifecycle.on_logout(
            |_| Ok::<_, ()>(DurableSyncReceipt::new(4, 3, 0, 1, true, true).expect("receipt")),
            || Ok::<_, ()>(()),
            |_| Ok::<_, ()>(()),
        );
        assert!(!report.data_durably_drained());
        assert!(!report.complete());
        assert!(lifecycle.session().is_none());
    }

    #[test]
    fn concurrent_admission_is_accounted_but_never_called_drained() {
        let receipt = DurableSyncReceipt::new(4, 4, 1, 1, true, false).expect("receipt");
        assert!(!receipt.durably_drained());
    }

    #[test]
    fn receipt_rejects_portable_domain_overflow_without_saturation() {
        assert!(DurableSyncReceipt::new(
            MAX_PORTABLE_SESSION_INTEGER,
            0,
            1,
            MAX_PORTABLE_SESSION_INTEGER,
            true,
            false,
        )
        .is_err());
    }
}
