use opto_sync_desktop::session_lifecycle::{DurableSyncReceipt, SessionIdentity};
use serde::Deserialize;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Vector {
    id: String,
    pending_before: u64,
    acknowledged: u64,
    admitted_during_drain: u64,
    pending_after: u64,
    checkpoint_committed: bool,
    admission_fenced: bool,
    expected_valid: bool,
    expected_drained: bool,
}

#[derive(Debug, Deserialize)]
struct Invariants {
    #[serde(rename = "loginTriggersSyncOncePerAuthEpoch")]
    login_once: bool,
    #[serde(rename = "logoutRequiresDurableCheckpoint")]
    durable_checkpoint: bool,
    #[serde(rename = "transportAckIsNotDurableAck")]
    transport_ack_is_not_durable: bool,
    #[serde(rename = "credentialsClearAfterFlushAttempt")]
    clear_after_flush: bool,
    #[serde(rename = "unacknowledgedRowsRemainPending")]
    pending_rows_remain: bool,
}

#[derive(Debug, Deserialize)]
struct Corpus {
    schema: String,
    ordering: Vec<String>,
    invariants: Invariants,
    #[serde(rename = "identityVectors")]
    identity_vectors: Vec<IdentityVector>,
    vectors: Vec<Vector>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct IdentityVector {
    id: String,
    subject: String,
    subject_repeat: usize,
    tenant: String,
    tenant_repeat: usize,
    auth_epoch: i64,
    expected_valid: bool,
}

#[test]
fn rust_refines_the_shared_authenticated_session_vectors() {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../formal/session_lifecycle_vectors.v1.json");
    let corpus: Corpus = serde_json::from_slice(
        &std::fs::read(path).expect("read shared session lifecycle vectors"),
    )
    .expect("parse shared session lifecycle vectors");
    assert_eq!(corpus.schema, "opto-sync/session-lifecycle-vectors/v1");
    assert_eq!(
        corpus.ordering,
        ["logout-sync", "telemetry-force-flush", "credentials-clear"]
    );
    assert!(corpus.invariants.login_once);
    assert!(corpus.invariants.durable_checkpoint);
    assert!(corpus.invariants.transport_ack_is_not_durable);
    assert!(corpus.invariants.clear_after_flush);
    assert!(corpus.invariants.pending_rows_remain);

    for vector in corpus.identity_vectors {
        let identity = u64::try_from(vector.auth_epoch)
            .ok()
            .and_then(|auth_epoch| {
                SessionIdentity::new(
                    vector.subject.repeat(vector.subject_repeat),
                    vector.tenant.repeat(vector.tenant_repeat),
                    auth_epoch,
                )
                .ok()
            });
        assert_eq!(
            identity.is_some(),
            vector.expected_valid,
            "Rust identity validation diverged for {}",
            vector.id
        );
    }

    for vector in corpus.vectors {
        let receipt = DurableSyncReceipt::new(
            vector.pending_before,
            vector.acknowledged,
            vector.admitted_during_drain,
            vector.pending_after,
            vector.checkpoint_committed,
            vector.admission_fenced,
        );
        assert_eq!(
            receipt.is_ok(),
            vector.expected_valid,
            "Rust receipt validation diverged for {}",
            vector.id
        );
        assert_eq!(
            receipt.is_ok_and(DurableSyncReceipt::durably_drained),
            vector.expected_drained,
            "Rust receipt diverged for {}",
            vector.id
        );
    }
}
