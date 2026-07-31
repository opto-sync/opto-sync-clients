//! Replay Quint's Informal Trace Format (ITF) model-based traces against the
//! production Rust [`ProtocolQueue`] state machine.
//!
//! This adapter deliberately compares only observable client state. Server-only
//! model fields (ledger, effect count, retention floor) are used to synthesize
//! protocol responses, while queue allocation, request construction,
//! acknowledgement rejection/acceptance, checkpoint installation, and reset
//! durability execute through the real library API.

use opto_sync_client::protocol::{
    LocalProtocolStatus, MutationResult, ProtocolError, ProtocolQueue, PushRequest, PushResponse,
    ResultStatus, SnapshotResponse,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::BTreeSet;
use std::error::Error;
use std::fmt::Display;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

const CLIENT_ID: &str = "formal-client";

type AnyResult<T> = Result<T, Box<dyn Error>>;

#[derive(Debug, Deserialize)]
struct ItfTrace {
    states: Vec<ItfState>,
}

#[derive(Debug, Deserialize)]
struct ItfState {
    #[serde(rename = "mbt::actionTaken")]
    action: String,
    #[serde(rename = "mbt::nondetPicks", default)]
    nondet_picks: Value,
    s: Value,
}

struct Adapter {
    queue: ProtocolQueue,
    request: Option<PushRequest>,
    response: Option<PushResponse>,
    response_valid: bool,
    replacing_snapshot: bool,
}

impl Adapter {
    fn new() -> AnyResult<Self> {
        Ok(Self {
            queue: ProtocolQueue::new(CLIENT_ID)?,
            request: None,
            response: None,
            response_valid: false,
            replacing_snapshot: false,
        })
    }
}

fn invalid(message: impl Into<String>) -> Box<dyn Error> {
    Box::new(io::Error::new(io::ErrorKind::InvalidData, message.into()))
}

fn ensure(condition: bool, message: impl Into<String>) -> AnyResult<()> {
    if condition {
        Ok(())
    } else {
        Err(invalid(message))
    }
}

fn field<'a>(value: &'a Value, name: &str) -> AnyResult<&'a Value> {
    value
        .get(name)
        .ok_or_else(|| invalid(format!("missing ITF field `{name}`")))
}

fn tagged_bigint(value: &Value) -> AnyResult<u64> {
    field(value, "#bigint")?
        .as_str()
        .ok_or_else(|| invalid("ITF #bigint must contain a decimal string"))?
        .parse::<u64>()
        .map_err(|error| invalid(format!("invalid ITF #bigint: {error}")))
}

fn state_u64(state: &ItfState, name: &str) -> AnyResult<u64> {
    tagged_bigint(field(&state.s, name)?)
}

fn state_bool(state: &ItfState, name: &str) -> AnyResult<bool> {
    field(&state.s, name)?
        .as_bool()
        .ok_or_else(|| invalid(format!("ITF state field `{name}` must be boolean")))
}

fn state_set(state: &ItfState, name: &str) -> AnyResult<BTreeSet<u64>> {
    let entries = field(field(&state.s, name)?, "#set")?
        .as_array()
        .ok_or_else(|| invalid(format!("ITF state field `{name}` must be a set")))?;
    entries.iter().map(tagged_bigint).collect()
}

fn state_tag<'a>(state: &'a ItfState, name: &str) -> AnyResult<&'a str> {
    field(field(&state.s, name)?, "tag")?
        .as_str()
        .ok_or_else(|| invalid(format!("ITF state field `{name}` must be tagged")))
}

fn picked_id(state: &ItfState) -> AnyResult<u64> {
    let pick = field(&state.nondet_picks, "id")?;
    ensure(
        field(pick, "tag")?.as_str() == Some("Some"),
        format!("action `{}` requires a nondeterministic id", state.action),
    )?;
    tagged_bigint(field(pick, "value")?)
}

fn response_from_state(
    state: &ItfState,
    status: ResultStatus,
    original_status: Option<ResultStatus>,
) -> AnyResult<PushResponse> {
    let mutation_id = state_u64(state, "response_mutation_id")?.to_string();
    let checkpoint = state_u64(state, "response_checkpoint")?.to_string();
    let has_applied_effect =
        status == ResultStatus::Applied || original_status == Some(ResultStatus::Applied);

    Ok(PushResponse {
        protocol_version: 1,
        client_id: CLIENT_ID.to_string(),
        last_mutation_id: state_u64(state, "response_watermark")?.to_string(),
        checkpoint: checkpoint.clone(),
        results: vec![MutationResult {
            mutation_id: mutation_id.clone(),
            status,
            original_status,
            checkpoint: Some(checkpoint),
            revision: has_applied_effect.then_some(mutation_id),
            code: None,
            message: None,
        }],
    })
}

fn request_mutation_id(request: &PushRequest) -> AnyResult<u64> {
    ensure(
        request.mutations.len() == 1,
        "formal adapter sends exactly one mutation per request",
    )?;
    request.mutations[0]
        .mutation_id
        .parse::<u64>()
        .map_err(|error| invalid(format!("invalid request mutation id: {error}")))
}

fn apply_action(adapter: &mut Adapter, state: &ItfState) -> AnyResult<()> {
    match state.action.as_str() {
        "init" => {
            *adapter = Adapter::new()?;
        }
        "idle" | "compact" => {}
        "enqueue" => {
            let expected_id = state_u64(state, "next_id")?
                .checked_sub(1)
                .ok_or_else(|| invalid("enqueue produced an invalid next_id"))?;
            let actual_id = adapter.queue.queue_upsert(
                "docs",
                format!("record-{expected_id}"),
                json!({"id": format!("record-{expected_id}"), "value": expected_id}),
                None,
                false,
            )?;
            ensure(
                actual_id == expected_id.to_string(),
                format!("enqueue allocated {actual_id}, model allocated {expected_id}"),
            )?;
        }
        "send" => {
            ensure(adapter.request.is_none(), "request already in flight")?;
            ensure(adapter.response.is_none(), "response already present")?;
            let expected_id = picked_id(state)?;
            let request = adapter.queue.push_request(1)?;
            ensure(
                request_mutation_id(&request)? == expected_id,
                format!("sent mutation does not match model id {expected_id}"),
            )?;
            adapter.request = Some(request);
        }
        "apply_new" => {
            ensure(adapter.response.is_none(), "response already present")?;
            ensure(
                request_mutation_id(
                    adapter
                        .request
                        .as_ref()
                        .ok_or_else(|| invalid("apply_new without an in-flight request"))?,
                )? == picked_id(state)?,
                "apply_new id does not match the in-flight request",
            )?;
            adapter.response = Some(response_from_state(state, ResultStatus::Applied, None)?);
            adapter.response_valid = true;
        }
        "reject_new" => {
            ensure(adapter.response.is_none(), "response already present")?;
            ensure(
                request_mutation_id(
                    adapter
                        .request
                        .as_ref()
                        .ok_or_else(|| invalid("reject_new without an in-flight request"))?,
                )? == picked_id(state)?,
                "reject_new id does not match the in-flight request",
            )?;
            adapter.response = Some(response_from_state(state, ResultStatus::Rejected, None)?);
            adapter.response_valid = true;
        }
        "reply_duplicate" => {
            ensure(adapter.response.is_none(), "response already present")?;
            let id = picked_id(state)?;
            ensure(
                request_mutation_id(
                    adapter
                        .request
                        .as_ref()
                        .ok_or_else(|| invalid("duplicate reply without an in-flight request"))?,
                )? == id,
                "duplicate reply id does not match the in-flight request",
            )?;
            let original_status = if state_set(state, "applied")?.contains(&id) {
                ResultStatus::Applied
            } else if state_set(state, "rejected")?.contains(&id) {
                ResultStatus::Rejected
            } else {
                return Err(invalid("duplicate reply has no durable original outcome"));
            };
            adapter.response = Some(response_from_state(
                state,
                ResultStatus::Duplicate,
                Some(original_status),
            )?);
            adapter.response_valid = true;
        }
        "inject_mismatched_response" => {
            ensure(adapter.response.is_none(), "response already present")?;
            let response = response_from_state(state, ResultStatus::Applied, None)?;
            let request = adapter
                .request
                .as_ref()
                .ok_or_else(|| invalid("mismatched response without an in-flight request"))?;
            let before = serde_json::to_value(&adapter.queue)?;
            let error = adapter
                .queue
                .acknowledge(&response, request)
                .expect_err("the model-injected response must be rejected");
            ensure(
                error == ProtocolError::InvalidAcknowledgement,
                format!("malformed response returned unexpected error: {error}"),
            )?;
            ensure(
                serde_json::to_value(&adapter.queue)? == before,
                "rejecting a malformed response mutated the queue",
            )?;
            adapter.response = Some(response);
            adapter.response_valid = false;
        }
        "lose_committed_response" | "lose_uncommitted_request" => {
            adapter.request = None;
            adapter.response = None;
            adapter.response_valid = false;
        }
        "discard_malformed_response" => {
            ensure(
                adapter.response.is_some() && !adapter.response_valid,
                "discard_malformed_response requires a rejected response",
            )?;
            adapter.request = None;
            adapter.response = None;
            adapter.response_valid = false;
        }
        "acknowledge" => {
            ensure(
                adapter.response_valid,
                "cannot acknowledge an invalid response",
            )?;
            let response = adapter
                .response
                .as_ref()
                .ok_or_else(|| invalid("acknowledge without a response"))?;
            let request = adapter
                .request
                .as_ref()
                .ok_or_else(|| invalid("acknowledge without an in-flight request"))?;
            ensure(
                request_mutation_id(request)? == picked_id(state)?,
                "acknowledgement id does not match the in-flight request",
            )?;
            let changed = adapter.queue.acknowledge(response, request)?;
            ensure(
                changed == 1,
                format!("acknowledgement changed {changed} rows"),
            )?;
            adapter.request = None;
            adapter.response = None;
            adapter.response_valid = false;
        }
        "pull" => {
            adapter
                .queue
                .set_checkpoint(state_u64(state, "local_checkpoint")?.to_string())?;
        }
        "begin_reset" => {
            ensure(
                !adapter.replacing_snapshot,
                "snapshot replacement already active",
            )?;
            adapter.replacing_snapshot = true;
        }
        "crash_during_reset" => {
            ensure(
                adapter.replacing_snapshot,
                "crash_during_reset without an active replacement",
            )?;
            adapter.replacing_snapshot = false;
        }
        "finish_reset" => {
            ensure(
                adapter.replacing_snapshot,
                "finish_reset without an active replacement",
            )?;
            let snapshot = SnapshotResponse {
                protocol_version: 1,
                checkpoint: state_u64(state, "server_checkpoint")?.to_string(),
                records: Vec::new(),
            };
            adapter
                .queue
                .install_snapshot(&snapshot, |_| Ok::<(), &'static str>(()))?;
            adapter.replacing_snapshot = false;
        }
        action => return Err(invalid(format!("unsupported model action `{action}`"))),
    }
    Ok(())
}

fn parse_mutation_id(value: impl Display) -> AnyResult<u64> {
    value
        .to_string()
        .parse::<u64>()
        .map_err(|error| invalid(format!("invalid queue mutation id: {error}")))
}

fn assert_projection(adapter: &Adapter, state: &ItfState, context: &str) -> AnyResult<()> {
    adapter.queue.validate()?;

    let queue_json = serde_json::to_value(&adapter.queue)?;
    let actual_next_id = field(&queue_json, "nextMutationId")?
        .as_u64()
        .ok_or_else(|| invalid("serialized nextMutationId must be an unsigned integer"))?;
    let expected_next_id = state_u64(state, "next_id")?;
    ensure(
        actual_next_id == expected_next_id,
        format!("{context}: next id {actual_next_id} != model {expected_next_id}"),
    )?;

    let expected_checkpoint = state_u64(state, "local_checkpoint")?.to_string();
    ensure(
        adapter.queue.checkpoint() == expected_checkpoint,
        format!(
            "{context}: checkpoint {} != model {expected_checkpoint}",
            adapter.queue.checkpoint()
        ),
    )?;

    let actual_pending = adapter
        .queue
        .pending()
        .map(|mutation| parse_mutation_id(&mutation.mutation_id))
        .collect::<AnyResult<BTreeSet<_>>>()?;
    let actual_confirmed = adapter
        .queue
        .all()
        .iter()
        .filter(|mutation| mutation.status == LocalProtocolStatus::Confirmed)
        .map(|mutation| parse_mutation_id(&mutation.mutation_id))
        .collect::<AnyResult<BTreeSet<_>>>()?;
    let expected_pending = state_set(state, "pending")?;
    let expected_confirmed = state_set(state, "acknowledged")?;
    ensure(
        actual_pending == expected_pending,
        format!("{context}: pending {actual_pending:?} != model {expected_pending:?}"),
    )?;
    ensure(
        actual_confirmed == expected_confirmed,
        format!("{context}: confirmed {actual_confirmed:?} != model {expected_confirmed:?}"),
    )?;

    let actual_all = adapter
        .queue
        .all()
        .iter()
        .map(|mutation| parse_mutation_id(&mutation.mutation_id))
        .collect::<AnyResult<BTreeSet<_>>>()?;
    let expected_all = (1..expected_next_id).collect::<BTreeSet<_>>();
    ensure(
        actual_all == expected_all,
        format!("{context}: allocated ids {actual_all:?} != model {expected_all:?}"),
    )?;

    let in_flight = state_u64(state, "in_flight")?;
    match (&adapter.request, in_flight) {
        (None, 0) => {}
        (Some(request), id) if id > 0 => ensure(
            request_mutation_id(request)? == id,
            format!("{context}: in-flight request does not contain model id {id}"),
        )?,
        (None, id) => {
            return Err(invalid(format!(
                "{context}: model has in-flight id {id}, adapter has no request"
            )))
        }
        (Some(_), 0) => {
            return Err(invalid(format!(
                "{context}: adapter has a request, model has no in-flight id"
            )))
        }
        (Some(_), _) => unreachable!("covered positive in-flight id"),
    }

    let response_present = state_bool(state, "response_present")?;
    ensure(
        adapter.response.is_some() == response_present,
        format!("{context}: response presence differs from model"),
    )?;
    if let Some(response) = &adapter.response {
        let result = response
            .results
            .first()
            .ok_or_else(|| invalid("adapter response has no mutation result"))?;
        ensure(
            response.last_mutation_id == state_u64(state, "response_watermark")?.to_string(),
            format!("{context}: response watermark differs from model"),
        )?;
        ensure(
            response.checkpoint == state_u64(state, "response_checkpoint")?.to_string(),
            format!("{context}: response checkpoint differs from model"),
        )?;
        ensure(
            result.mutation_id == state_u64(state, "response_mutation_id")?.to_string(),
            format!("{context}: response mutation id differs from model"),
        )?;
        ensure(
            adapter.response_valid == state_bool(state, "response_valid_for_in_flight")?,
            format!("{context}: response validity differs from model"),
        )?;
    } else {
        ensure(
            !adapter.response_valid,
            format!("{context}: absent response cannot be marked valid"),
        )?;
    }

    let replacing = state_tag(state, "reset_phase")? == "Replacing";
    ensure(
        adapter.replacing_snapshot == replacing,
        format!("{context}: reset phase differs from model"),
    )?;

    Ok(())
}

fn replay(path: &Path) -> AnyResult<usize> {
    let bytes = fs::read(path)?;
    let trace: ItfTrace = serde_json::from_slice(&bytes)?;
    ensure(!trace.states.is_empty(), "ITF trace has no states")?;

    let mut adapter = Adapter::new()?;
    for (index, state) in trace.states.iter().enumerate() {
        let context = format!("{} state {index} action {}", path.display(), state.action);
        apply_action(&mut adapter, state)
            .map_err(|error| invalid(format!("{context}: {error}")))?;
        assert_projection(&adapter, state, &context)?;
    }
    Ok(trace.states.len())
}

fn main() -> AnyResult<()> {
    let mut paths = std::env::args_os()
        .skip(1)
        .map(PathBuf::from)
        .collect::<Vec<_>>();
    ensure(
        !paths.is_empty(),
        "usage: cargo run --example quint_itf_replay -- <trace.itf.json>...",
    )?;
    paths.sort();

    let mut states = 0usize;
    for path in &paths {
        let count = replay(path)?;
        states += count;
        println!("replayed {count} model states from {}", path.display());
    }
    println!(
        "Rust ProtocolQueue conformed to {states} states across {} Quint ITF traces",
        paths.len()
    );
    Ok(())
}
