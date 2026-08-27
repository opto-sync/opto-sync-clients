//! Transport-neutral opto-sync protocol v1 types and queue state.
//!
//! [`ProtocolQueue`] is intentionally independent of HTTP. Persist the entire
//! value (or implement the same transitions in your ORM) in one transaction
//! with the optimistic write. A stable `client_id` must be loaded from durable
//! storage; unlike an HLC node id it must not change on process restart.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

use crate::consistency::{
    assert_queued_intent_frozen, canonicalize_consistency_policy, ConsistencyError,
    ConsistencyPolicy, MutationIntent, WRITE_THROUGH_LOCAL_FIRST,
};

const MAX_I64: u64 = i64::MAX as u64;
pub const DEFAULT_MAX_PENDING_MUTATIONS: usize = 10_000;
pub const DEFAULT_MAX_QUEUED_PAYLOAD_BYTES: usize = 255 * 1024;

const fn default_max_pending_mutations() -> usize {
    DEFAULT_MAX_PENDING_MUTATIONS
}

const fn default_max_queued_payload_bytes() -> usize {
    DEFAULT_MAX_QUEUED_PAYLOAD_BYTES
}

#[must_use]
pub const fn valid_push_limit(limit: usize) -> bool {
    limit >= 1 && limit <= 100
}

#[must_use]
pub const fn can_allocate_mutation_id(next_mutation_id: u64) -> bool {
    next_mutation_id >= 1 && next_mutation_id <= MAX_I64
}

#[must_use]
pub const fn watermark_is_valid(watermark: u64, next_mutation_id: u64) -> bool {
    watermark < next_mutation_id
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProtocolError {
    EmptyClientId,
    InvalidLimit,
    InvalidQueueLimit,
    InvalidPayload,
    InvalidTarget,
    InvalidQueueState,
    QueueFull,
    PayloadTooLarge,
    MutationIdExhausted,
    WrongClient,
    InvalidAcknowledgement,
    InvalidDecimal,
    InvalidSnapshot,
    WatermarkAhead,
}

impl std::fmt::Display for ProtocolError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let message = match self {
            Self::EmptyClientId => "client id must not be empty",
            Self::InvalidLimit => "push limit must be from 1 through 100",
            Self::InvalidQueueLimit => "queue limits must be positive",
            Self::InvalidPayload => "an upsert payload must be a JSON object",
            Self::InvalidTarget => "client, table, or record identity is invalid",
            Self::InvalidQueueState => "persisted protocol queue state is invalid",
            Self::QueueFull => "pending mutation queue is full",
            Self::PayloadTooLarge => "queued JSON payload exceeds its byte limit",
            Self::MutationIdExhausted => "mutation id exceeds PostgreSQL signed bigint",
            Self::WrongClient => "push acknowledgement belongs to another client",
            Self::InvalidAcknowledgement => "push acknowledgement does not match the sent batch",
            Self::InvalidDecimal => "value is not a canonical unsigned decimal string",
            Self::InvalidSnapshot => "snapshot is not a valid protocol v1 snapshot",
            Self::WatermarkAhead => "server watermark is ahead of the locally allocated sequence",
        };
        f.write_str(message)
    }
}

impl std::error::Error for ProtocolError {}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Operation {
    Upsert,
    Delete,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LocalProtocolStatus {
    #[default]
    Pending,
    Confirmed,
}

fn is_pending(value: &LocalProtocolStatus) -> bool {
    *value == LocalProtocolStatus::Pending
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProtocolMutation {
    pub mutation_id: String,
    pub operation: Operation,
    pub table: String,
    pub record_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub payload: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub base_revision: Option<String>,
    #[serde(default, skip_serializing_if = "is_false")]
    pub resurrect: bool,
    #[serde(default, skip_serializing_if = "is_pending")]
    pub status: LocalProtocolStatus,
}

fn is_false(value: &bool) -> bool {
    !*value
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PushRequest {
    pub protocol_version: u8,
    pub client_id: String,
    pub mutations: Vec<ProtocolMutation>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ResultStatus {
    Applied,
    Duplicate,
    Rejected,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MutationResult {
    pub mutation_id: String,
    pub status: ResultStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub original_status: Option<ResultStatus>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub checkpoint: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub revision: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PushResponse {
    pub protocol_version: u8,
    pub client_id: String,
    pub last_mutation_id: String,
    pub checkpoint: String,
    pub results: Vec<MutationResult>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Change {
    pub checkpoint: String,
    pub table: String,
    pub record_id: String,
    pub operation: Operation,
    pub record: Option<Value>,
    pub revision: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<ChangeSource>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangeSource {
    pub client_id: String,
    pub mutation_id: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PullResponse {
    pub protocol_version: u8,
    pub checkpoint: String,
    pub has_more: bool,
    pub changes: Vec<Change>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotRecord {
    pub table: String,
    pub record_id: String,
    pub record: Value,
    pub revision: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotResponse {
    pub protocol_version: u8,
    pub checkpoint: String,
    pub records: Vec<SnapshotRecord>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SnapshotInstallError<E> {
    Protocol(ProtocolError),
    Replace(E),
}

impl<E: std::fmt::Display> std::fmt::Display for SnapshotInstallError<E> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Protocol(error) => write!(f, "{error}"),
            Self::Replace(error) => write!(f, "authoritative snapshot replacement failed: {error}"),
        }
    }
}

impl<E: std::fmt::Debug + std::fmt::Display> std::error::Error for SnapshotInstallError<E> {}

/// Serializable reference state for a protocol-aware Rust client.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProtocolQueue {
    client_id: String,
    next_mutation_id: u64,
    checkpoint: String,
    mutations: Vec<ProtocolMutation>,
    #[serde(default = "default_max_pending_mutations")]
    max_pending_mutations: usize,
    #[serde(default = "default_max_queued_payload_bytes")]
    max_queued_payload_bytes: usize,
    /// Canonical consistency policy per mutation id. Local durable intent only.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    consistency_policies: BTreeMap<String, String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProtocolQueueWire {
    client_id: String,
    next_mutation_id: u64,
    checkpoint: String,
    mutations: Vec<ProtocolMutation>,
    #[serde(default = "default_max_pending_mutations")]
    max_pending_mutations: usize,
    #[serde(default = "default_max_queued_payload_bytes")]
    max_queued_payload_bytes: usize,
    #[serde(default)]
    consistency_policies: BTreeMap<String, String>,
}

impl<'de> Deserialize<'de> for ProtocolQueue {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let wire = ProtocolQueueWire::deserialize(deserializer)?;
        let queue = Self {
            client_id: wire.client_id,
            next_mutation_id: wire.next_mutation_id,
            checkpoint: wire.checkpoint,
            mutations: wire.mutations,
            max_pending_mutations: wire.max_pending_mutations,
            max_queued_payload_bytes: wire.max_queued_payload_bytes,
            consistency_policies: wire.consistency_policies,
        };
        queue
            .validate()
            .map_err(<D::Error as serde::de::Error>::custom)?;
        Ok(queue)
    }
}

impl ProtocolQueue {
    pub fn new(client_id: impl Into<String>) -> Result<Self, ProtocolError> {
        Self::with_limits(
            client_id,
            DEFAULT_MAX_PENDING_MUTATIONS,
            DEFAULT_MAX_QUEUED_PAYLOAD_BYTES,
        )
    }

    pub fn with_limits(
        client_id: impl Into<String>,
        max_pending_mutations: usize,
        max_queued_payload_bytes: usize,
    ) -> Result<Self, ProtocolError> {
        let client_id = client_id.into();
        if client_id.is_empty() {
            return Err(ProtocolError::EmptyClientId);
        }
        if !valid_scope_id(&client_id) {
            return Err(ProtocolError::InvalidTarget);
        }
        if max_pending_mutations == 0 || max_queued_payload_bytes < 2 {
            return Err(ProtocolError::InvalidQueueLimit);
        }
        Ok(Self {
            client_id,
            next_mutation_id: 1,
            checkpoint: "0".to_string(),
            mutations: Vec::new(),
            max_pending_mutations,
            max_queued_payload_bytes,
            consistency_policies: BTreeMap::new(),
        })
    }

    pub fn client_id(&self) -> &str {
        &self.client_id
    }

    pub fn checkpoint(&self) -> &str {
        &self.checkpoint
    }

    /// Install a reset snapshot while preserving every pending mutation.
    ///
    /// The callback must atomically replace the application's authoritative
    /// store. Its success is ordered before the checkpoint update; a failure
    /// leaves this queue unchanged so the replacement can be retried.
    pub fn install_snapshot<E, F>(
        &mut self,
        snapshot: &SnapshotResponse,
        replace_authoritative: F,
    ) -> Result<(), SnapshotInstallError<E>>
    where
        F: FnOnce(&[SnapshotRecord]) -> Result<(), E>,
    {
        let valid_records = snapshot.records.iter().all(|entry| {
            valid_scope_id(&entry.table)
                && valid_record_id(&entry.record_id)
                && entry.record.is_object()
                && parse_decimal(&entry.revision).is_ok_and(|revision| revision > 0)
        });
        if snapshot.protocol_version != 1
            || parse_decimal(&snapshot.checkpoint).is_err()
            || !valid_records
        {
            return Err(SnapshotInstallError::Protocol(
                ProtocolError::InvalidSnapshot,
            ));
        }
        replace_authoritative(&snapshot.records).map_err(SnapshotInstallError::Replace)?;
        self.checkpoint.clone_from(&snapshot.checkpoint);
        Ok(())
    }

    pub fn all(&self) -> &[ProtocolMutation] {
        &self.mutations
    }

    pub fn pending(&self) -> impl Iterator<Item = &ProtocolMutation> {
        self.mutations
            .iter()
            .filter(|mutation| mutation.status == LocalProtocolStatus::Pending)
    }

    pub fn queue_upsert(
        &mut self,
        table: impl Into<String>,
        record_id: impl Into<String>,
        payload: Value,
        base_revision: Option<String>,
        resurrect: bool,
    ) -> Result<String, ProtocolError> {
        let table = table.into();
        let record_id = record_id.into();
        if !valid_scope_id(&table) || !valid_record_id(&record_id) {
            return Err(ProtocolError::InvalidTarget);
        }
        if !payload.is_object() {
            return Err(ProtocolError::InvalidPayload);
        }
        let payload_bytes = serde_json::to_vec(&payload)
            .map_err(|_| ProtocolError::InvalidPayload)?
            .len();
        self.queue(
            ProtocolMutation {
                mutation_id: String::new(),
                operation: Operation::Upsert,
                table,
                record_id,
                payload: Some(payload),
                base_revision,
                resurrect,
                status: LocalProtocolStatus::Pending,
            },
            payload_bytes,
        )
    }

    pub fn queue_delete(
        &mut self,
        table: impl Into<String>,
        record_id: impl Into<String>,
        base_revision: Option<String>,
    ) -> Result<String, ProtocolError> {
        let table = table.into();
        let record_id = record_id.into();
        if !valid_scope_id(&table) || !valid_record_id(&record_id) {
            return Err(ProtocolError::InvalidTarget);
        }
        self.queue(
            ProtocolMutation {
                mutation_id: String::new(),
                operation: Operation::Delete,
                table,
                record_id,
                payload: None,
                base_revision,
                resurrect: false,
                status: LocalProtocolStatus::Pending,
            },
            2,
        )
    }

    fn queue(
        &mut self,
        mut mutation: ProtocolMutation,
        payload_bytes: usize,
    ) -> Result<String, ProtocolError> {
        if payload_bytes > self.max_queued_payload_bytes {
            return Err(ProtocolError::PayloadTooLarge);
        }
        if self.pending().count() >= self.max_pending_mutations {
            return Err(ProtocolError::QueueFull);
        }
        if !can_allocate_mutation_id(self.next_mutation_id) {
            return Err(ProtocolError::MutationIdExhausted);
        }
        let id = self.next_mutation_id.to_string();
        self.next_mutation_id = self
            .next_mutation_id
            .checked_add(1)
            .ok_or(ProtocolError::MutationIdExhausted)?;
        mutation.mutation_id = id.clone();
        self.mutations.push(mutation);
        self.consistency_policies
            .entry(id.clone())
            .or_insert_with(|| WRITE_THROUGH_LOCAL_FIRST.to_string());
        Ok(id)
    }

    pub fn queue_upsert_with_consistency(
        &mut self,
        table: impl Into<String>,
        record_id: impl Into<String>,
        payload: Value,
        base_revision: Option<String>,
        resurrect: bool,
        policy: ConsistencyPolicy,
    ) -> Result<String, ProtocolError> {
        let id = self.queue_upsert(table, record_id, payload, base_revision, resurrect)?;
        self.consistency_policies
            .insert(id.clone(), policy.as_str().to_string());
        Ok(id)
    }

    pub fn queue_delete_with_consistency(
        &mut self,
        table: impl Into<String>,
        record_id: impl Into<String>,
        base_revision: Option<String>,
        policy: ConsistencyPolicy,
    ) -> Result<String, ProtocolError> {
        let id = self.queue_delete(table, record_id, base_revision)?;
        self.consistency_policies
            .insert(id.clone(), policy.as_str().to_string());
        Ok(id)
    }

    #[must_use]
    pub fn consistency_policy(&self, mutation_id: &str) -> Option<&str> {
        self.consistency_policies
            .get(mutation_id)
            .map(String::as_str)
    }

    pub fn rebind_consistency(
        &self,
        mutation_id: &str,
        proposed: &MutationIntent,
    ) -> Result<(), ConsistencyError> {
        let existing_row = self
            .mutations
            .iter()
            .find(|mutation| mutation.mutation_id == mutation_id)
            .ok_or_else(|| {
                ConsistencyError::FrozenIntent(format!("queued mutation {mutation_id} is missing"))
            })?;
        let existing = MutationIntent {
            client_id: self.client_id.clone(),
            mutation_id: existing_row.mutation_id.clone(),
            table: existing_row.table.clone(),
            record_id: existing_row.record_id.clone(),
            operation: match existing_row.operation {
                Operation::Upsert => "upsert".to_string(),
                Operation::Delete => "delete".to_string(),
            },
            payload: existing_row.payload.clone(),
            base_revision: existing_row.base_revision.clone(),
            resurrect: existing_row.resurrect,
            consistency_policy: self
                .consistency_policy(mutation_id)
                .unwrap_or(WRITE_THROUGH_LOCAL_FIRST)
                .to_string(),
        };
        let _ = canonicalize_consistency_policy(&existing.consistency_policy)?;
        assert_queued_intent_frozen(&existing, proposed)
    }

    /// Remove the oldest confirmed entries while preserving pending work.
    pub fn prune_confirmed(&mut self, retain: usize) -> usize {
        let confirmed = self
            .mutations
            .iter()
            .filter(|mutation| mutation.status == LocalProtocolStatus::Confirmed)
            .count();
        let mut remove = confirmed.saturating_sub(retain);
        let before = self.mutations.len();
        self.mutations.retain(|mutation| {
            if remove > 0 && mutation.status == LocalProtocolStatus::Confirmed {
                remove -= 1;
                false
            } else {
                true
            }
        });
        before - self.mutations.len()
    }

    pub fn push_request(&self, limit: usize) -> Result<PushRequest, ProtocolError> {
        if !valid_push_limit(limit) {
            return Err(ProtocolError::InvalidLimit);
        }
        Ok(PushRequest {
            protocol_version: 1,
            client_id: self.client_id.clone(),
            mutations: self.pending().take(limit).cloned().collect(),
        })
    }

    /// Mark all rows through the durable server watermark confirmed.
    ///
    /// This includes permanent rejections. Their detail remains in
    /// [`PushResponse::results`] for application conflict handling, but they
    /// must not remain a poison pill at the head of the queue.
    pub fn acknowledge(
        &mut self,
        response: &PushResponse,
        request: &PushRequest,
    ) -> Result<usize, ProtocolError> {
        let request_matches_pending = request
            .mutations
            .iter()
            .eq(self.pending().take(request.mutations.len()));
        if request.client_id != self.client_id || response.client_id != self.client_id {
            return Err(ProtocolError::WrongClient);
        }
        if request.protocol_version != 1
            || request.mutations.is_empty()
            || request.mutations.len() > 100
            || !request_matches_pending
            || response.protocol_version != 1
            || response.results.len() != request.mutations.len()
            || response.last_mutation_id
                != request
                    .mutations
                    .last()
                    .expect("non-empty checked above")
                    .mutation_id
            || parse_decimal(&response.checkpoint).is_err()
            || request
                .mutations
                .iter()
                .zip(&response.results)
                .any(|(sent, result)| {
                    sent.mutation_id != result.mutation_id
                        || result
                            .checkpoint
                            .as_deref()
                            .is_some_and(|value| parse_decimal(value).is_err())
                        || result.revision.as_deref().is_some_and(|value| {
                            parse_decimal(value).is_err()
                                || parse_decimal(value).is_ok_and(|revision| revision == 0)
                        })
                        || result.original_status == Some(ResultStatus::Duplicate)
                        || (result.status == ResultStatus::Duplicate
                            && result.original_status.is_none())
                        || (result.status != ResultStatus::Duplicate
                            && result.original_status.is_some())
                })
        {
            return Err(ProtocolError::InvalidAcknowledgement);
        }
        let watermark = parse_decimal(&response.last_mutation_id)?;
        if !watermark_is_valid(watermark, self.next_mutation_id) {
            return Err(ProtocolError::WatermarkAhead);
        }
        let mut changed = 0;
        for mutation in &mut self.mutations {
            let id = parse_decimal(&mutation.mutation_id)?;
            if id <= watermark && mutation.status == LocalProtocolStatus::Pending {
                mutation.status = LocalProtocolStatus::Confirmed;
                changed += 1;
            }
        }
        Ok(changed)
    }

    pub fn set_checkpoint(&mut self, checkpoint: impl Into<String>) -> Result<(), ProtocolError> {
        let checkpoint = checkpoint.into();
        parse_decimal(&checkpoint)?;
        self.checkpoint = checkpoint;
        Ok(())
    }

    /// Recheck every invariant required for safe durable retry.
    ///
    /// Custom deserialization calls this automatically. It is public so a
    /// database adapter can validate state obtained through another encoding.
    pub fn validate(&self) -> Result<(), ProtocolError> {
        if !valid_scope_id(&self.client_id)
            || self.max_pending_mutations == 0
            || self.max_queued_payload_bytes < 2
            || parse_decimal(&self.checkpoint).is_err()
            || self.next_mutation_id == 0
            || self.next_mutation_id > MAX_I64 + 1
        {
            return Err(ProtocolError::InvalidQueueState);
        }

        let mut prior_id = 0;
        let mut pending = 0usize;
        for mutation in &self.mutations {
            let id = parse_decimal(&mutation.mutation_id)
                .map_err(|_| ProtocolError::InvalidQueueState)?;
            if id == 0
                || id <= prior_id
                || id >= self.next_mutation_id
                || !valid_scope_id(&mutation.table)
                || !valid_record_id(&mutation.record_id)
                || mutation
                    .base_revision
                    .as_deref()
                    .is_some_and(|revision| parse_decimal(revision).is_err())
            {
                return Err(ProtocolError::InvalidQueueState);
            }
            prior_id = id;

            match mutation.operation {
                Operation::Upsert => {
                    let payload = mutation
                        .payload
                        .as_ref()
                        .filter(|payload| payload.is_object())
                        .ok_or(ProtocolError::InvalidQueueState)?;
                    let bytes = serde_json::to_vec(payload)
                        .map_err(|_| ProtocolError::InvalidQueueState)?
                        .len();
                    if bytes > self.max_queued_payload_bytes {
                        return Err(ProtocolError::InvalidQueueState);
                    }
                }
                Operation::Delete => {
                    if mutation.payload.is_some() || mutation.resurrect {
                        return Err(ProtocolError::InvalidQueueState);
                    }
                }
            }
            if mutation.status == LocalProtocolStatus::Pending {
                pending += 1;
            }
        }
        if pending > self.max_pending_mutations {
            return Err(ProtocolError::InvalidQueueState);
        }
        Ok(())
    }

    /// Merge queue state appended by another transactional connection.
    ///
    /// SQLite uses this immediately before every sync-side commit. Existing
    /// mutation bytes are immutable, confirmation is monotonic, pending rows
    /// cannot be pruned, and only ids allocated at or beyond this clone's
    /// original `next_mutation_id` may be imported as concurrent appends.
    #[cfg(feature = "sqlite")]
    pub(crate) fn merge_concurrent_durable(&mut self, durable: &Self) -> Result<(), ProtocolError> {
        self.validate()?;
        durable.validate()?;
        if self.client_id != durable.client_id
            || self.max_pending_mutations != durable.max_pending_mutations
            || self.max_queued_payload_bytes != durable.max_queued_payload_bytes
            || self.next_mutation_id > durable.next_mutation_id
        {
            return Err(ProtocolError::InvalidQueueState);
        }

        let original_next = self.next_mutation_id;
        for mutation in &mut self.mutations {
            let durable_mutation = durable
                .mutations
                .iter()
                .find(|candidate| candidate.mutation_id == mutation.mutation_id)
                .ok_or(ProtocolError::InvalidQueueState)?;
            if !same_immutable_mutation(mutation, durable_mutation) {
                return Err(ProtocolError::InvalidQueueState);
            }
            if durable_mutation.status == LocalProtocolStatus::Confirmed {
                mutation.status = LocalProtocolStatus::Confirmed;
            }
        }

        for durable_mutation in &durable.mutations {
            if self
                .mutations
                .iter()
                .any(|mutation| mutation.mutation_id == durable_mutation.mutation_id)
            {
                continue;
            }
            let id = parse_decimal(&durable_mutation.mutation_id)?;
            if id >= original_next {
                self.mutations.push(durable_mutation.clone());
            } else if durable_mutation.status == LocalProtocolStatus::Pending {
                return Err(ProtocolError::InvalidQueueState);
            }
        }
        self.mutations.sort_by_key(|mutation| {
            parse_decimal(&mutation.mutation_id).expect("validated mutation id")
        });
        self.next_mutation_id = durable.next_mutation_id;
        if parse_decimal(&durable.checkpoint)? > parse_decimal(&self.checkpoint)? {
            self.checkpoint.clone_from(&durable.checkpoint);
        }
        self.validate()
    }
}

#[cfg(feature = "sqlite")]
fn same_immutable_mutation(left: &ProtocolMutation, right: &ProtocolMutation) -> bool {
    left.mutation_id == right.mutation_id
        && left.operation == right.operation
        && left.table == right.table
        && left.record_id == right.record_id
        && left.payload == right.payload
        && left.base_revision == right.base_revision
        && left.resurrect == right.resurrect
}

fn valid_scope_id(value: &str) -> bool {
    let mut bytes = value.bytes();
    let Some(first) = bytes.next() else {
        return false;
    };
    value.len() <= 128
        && first.is_ascii_alphanumeric()
        && bytes
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b':' | b'-'))
}

fn valid_record_id(value: &str) -> bool {
    !value.is_empty() && value.chars().count() <= 512
}

fn parse_decimal(value: &str) -> Result<u64, ProtocolError> {
    if value.is_empty()
        || (value.len() > 1 && value.starts_with('0'))
        || !value.bytes().all(|byte| byte.is_ascii_digit())
    {
        return Err(ProtocolError::InvalidDecimal);
    }
    value.parse().map_err(|_| ProtocolError::InvalidDecimal)
}

#[cfg(kani)]
mod verification {
    use super::*;

    #[kani::proof]
    fn push_limit_matches_protocol_v1_batch_bound() {
        let limit = kani::any::<usize>();
        assert_eq!(valid_push_limit(limit), limit >= 1 && limit <= 100);
    }

    #[kani::proof]
    fn allocatable_identity_always_has_a_safe_successor() {
        let next_mutation_id = kani::any::<u64>();
        if can_allocate_mutation_id(next_mutation_id) {
            let successor = next_mutation_id.checked_add(1);
            assert!(successor.is_some());
            assert!(successor.unwrap() <= MAX_I64 + 1);
        }
    }

    #[kani::proof]
    fn server_watermark_cannot_confirm_unallocated_identity() {
        let watermark = kani::any::<u64>();
        let next_mutation_id = kani::any::<u64>();
        assert_eq!(
            watermark_is_valid(watermark, next_mutation_id),
            watermark < next_mutation_id
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn wire_format_and_acknowledgement_match_protocol_v1() {
        let mut queue = ProtocolQueue::new("device-a").unwrap();
        queue
            .queue_upsert(
                "docs",
                "r1",
                json!({"id": "r1", "title": "draft"}),
                Some("7".to_string()),
                true,
            )
            .unwrap();
        queue
            .queue_delete("docs", "r2", Some("3".to_string()))
            .unwrap();

        let request = queue.push_request(100).unwrap();
        let encoded = serde_json::to_value(&request).unwrap();
        assert_eq!(encoded["protocolVersion"], 1);
        assert_eq!(encoded["clientId"], "device-a");
        assert_eq!(encoded["mutations"][0]["mutationId"], "1");
        assert_eq!(encoded["mutations"][0]["operation"], "upsert");
        assert_eq!(encoded["mutations"][0]["resurrect"], true);
        assert_eq!(encoded["mutations"][1]["operation"], "delete");
        assert!(encoded["mutations"][1].get("payload").is_none());

        let response = PushResponse {
            protocol_version: 1,
            client_id: "device-a".to_string(),
            last_mutation_id: "2".to_string(),
            checkpoint: "1".to_string(),
            results: vec![
                MutationResult {
                    mutation_id: "1".to_string(),
                    status: ResultStatus::Applied,
                    original_status: None,
                    checkpoint: Some("1".to_string()),
                    revision: Some("1".to_string()),
                    code: None,
                    message: None,
                },
                MutationResult {
                    mutation_id: "2".to_string(),
                    status: ResultStatus::Rejected,
                    original_status: None,
                    checkpoint: None,
                    revision: None,
                    code: Some("REVISION_CONFLICT".to_string()),
                    message: None,
                },
            ],
        };
        assert_eq!(queue.acknowledge(&response, &request).unwrap(), 2);
        assert_eq!(queue.pending().count(), 0);
    }

    #[test]
    fn state_round_trips_and_checkpoints_remain_decimal_strings() {
        let mut queue = ProtocolQueue::new("durable-device").unwrap();
        queue
            .queue_upsert("docs", "r1", json!({"id": "r1"}), None, false)
            .unwrap();
        queue.set_checkpoint("9007199254740993").unwrap();
        let restored: ProtocolQueue =
            serde_json::from_str(&serde_json::to_string(&queue).unwrap()).unwrap();
        assert_eq!(restored, queue);
        assert_eq!(restored.checkpoint(), "9007199254740993");
        assert_eq!(
            queue.set_checkpoint("01"),
            Err(ProtocolError::InvalidDecimal)
        );
    }

    #[test]
    fn snapshot_install_advances_only_after_replace_and_preserves_pending_work() {
        let mut queue = ProtocolQueue::new("durable-device").unwrap();
        queue
            .queue_upsert("docs", "local", json!({"title": "optimistic"}), None, false)
            .unwrap();
        let snapshot = SnapshotResponse {
            protocol_version: 1,
            checkpoint: "42".to_string(),
            records: vec![SnapshotRecord {
                table: "docs".to_string(),
                record_id: "r1".to_string(),
                record: json!({"id": "r1", "title": "authoritative"}),
                revision: "7".to_string(),
            }],
        };

        let interrupted =
            queue.install_snapshot(&snapshot, |_| Err::<(), _>("replacement interrupted"));
        assert!(matches!(
            interrupted,
            Err(SnapshotInstallError::Replace("replacement interrupted"))
        ));
        assert_eq!(queue.checkpoint(), "0");
        assert_eq!(queue.pending().count(), 1);

        let mut malformed = snapshot.clone();
        malformed.records[0].revision = "01".to_string();
        let mut malformed_called = false;
        let malformed_result = queue.install_snapshot(&malformed, |_| {
            malformed_called = true;
            Ok::<(), &'static str>(())
        });
        assert_eq!(
            malformed_result,
            Err(SnapshotInstallError::Protocol(
                ProtocolError::InvalidSnapshot
            ))
        );
        assert!(!malformed_called);

        let mut installed = Vec::new();
        queue
            .install_snapshot(&snapshot, |records| {
                installed = records.to_vec();
                Ok::<(), &'static str>(())
            })
            .unwrap();
        assert_eq!(installed, snapshot.records);
        assert_eq!(queue.checkpoint(), "42");
        assert_eq!(queue.pending().count(), 1);
    }

    #[test]
    fn rejects_non_object_payload_and_foreign_ack() {
        let mut queue = ProtocolQueue::new("device-a").unwrap();
        assert_eq!(
            queue.queue_upsert("docs", "r1", json!([1, 2]), None, false),
            Err(ProtocolError::InvalidPayload)
        );
        queue
            .queue_delete("docs", "r1", None)
            .expect("valid delete");
        let request = queue.push_request(100).unwrap();
        let response = PushResponse {
            protocol_version: 1,
            client_id: "device-b".to_string(),
            last_mutation_id: "1".to_string(),
            checkpoint: "0".to_string(),
            results: vec![MutationResult {
                mutation_id: "1".to_string(),
                status: ResultStatus::Applied,
                original_status: None,
                checkpoint: None,
                revision: None,
                code: None,
                message: None,
            }],
        };
        assert_eq!(
            queue.acknowledge(&response, &request),
            Err(ProtocolError::WrongClient)
        );
    }

    #[test]
    fn acknowledgement_cannot_discard_mutations_outside_the_sent_batch() {
        let mut queue = ProtocolQueue::new("device-a").unwrap();
        queue.queue_delete("docs", "r1", None).unwrap();
        queue.queue_delete("docs", "r2", None).unwrap();
        let request = queue.push_request(1).unwrap();
        let response = PushResponse {
            protocol_version: 1,
            client_id: "device-a".to_string(),
            last_mutation_id: "2".to_string(),
            checkpoint: "2".to_string(),
            results: vec![
                MutationResult {
                    mutation_id: "1".to_string(),
                    status: ResultStatus::Applied,
                    original_status: None,
                    checkpoint: Some("1".to_string()),
                    revision: None,
                    code: None,
                    message: None,
                },
                MutationResult {
                    mutation_id: "2".to_string(),
                    status: ResultStatus::Applied,
                    original_status: None,
                    checkpoint: Some("2".to_string()),
                    revision: None,
                    code: None,
                    message: None,
                },
            ],
        };
        assert_eq!(
            queue.acknowledge(&response, &request),
            Err(ProtocolError::InvalidAcknowledgement)
        );
        assert_eq!(queue.pending().count(), 2);
    }

    #[test]
    fn acknowledgement_requires_the_exact_current_pending_prefix() {
        let mut queue = ProtocolQueue::new("device-a").unwrap();
        queue
            .queue_upsert("docs", "r1", json!({"v": 1}), None, false)
            .unwrap();
        let mut forged_request = queue.push_request(1).unwrap();
        forged_request.mutations[0].payload = Some(json!({"v": "not what was sent"}));
        let response = PushResponse {
            protocol_version: 1,
            client_id: "device-a".to_string(),
            last_mutation_id: "1".to_string(),
            checkpoint: "1".to_string(),
            results: vec![MutationResult {
                mutation_id: "1".to_string(),
                status: ResultStatus::Applied,
                original_status: None,
                checkpoint: Some("1".to_string()),
                revision: Some("1".to_string()),
                code: None,
                message: None,
            }],
        };
        assert_eq!(
            queue.acknowledge(&response, &forged_request),
            Err(ProtocolError::InvalidAcknowledgement)
        );
        assert_eq!(queue.pending().count(), 1);

        let request = queue.push_request(1).unwrap();
        let mut malformed_duplicate = response;
        malformed_duplicate.results[0].status = ResultStatus::Duplicate;
        assert_eq!(
            queue.acknowledge(&malformed_duplicate, &request),
            Err(ProtocolError::InvalidAcknowledgement)
        );
        assert_eq!(queue.pending().count(), 1);
    }

    #[test]
    fn queue_limits_refuse_before_allocating_a_mutation_id() {
        let mut queue = ProtocolQueue::with_limits("device-a", 2, 32).unwrap();
        assert_eq!(
            queue.queue_upsert(
                "docs",
                "large",
                json!({"text": "this payload is intentionally too large"}),
                None,
                false,
            ),
            Err(ProtocolError::PayloadTooLarge)
        );
        assert_eq!(
            queue
                .queue_upsert("docs", "r1", json!({"v": 1}), None, false)
                .unwrap(),
            "1"
        );
        assert_eq!(
            queue
                .queue_upsert("docs", "r2", json!({"v": 2}), None, false)
                .unwrap(),
            "2"
        );
        assert_eq!(
            queue.queue_delete("docs", "r3", None),
            Err(ProtocolError::QueueFull)
        );
        assert_eq!(queue.all().len(), 2);
    }

    #[test]
    fn pruning_removes_only_the_oldest_confirmed_entries() {
        let mut queue = ProtocolQueue::new("device-a").unwrap();
        for record_id in ["r1", "r2", "r3"] {
            queue.queue_delete("docs", record_id, None).unwrap();
        }
        let request = queue.push_request(2).unwrap();
        queue
            .acknowledge(
                &PushResponse {
                    protocol_version: 1,
                    client_id: "device-a".to_string(),
                    last_mutation_id: "2".to_string(),
                    checkpoint: "2".to_string(),
                    results: vec![
                        MutationResult {
                            mutation_id: "1".to_string(),
                            status: ResultStatus::Applied,
                            original_status: None,
                            checkpoint: Some("1".to_string()),
                            revision: None,
                            code: None,
                            message: None,
                        },
                        MutationResult {
                            mutation_id: "2".to_string(),
                            status: ResultStatus::Applied,
                            original_status: None,
                            checkpoint: Some("2".to_string()),
                            revision: None,
                            code: None,
                            message: None,
                        },
                    ],
                },
                &request,
            )
            .unwrap();
        assert_eq!(queue.prune_confirmed(1), 1);
        assert_eq!(
            queue
                .all()
                .iter()
                .map(|mutation| mutation.mutation_id.as_str())
                .collect::<Vec<_>>(),
            vec!["2", "3"]
        );
        assert_eq!(queue.pending().count(), 1);
    }

    #[test]
    fn old_serialized_queue_state_loads_default_limits() {
        let restored: ProtocolQueue = serde_json::from_value(json!({
            "clientId": "old-client",
            "nextMutationId": 1,
            "checkpoint": "0",
            "mutations": []
        }))
        .unwrap();
        assert_eq!(
            restored
                .clone()
                .queue_upsert("docs", "r1", json!({"v": 1}), None, false)
                .unwrap(),
            "1"
        );
    }

    #[test]
    fn durable_deserialization_rejects_structurally_valid_but_unsafe_state() {
        let baseline = json!({
            "clientId": "device-a",
            "nextMutationId": 2,
            "checkpoint": "0",
            "mutations": [{
                "mutationId": "1",
                "operation": "upsert",
                "table": "docs",
                "recordId": "r1",
                "payload": {"v": 1}
            }],
            "maxPendingMutations": 10,
            "maxQueuedPayloadBytes": 1024
        });

        let mut cases = Vec::new();
        let mut reused_id = baseline.clone();
        reused_id["nextMutationId"] = json!(1);
        cases.push(reused_id);
        let mut noncanonical_checkpoint = baseline.clone();
        noncanonical_checkpoint["checkpoint"] = json!("01");
        cases.push(noncanonical_checkpoint);
        let mut invalid_table = baseline.clone();
        invalid_table["mutations"][0]["table"] = json!("bad table");
        cases.push(invalid_table);
        let mut delete_with_payload = baseline.clone();
        delete_with_payload["mutations"][0]["operation"] = json!("delete");
        cases.push(delete_with_payload);
        let mut over_quota = baseline.clone();
        over_quota["maxPendingMutations"] = json!(0);
        cases.push(over_quota);

        for state in cases {
            assert!(
                serde_json::from_value::<ProtocolQueue>(state).is_err(),
                "unsafe durable state must fail closed"
            );
        }
    }

    #[test]
    fn identity_validation_rejects_ambiguous_or_unbounded_targets() {
        assert_eq!(
            ProtocolQueue::new("client with whitespace"),
            Err(ProtocolError::InvalidTarget)
        );
        let mut queue = ProtocolQueue::new("device-a").unwrap();
        assert_eq!(
            queue.queue_delete("bad/table", "r1", None),
            Err(ProtocolError::InvalidTarget)
        );
        assert_eq!(
            queue.queue_delete("docs", "", None),
            Err(ProtocolError::InvalidTarget)
        );
        assert_eq!(
            queue.queue_delete("docs", "x".repeat(513), None),
            Err(ProtocolError::InvalidTarget)
        );
    }
}
