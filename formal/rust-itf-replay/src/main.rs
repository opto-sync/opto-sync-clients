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
    ResultStatus, SnapshotInstallError, SnapshotResponse,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};
use std::error::Error;
use std::fmt::Display;
use std::fs;
use std::io::{self, Read};
use std::path::{Path, PathBuf};

const CLIENT_ID: &str = "formal-client";
const REQUIRED_ACTIONS: &[&str] = &[
    "init",
    "idle",
    "compact",
    "enqueue",
    "send",
    "apply_new",
    "reject_new",
    "reply_duplicate",
    "inject_mismatched_response",
    "lose_committed_response",
    "lose_uncommitted_request",
    "discard_malformed_response",
    "acknowledge",
    "pull",
    "begin_reset",
    "crash_during_reset",
    "finish_reset",
];

type AnyResult<T> = Result<T, Box<dyn Error>>;

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ReplayRequest {
    protocol: String,
    project: String,
    model: String,
    adapter: String,
    specification: PathBuf,
    traces: Vec<PathBuf>,
}

#[derive(Debug, Serialize)]
struct ReplayResponse {
    protocol: &'static str,
    success: bool,
    traces_total: u64,
    traces_passed: u64,
    mismatches: Vec<ReplayMismatch>,
    implementation: Implementation,
}

#[derive(Debug, Serialize)]
struct ReplayMismatch {
    trace: PathBuf,
    step: Option<u64>,
    action: Option<String>,
    message: String,
    expected: Value,
    actual: Value,
}

#[derive(Debug, Serialize)]
struct Implementation {
    language: &'static str,
    name: &'static str,
    version: &'static str,
}

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
    sent_requests: BTreeMap<u64, PushRequest>,
    response: Option<PushResponse>,
    response_valid: bool,
    replacing_snapshot: bool,
}

impl Adapter {
    fn new() -> AnyResult<Self> {
        Ok(Self {
            queue: ProtocolQueue::new(CLIENT_ID)?,
            request: None,
            sent_requests: BTreeMap::new(),
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
            if let Some(previous) = adapter.sent_requests.get(&expected_id) {
                ensure(
                    previous == &request,
                    format!("retry for mutation {expected_id} changed its immutable request"),
                )?;
            } else {
                adapter.sent_requests.insert(expected_id, request.clone());
            }
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
            let before = adapter.queue.clone();
            let error = adapter
                .queue
                .acknowledge(&response, request)
                .expect_err("the model-injected response must be rejected");
            ensure(
                error == ProtocolError::InvalidAcknowledgement,
                format!("malformed response returned unexpected error: {error}"),
            )?;
            ensure(
                adapter.queue == before,
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
            let snapshot = SnapshotResponse {
                protocol_version: 1,
                checkpoint: state_u64(state, "server_checkpoint")?.to_string(),
                records: Vec::new(),
            };
            let before = adapter.queue.clone();
            let error = adapter
                .queue
                .install_snapshot(&snapshot, |_| {
                    Err::<(), _>("simulated snapshot replacement crash")
                })
                .expect_err("the simulated snapshot replacement must fail");
            ensure(
                matches!(
                    error,
                    SnapshotInstallError::Replace("simulated snapshot replacement crash")
                ),
                format!("snapshot replacement returned unexpected error: {error}"),
            )?;
            ensure(
                adapter.queue == before,
                "failed snapshot replacement mutated the protocol queue",
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
            let mut replacement_called = false;
            adapter.queue.install_snapshot(&snapshot, |_| {
                replacement_called = true;
                Ok::<(), &'static str>(())
            })?;
            ensure(
                replacement_called,
                "successful snapshot installation skipped authoritative replacement",
            )?;
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

struct ReplaySummary {
    states: usize,
    actions: BTreeSet<String>,
}

fn replay(path: &Path) -> AnyResult<ReplaySummary> {
    let bytes = fs::read(path)?;
    let trace: ItfTrace = serde_json::from_slice(&bytes)?;
    ensure(!trace.states.is_empty(), "ITF trace has no states")?;
    ensure(
        trace
            .states
            .first()
            .is_some_and(|state| state.action == "init"),
        "ITF trace must begin with the model init action",
    )?;

    let mut adapter = Adapter::new()?;
    let mut actions = BTreeSet::new();
    for (index, state) in trace.states.iter().enumerate() {
        actions.insert(state.action.clone());
        let context = format!("{} state {index} action {}", path.display(), state.action);
        apply_action(&mut adapter, state)
            .map_err(|error| invalid(format!("{context}: {error}")))?;
        assert_projection(&adapter, state, &context)?;
    }
    Ok(ReplaySummary {
        states: trace.states.len(),
        actions,
    })
}

fn replay_paths(paths: &[PathBuf], protocol_mode: bool) -> AnyResult<ReplayResponse> {
    ensure(
        !paths.is_empty(),
        "usage: cargo run --manifest-path formal/rust-itf-replay/Cargo.toml -- \
         <trace.itf.json>...",
    )?;

    let mut states = 0usize;
    let mut actions = BTreeSet::new();
    let mut passed = 0u64;
    let mut mismatches = Vec::new();
    for path in paths {
        match replay(path) {
            Ok(summary) => {
                states += summary.states;
                actions.extend(summary.actions);
                passed += 1;
                if protocol_mode {
                    eprintln!(
                        "replayed {} model states from {}",
                        summary.states,
                        path.display()
                    );
                } else {
                    println!(
                        "replayed {} model states from {}",
                        summary.states,
                        path.display()
                    );
                }
            }
            Err(error) if protocol_mode => mismatches.push(ReplayMismatch {
                trace: path.clone(),
                step: None,
                action: None,
                message: error.to_string(),
                expected: Value::Null,
                actual: Value::Null,
            }),
            Err(error) => return Err(error),
        }
    }
    let missing = REQUIRED_ACTIONS
        .iter()
        .copied()
        .filter(|action| !actions.contains(*action))
        .collect::<Vec<_>>();
    if !missing.is_empty() {
        let message = format!(
            "trace suite left production adapter branches untested: {}",
            missing.join(", ")
        );
        if protocol_mode {
            passed = passed.saturating_sub(1);
            mismatches.push(ReplayMismatch {
                trace: paths[0].clone(),
                step: None,
                action: missing.first().map(|action| (*action).to_owned()),
                message,
                expected: json!(REQUIRED_ACTIONS),
                actual: json!(actions),
            });
        } else {
            return Err(invalid(message));
        }
    }
    if !protocol_mode {
        println!(
            "Rust ProtocolQueue conformed to {states} states across {} Quint ITF traces \
             covering all {} model actions",
            paths.len(),
            REQUIRED_ACTIONS.len()
        );
    }
    let total = u64::try_from(paths.len()).map_err(|_| invalid("too many trace paths"))?;
    Ok(ReplayResponse {
        protocol: "fmctl.adapter.v1",
        success: mismatches.is_empty() && passed == total,
        traces_total: total,
        traces_passed: passed,
        mismatches,
        implementation: Implementation {
            language: "rust",
            name: "opto-sync ProtocolQueue",
            version: env!("CARGO_PKG_VERSION"),
        },
    })
}

fn run_protocol() -> AnyResult<()> {
    let mut input = String::new();
    io::stdin().read_to_string(&mut input)?;
    let request: ReplayRequest = serde_json::from_str(&input)?;
    ensure(
        request.protocol == "fmctl.adapter.v1",
        format!("unsupported adapter protocol {:?}", request.protocol),
    )?;
    ensure(
        request.adapter == "rust",
        "request selected a non-Rust adapter",
    )?;
    ensure(
        !request.project.trim().is_empty(),
        "request project is empty",
    )?;
    ensure(!request.model.trim().is_empty(), "request model is empty")?;
    ensure(
        request.specification.is_file(),
        format!(
            "request specification is not a file: {}",
            request.specification.display()
        ),
    )?;
    ensure(!request.traces.is_empty(), "request contains no traces")?;
    let response = replay_paths(&request.traces, true)?;
    serde_json::to_writer(io::stdout().lock(), &response)?;
    Ok(())
}

fn main() -> AnyResult<()> {
    let mut paths = std::env::args_os()
        .skip(1)
        .map(PathBuf::from)
        .collect::<Vec<_>>();
    if paths.is_empty() {
        run_protocol()
    } else {
        paths.sort();
        replay_paths(&paths, false)?;
        Ok(())
    }
}
