//! Wire-neutral consistency policy identifiers, frozen mutation intent, and
//! deterministic local-plus-remote read reconciliation.
//!
//! Policy identity is durable local intent. It is not a server push field.
//! Unknown identifiers fail closed. An already queued mutation cannot change
//! identity or content, including its canonical policy id.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::cmp::Ordering;
use std::collections::{BTreeMap, HashSet};

pub const REMOTE_ACKNOWLEDGED: &str = "opto.consistency.remote-acknowledged.v1";
pub const WRITE_THROUGH_LOCAL_FIRST: &str = "opto.consistency.write-through-local-first.v1";
pub const QUEUED_LOCAL_FIRST: &str = "opto.consistency.queued-local-first.v1";

const POLICY_IDS: [&str; 3] = [
    REMOTE_ACKNOWLEDGED,
    WRITE_THROUGH_LOCAL_FIRST,
    QUEUED_LOCAL_FIRST,
];

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ConsistencyError {
    UnknownPolicy(String),
    FrozenIntent(String),
}

impl std::fmt::Display for ConsistencyError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::UnknownPolicy(identifier) => {
                write!(f, "unknown consistency policy {identifier:?}")
            }
            Self::FrozenIntent(message) => f.write_str(message),
        }
    }
}

impl std::error::Error for ConsistencyError {}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConsistencyPolicy {
    RemoteAcknowledged,
    WriteThroughLocalFirst,
    QueuedLocalFirst,
}

impl ConsistencyPolicy {
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::RemoteAcknowledged => REMOTE_ACKNOWLEDGED,
            Self::WriteThroughLocalFirst => WRITE_THROUGH_LOCAL_FIRST,
            Self::QueuedLocalFirst => QUEUED_LOCAL_FIRST,
        }
    }
}

pub fn canonicalize_consistency_policy(
    identifier: &str,
) -> Result<ConsistencyPolicy, ConsistencyError> {
    let canonical = match identifier {
        REMOTE_ACKNOWLEDGED
        | "remote-acknowledged"
        | "strict"
        | "remote-confirmed"
        | "await-server" => ConsistencyPolicy::RemoteAcknowledged,
        WRITE_THROUGH_LOCAL_FIRST
        | "write-through-local-first"
        | "local-then-remote"
        | "local-first" => ConsistencyPolicy::WriteThroughLocalFirst,
        QUEUED_LOCAL_FIRST | "queued-local-first" | "local-durable" | "background" => {
            ConsistencyPolicy::QueuedLocalFirst
        }
        other => return Err(ConsistencyError::UnknownPolicy(other.to_string())),
    };
    Ok(canonical)
}

#[must_use]
pub fn policy_ids() -> &'static [&'static str] {
    &POLICY_IDS
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MutationIntent {
    pub client_id: String,
    pub mutation_id: String,
    pub table: String,
    pub record_id: String,
    pub operation: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub payload: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub base_revision: Option<String>,
    #[serde(default, skip_serializing_if = "is_false")]
    pub resurrect: bool,
    pub consistency_policy: String,
}

fn is_false(value: &bool) -> bool {
    !*value
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConsistencyOutcome {
    pub status: &'static str,
    pub consistency_policy: ConsistencyPolicy,
    pub covered_mutation_ids: Vec<String>,
    pub message: Option<&'static str>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProtocolIdentity {
    pub client_id: String,
    pub mutation_id: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BaseRow {
    pub table: String,
    pub record_id: String,
    pub revision: String,
    pub operation: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub payload: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub identity: Option<ProtocolIdentity>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub arrival_seq: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OverlayEntry {
    pub mutation_id: String,
    pub client_id: String,
    pub table: String,
    pub record_id: String,
    pub operation: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub payload: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub revision: Option<String>,
    pub consistency_policy: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub transformed_payload: Option<Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectedRow {
    pub table: String,
    pub record_id: String,
    pub revision: String,
    pub operation: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub payload: Option<Value>,
    pub provenance: String,
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadReconciliationInput {
    #[serde(default)]
    pub local_base: Vec<BaseRow>,
    #[serde(default)]
    pub overlay: Vec<OverlayEntry>,
    #[serde(default)]
    pub remote: Vec<BaseRow>,
    #[serde(default)]
    pub acknowledged_mutation_ids: Vec<String>,
}

fn stable_json(value: &Option<Value>) -> String {
    match value {
        None | Some(Value::Null) => "null".to_string(),
        Some(other) => serde_json::to_string(&sort_value(other)).expect("json value"),
    }
}

fn sort_value(value: &Value) -> Value {
    match value {
        Value::Array(items) => Value::Array(items.iter().map(sort_value).collect()),
        Value::Object(map) => {
            let mut entries: Vec<_> = map.iter().collect();
            entries.sort_by(|left, right| left.0.cmp(right.0));
            Value::Object(
                entries
                    .into_iter()
                    .map(|(key, child)| (key.clone(), sort_value(child)))
                    .collect(),
            )
        }
        other => other.clone(),
    }
}

pub fn assert_queued_intent_frozen(
    existing: &MutationIntent,
    proposed: &MutationIntent,
) -> Result<(), ConsistencyError> {
    let existing_policy = canonicalize_consistency_policy(&existing.consistency_policy)?;
    let proposed_policy = canonicalize_consistency_policy(&proposed.consistency_policy)?;
    let same = existing.client_id == proposed.client_id
        && existing.mutation_id == proposed.mutation_id
        && existing.table == proposed.table
        && existing.record_id == proposed.record_id
        && existing.operation == proposed.operation
        && existing.base_revision.as_deref().unwrap_or("")
            == proposed.base_revision.as_deref().unwrap_or("")
        && existing.resurrect == proposed.resurrect
        && existing_policy == proposed_policy
        && stable_json(&existing.payload) == stable_json(&proposed.payload);
    if same {
        Ok(())
    } else {
        Err(ConsistencyError::FrozenIntent(format!(
            "queued mutation {}/{} cannot change identity or content",
            existing.client_id, existing.mutation_id
        )))
    }
}

pub fn outcome_for_network(
    policy: &str,
    network: &str,
    covered_mutation_ids: &[String],
) -> Result<ConsistencyOutcome, ConsistencyError> {
    let consistency_policy = canonicalize_consistency_policy(policy)?;
    if network == "cancelled" {
        return Ok(ConsistencyOutcome {
            status: "cancelled",
            consistency_policy,
            covered_mutation_ids: Vec::new(),
            message: None,
        });
    }
    if consistency_policy == ConsistencyPolicy::QueuedLocalFirst {
        return Ok(ConsistencyOutcome {
            status: "pending",
            consistency_policy,
            covered_mutation_ids: Vec::new(),
            message: None,
        });
    }
    if network == "not-attempted" {
        return Ok(ConsistencyOutcome {
            status: "pending",
            consistency_policy,
            covered_mutation_ids: Vec::new(),
            message: None,
        });
    }
    if network == "response-lost" {
        return Ok(ConsistencyOutcome {
            status: "ambiguous",
            consistency_policy,
            covered_mutation_ids: Vec::new(),
            message: Some("committed-but-response-lost"),
        });
    }
    if network == "rejected" {
        return Ok(ConsistencyOutcome {
            status: "rejected",
            consistency_policy,
            covered_mutation_ids: covered_mutation_ids.to_vec(),
            message: None,
        });
    }
    if network == "transformed" {
        return Ok(ConsistencyOutcome {
            status: "transformed",
            consistency_policy,
            covered_mutation_ids: covered_mutation_ids.to_vec(),
            message: None,
        });
    }
    Ok(ConsistencyOutcome {
        status: "confirmed",
        consistency_policy,
        covered_mutation_ids: covered_mutation_ids.to_vec(),
        message: None,
    })
}

fn compare_decimal(left: &str, right: &str) -> Ordering {
    fn normalize(value: &str) -> &str {
        if value == "0"
            || (!value.is_empty()
                && !value.starts_with('0')
                && value.bytes().all(|b| b.is_ascii_digit()))
        {
            value
        } else {
            "0"
        }
    }
    let a = normalize(left);
    let b = normalize(right);
    a.len().cmp(&b.len()).then_with(|| a.cmp(b))
}

fn record_key(table: &str, record_id: &str) -> String {
    format!("{table}\0{record_id}")
}

fn to_projected(row: &BaseRow, provenance: &str) -> ProjectedRow {
    ProjectedRow {
        table: row.table.clone(),
        record_id: row.record_id.clone(),
        revision: row.revision.clone(),
        operation: row.operation.clone(),
        payload: row.payload.clone(),
        provenance: provenance.to_string(),
    }
}

fn select_remote_winner(rows: &[BaseRow]) -> &BaseRow {
    rows.iter()
        .reduce(
            |winner, candidate| match compare_decimal(&candidate.revision, &winner.revision) {
                Ordering::Greater => candidate,
                Ordering::Less => winner,
                Ordering::Equal => {
                    let candidate_id = candidate
                        .identity
                        .as_ref()
                        .map(|identity| identity.mutation_id.as_str())
                        .unwrap_or("");
                    let winner_id = winner
                        .identity
                        .as_ref()
                        .map(|identity| identity.mutation_id.as_str())
                        .unwrap_or("");
                    if candidate_id < winner_id {
                        candidate
                    } else {
                        winner
                    }
                }
            },
        )
        .expect("remote group is non-empty")
}

pub fn reconcile_read_model(
    input: &ReadReconciliationInput,
) -> Result<Vec<ProjectedRow>, ConsistencyError> {
    let mut working: BTreeMap<String, ProjectedRow> = BTreeMap::new();
    for row in &input.local_base {
        working.insert(
            record_key(&row.table, &row.record_id),
            to_projected(row, "authoritative"),
        );
    }

    if !input.remote.is_empty() {
        let mut grouped: BTreeMap<String, Vec<&BaseRow>> = BTreeMap::new();
        for row in &input.remote {
            grouped
                .entry(record_key(&row.table, &row.record_id))
                .or_default()
                .push(row);
        }
        for (key, group) in grouped {
            let owned: Vec<BaseRow> = group.into_iter().cloned().collect();
            let remote = select_remote_winner(&owned);
            match working.get(&key) {
                None => {
                    working.insert(key, to_projected(remote, "authoritative"));
                }
                Some(local)
                    if compare_decimal(&remote.revision, &local.revision) == Ordering::Greater =>
                {
                    working.insert(key, to_projected(remote, "authoritative"));
                }
                Some(_) => {}
            }
        }
    }

    let acknowledged: HashSet<&str> = input
        .acknowledged_mutation_ids
        .iter()
        .map(String::as_str)
        .collect();
    for entry in &input.overlay {
        if acknowledged.contains(entry.mutation_id.as_str()) {
            continue;
        }
        let policy = canonicalize_consistency_policy(&entry.consistency_policy)?;
        if entry.status == "pending" && policy == ConsistencyPolicy::RemoteAcknowledged {
            continue;
        }
        let key = record_key(&entry.table, &entry.record_id);
        let payload = if entry.status == "transformed" {
            entry
                .transformed_payload
                .clone()
                .or_else(|| entry.payload.clone())
        } else {
            entry.payload.clone()
        };
        let revision = entry
            .revision
            .clone()
            .or_else(|| working.get(&key).map(|row| row.revision.clone()))
            .unwrap_or_else(|| "0".to_string());
        working.insert(
            key,
            ProjectedRow {
                table: entry.table.clone(),
                record_id: entry.record_id.clone(),
                revision,
                operation: entry.operation.clone(),
                payload,
                provenance: entry.status.clone(),
            },
        );
    }

    let mut records: Vec<_> = working.into_values().collect();
    records.sort_by(|left, right| {
        left.table
            .cmp(&right.table)
            .then_with(|| left.record_id.cmp(&right.record_id))
    });
    Ok(records)
}

pub const META_INTENT_POLICY_PREFIX: &str = "intent.policy.";

#[must_use]
pub fn intent_policy_meta_key(mutation_id: &str) -> String {
    format!("{META_INTENT_POLICY_PREFIX}{mutation_id}")
}
