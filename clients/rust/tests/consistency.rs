use opto_sync_client::protocol::ProtocolQueue;
use opto_sync_client::{
    assert_queued_intent_frozen, canonicalize_consistency_policy, outcome_for_network,
    reconcile_read_model, ConsistencyError, ConsistencyPolicy, MutationIntent,
    ReadReconciliationInput, QUEUED_LOCAL_FIRST, REMOTE_ACKNOWLEDGED, WRITE_THROUGH_LOCAL_FIRST,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Vectors {
    policies: Vec<String>,
    aliases: BTreeMap<String, String>,
    unknown_policies: Vec<String>,
    freeze: Vec<FreezeCase>,
    read_models: Vec<ReadModelCase>,
    mode_outcomes: Vec<ModeOutcomeCase>,
}

#[derive(Deserialize)]
struct FreezeCase {
    existing: MutationIntent,
    proposed: MutationIntent,
    allowed: bool,
}

#[derive(Deserialize)]
struct ReadModelCase {
    id: String,
    input: ReadReconciliationInput,
    expect: ReadModelExpect,
}

#[derive(Deserialize)]
struct ReadModelExpect {
    records: Vec<Value>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ModeOutcomeCase {
    id: String,
    policy: String,
    network: String,
    #[serde(default)]
    covered_mutation_ids: Vec<String>,
    expect_status: String,
}

fn vectors() -> Vectors {
    let path =
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../formal/consistency_vectors.v1.json");
    let body = fs::read_to_string(path).expect("consistency vectors");
    serde_json::from_str(&body).expect("parse consistency vectors")
}

#[test]
fn canonical_policy_ids_are_stable_and_aliases_collapse() {
    let vectors = vectors();
    assert_eq!(
        vectors.policies,
        vec![
            REMOTE_ACKNOWLEDGED,
            WRITE_THROUGH_LOCAL_FIRST,
            QUEUED_LOCAL_FIRST
        ]
    );
    for (alias, expected) in vectors.aliases {
        assert_eq!(
            canonicalize_consistency_policy(&alias).unwrap().as_str(),
            expected
        );
    }
    for unknown in vectors.unknown_policies {
        assert!(matches!(
            canonicalize_consistency_policy(&unknown),
            Err(ConsistencyError::UnknownPolicy(_))
        ));
    }
}

#[test]
fn queued_mutation_intent_cannot_change_policy_or_content() {
    for fixture in vectors().freeze {
        let result = assert_queued_intent_frozen(&fixture.existing, &fixture.proposed);
        if fixture.allowed {
            result.expect("identical rebind must be allowed");
        } else {
            assert!(matches!(result, Err(ConsistencyError::FrozenIntent(_))));
        }
    }
}

#[test]
fn read_reconciliation_matches_shared_vectors() {
    for fixture in vectors().read_models {
        let actual = reconcile_read_model(&fixture.input).expect(&fixture.id);
        let actual_json = serde_json::to_value(&actual).expect("serialize projection");
        let expected = Value::Array(fixture.expect.records);
        assert_eq!(actual_json, expected, "{}", fixture.id);
    }
}

#[test]
fn each_mode_returns_the_documented_typed_outcome() {
    for fixture in vectors().mode_outcomes {
        let actual = outcome_for_network(
            &fixture.policy,
            &fixture.network,
            &fixture.covered_mutation_ids,
        )
        .expect(&fixture.id);
        assert_eq!(actual.status, fixture.expect_status, "{}", fixture.id);
        assert_eq!(actual.consistency_policy.as_str(), fixture.policy);
    }
}

#[test]
fn protocol_queue_serializes_canonical_policy_and_freezes_it() {
    let mut queue = ProtocolQueue::new("client-a").unwrap();
    let id = queue
        .queue_upsert_with_consistency(
            "docs",
            "r1",
            json!({"title": "queued"}),
            None,
            false,
            ConsistencyPolicy::QueuedLocalFirst,
        )
        .unwrap();
    assert_eq!(queue.consistency_policy(&id), Some(QUEUED_LOCAL_FIRST));
    let proposed = MutationIntent {
        client_id: "client-a".into(),
        mutation_id: id.clone(),
        table: "docs".into(),
        record_id: "r1".into(),
        operation: "upsert".into(),
        payload: Some(json!({"title": "queued"})),
        base_revision: None,
        resurrect: false,
        consistency_policy: REMOTE_ACKNOWLEDGED.into(),
    };
    assert!(matches!(
        queue.rebind_consistency(&id, &proposed),
        Err(ConsistencyError::FrozenIntent(_))
    ));
}
