use opto_sync_client::protocol::{
    MutationResult, ProtocolQueue, PullResponse, PushRequest, PushResponse, ResultStatus,
    SnapshotRecord, SnapshotResponse,
};
use opto_sync_client::protocol_scheduler::{
    ProtocolSchedulerEvent, ProtocolSchedulerPhase, ProtocolSchedulerResetPhase,
    ProtocolSyncScheduler,
};
use opto_sync_client::protocol_sync::{
    ProtocolQueuePersistence, ProtocolSyncCallbacks, ProtocolSyncDriver, ProtocolSyncError,
    ProtocolSyncOptions, ProtocolTransport, PullResult, ResetRequired, TransportFailure,
};
use serde_json::{json, Value};
use std::collections::{BTreeSet, VecDeque};
use std::convert::Infallible;
use std::fs;
use std::io::{self, Read};
use std::path::Path;

const ACTION_FIELD: &str = "mbt::actionTaken";
const REQUIRED_ACTIONS: &[&str] = &[
    "init",
    "idle",
    "start",
    "stop",
    "hint",
    "go_offline",
    "go_online",
    "timer_fire",
    "timer_join",
    "stale_timer_fire",
    "page_more",
    "begin_reset",
    "finish_reset",
    "cycle_success",
    "cycle_success_more",
    "cycle_retryable_failure",
    "cycle_permanent_failure",
    "malformed_response",
    "stale_cycle_success",
    "stale_cycle_failure",
];
const REQUIRED_SCENARIOS: &[&str] = &[
    "stop_during_cycle",
    "trailing_wake",
    "offline_during_cycle",
    "online_recovery",
    "retryable_failure",
    "permanent_failure",
    "reset_ordering",
    "malformed_response",
    "paging_rerun",
    "stale_cycle",
    "stale_timer",
];

fn invalid(message: impl Into<String>) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, message.into())
}

fn object<'a>(value: &'a Value, label: &str) -> io::Result<&'a serde_json::Map<String, Value>> {
    value
        .as_object()
        .ok_or_else(|| invalid(format!("{label} must be an object")))
}

fn field<'a>(value: &'a serde_json::Map<String, Value>, name: &str) -> io::Result<&'a Value> {
    value
        .get(name)
        .ok_or_else(|| invalid(format!("missing field {name}")))
}

fn tag(value: &Value, label: &str) -> io::Result<String> {
    let encoded = object(value, label)?;
    field(encoded, "tag")?
        .as_str()
        .map(str::to_owned)
        .ok_or_else(|| invalid(format!("{label} tag must be a string")))
}

fn model_projection(raw_state: &Value) -> io::Result<Value> {
    let raw = object(raw_state, "ITF state")?;
    let state = object(field(raw, "s")?, "ITF scheduler state")?;
    let phase = match tag(field(state, "phase")?, "phase")?.as_str() {
        "Stopped" => "stopped",
        "Idle" => "idle",
        "Syncing" => "syncing",
        "Offline" => "offline",
        "Backoff" => "backoff",
        "Error" => "error",
        other => return Err(invalid(format!("unknown phase tag {other}"))),
    };
    let reset_phase = match tag(field(state, "reset_phase")?, "reset phase")?.as_str() {
        "NoReset" => "none",
        "SnapshotRequested" => "requested",
        "SnapshotInstalled" => "installed",
        other => return Err(invalid(format!("unknown reset tag {other}"))),
    };
    let boolean = |name: &str| -> io::Result<bool> {
        field(state, name)?
            .as_bool()
            .ok_or_else(|| invalid(format!("{name} must be boolean")))
    };
    let integer = |name: &str| -> io::Result<i64> {
        let encoded = object(field(state, name)?, name)?;
        field(encoded, "#bigint")?
            .as_str()
            .ok_or_else(|| invalid(format!("{name} ITF bigint must be a decimal string")))?
            .parse::<i64>()
            .map_err(|error| invalid(format!("{name} has an invalid ITF bigint: {error}")))
    };
    Ok(json!({
        "phase": phase,
        "online": boolean("online")?,
        "timerPending": boolean("timer_pending")?,
        "cyclePending": boolean("cycle_pending")?,
        "networkActive": boolean("network_active")?,
        "wakePending": boolean("wake_pending")?,
        "consecutiveFailures": integer("consecutive_failures")?,
        "resetPhase": reset_phase,
        "pagesSeen": integer("pages_seen")?,
    }))
}

fn implementation_projection(scheduler: &ProtocolSyncScheduler) -> Value {
    let state = scheduler.state();
    let phase = match state.phase {
        ProtocolSchedulerPhase::Stopped => "stopped",
        ProtocolSchedulerPhase::Idle => "idle",
        ProtocolSchedulerPhase::Syncing => "syncing",
        ProtocolSchedulerPhase::Offline => "offline",
        ProtocolSchedulerPhase::Backoff => "backoff",
        ProtocolSchedulerPhase::Error => "error",
    };
    let reset_phase = match state.reset_phase {
        ProtocolSchedulerResetPhase::None => "none",
        ProtocolSchedulerResetPhase::SnapshotRequested => "requested",
        ProtocolSchedulerResetPhase::SnapshotInstalled => "installed",
    };
    json!({
        "phase": phase,
        "online": state.online,
        "timerPending": state.timer_pending,
        "cyclePending": state.cycle_pending,
        "networkActive": state.network_active,
        "wakePending": state.wake_pending,
        "consecutiveFailures": state.consecutive_failures,
        "resetPhase": reset_phase,
        "pagesSeen": state.pages_seen,
    })
}

#[derive(Clone, Copy)]
enum DriverScenario {
    Success,
    SuccessMore,
    Retryable,
    Permanent,
    Malformed,
    Paging,
    Reset,
}

struct DriverTransport {
    pulls: VecDeque<Result<PullResult, TransportFailure<&'static str>>>,
    snapshot: Option<SnapshotResponse>,
}

impl ProtocolTransport for DriverTransport {
    type Error = &'static str;

    fn push(
        &mut self,
        request: &PushRequest,
    ) -> Result<PushResponse, TransportFailure<Self::Error>> {
        let last = request
            .mutations
            .last()
            .expect("driver must not push an empty request");
        Ok(PushResponse {
            protocol_version: 1,
            client_id: request.client_id.clone(),
            last_mutation_id: last.mutation_id.clone(),
            checkpoint: "0".to_string(),
            results: request
                .mutations
                .iter()
                .map(|mutation| MutationResult {
                    mutation_id: mutation.mutation_id.clone(),
                    status: ResultStatus::Applied,
                    original_status: None,
                    checkpoint: None,
                    revision: Some("1".to_string()),
                    code: None,
                    message: None,
                })
                .collect(),
        })
    }

    fn pull(
        &mut self,
        _checkpoint: &str,
        _limit: usize,
    ) -> Result<PullResult, TransportFailure<Self::Error>> {
        self.pulls
            .pop_front()
            .expect("formal driver scenario exhausted its pull script")
    }

    fn snapshot(
        &mut self,
        _reset: &ResetRequired,
    ) -> Result<SnapshotResponse, TransportFailure<Self::Error>> {
        Ok(self.snapshot.take().expect("snapshot was not scripted"))
    }
}

struct NoopCallbacks;

impl ProtocolSyncCallbacks for NoopCallbacks {
    type Error = Infallible;

    fn apply_changes(
        &mut self,
        _changes: &[opto_sync_client::protocol::Change],
    ) -> Result<(), Self::Error> {
        Ok(())
    }

    fn replace_authoritative(&mut self, _records: &[SnapshotRecord]) -> Result<(), Self::Error> {
        Ok(())
    }
}

struct NoopPersistence;

impl ProtocolQueuePersistence for NoopPersistence {
    type Error = Infallible;

    fn persist(&mut self, _queue: &ProtocolQueue) -> Result<(), Self::Error> {
        Ok(())
    }
}

fn page(checkpoint: &str, has_more: bool) -> PullResult {
    PullResult::Changes(PullResponse {
        protocol_version: 1,
        checkpoint: checkpoint.to_string(),
        has_more,
        changes: Vec::new(),
    })
}

fn exercise_driver(scenario: DriverScenario) -> io::Result<()> {
    let (pulls, snapshot) = match scenario {
        DriverScenario::Success | DriverScenario::SuccessMore => (
            VecDeque::from([Ok(page("0", false)), Ok(page("0", false))]),
            None,
        ),
        DriverScenario::Retryable => (
            VecDeque::from([Err(TransportFailure::retryable("retry"))]),
            None,
        ),
        DriverScenario::Permanent => (
            VecDeque::from([Err(TransportFailure::permanent("stop"))]),
            None,
        ),
        DriverScenario::Malformed => (VecDeque::from([Ok(page("not-a-checkpoint", false))]), None),
        DriverScenario::Paging => (
            VecDeque::from([
                Ok(page("1", true)),
                Ok(page("1", false)),
                Ok(page("1", false)),
            ]),
            None,
        ),
        DriverScenario::Reset => (
            VecDeque::from([
                Ok(PullResult::ResetRequired(ResetRequired {
                    protocol_version: 1,
                    error: "RESET_REQUIRED".to_string(),
                    snapshot_url: None,
                })),
                Ok(page("10", false)),
                Ok(page("10", false)),
            ]),
            Some(SnapshotResponse {
                protocol_version: 1,
                checkpoint: "10".to_string(),
                records: vec![SnapshotRecord {
                    table: "docs".to_string(),
                    record_id: "snapshot".to_string(),
                    record: json!({"snapshot": true}),
                    revision: "1".to_string(),
                }],
            }),
        ),
    };
    let mut queue =
        ProtocolQueue::new("formal-rust").map_err(|error| invalid(error.to_string()))?;
    if matches!(scenario, DriverScenario::SuccessMore) {
        queue
            .queue_upsert("docs", "one", json!({"id": 1}), None, false)
            .map_err(|error| invalid(error.to_string()))?;
        queue
            .queue_upsert("docs", "two", json!({"id": 2}), None, false)
            .map_err(|error| invalid(error.to_string()))?;
    }
    let options = ProtocolSyncOptions {
        push_limit: 1,
        max_push_batches_per_cycle: 1,
        ..ProtocolSyncOptions::default()
    };
    let driver = ProtocolSyncDriver::new(options).map_err(|error| invalid(error.to_string()))?;
    let mut transport = DriverTransport { pulls, snapshot };
    let result = driver.sync_cycle(
        &mut queue,
        &mut transport,
        &mut NoopCallbacks,
        &mut NoopPersistence,
    );

    match scenario {
        DriverScenario::Success => {
            let result =
                result.map_err(|error| invalid(format!("success driver failed: {error}")))?;
            if result.has_more_pending {
                return Err(invalid("empty success unexpectedly retained pending work"));
            }
        }
        DriverScenario::SuccessMore => {
            let result =
                result.map_err(|error| invalid(format!("paging driver failed: {error}")))?;
            if !result.has_more_pending {
                return Err(invalid("bounded push did not report trailing pending work"));
            }
        }
        DriverScenario::Paging => {
            result.map_err(|error| invalid(format!("pull paging failed: {error}")))?;
        }
        DriverScenario::Reset => {
            let result =
                result.map_err(|error| invalid(format!("reset driver failed: {error}")))?;
            if result.installed_snapshots != 1 || result.checkpoint != "10" {
                return Err(invalid("reset ordering projection was not installed"));
            }
        }
        DriverScenario::Retryable => match result {
            Err(ProtocolSyncError::Transport(error)) if error.retryable => {}
            other => {
                return Err(invalid(format!(
                    "expected retryable driver failure, got {other:?}"
                )))
            }
        },
        DriverScenario::Permanent => match result {
            Err(ProtocolSyncError::Transport(error)) if !error.retryable => {}
            other => {
                return Err(invalid(format!(
                    "expected permanent driver failure, got {other:?}"
                )))
            }
        },
        DriverScenario::Malformed => match result {
            Err(ProtocolSyncError::InvalidResponse(_)) => {}
            other => {
                return Err(invalid(format!(
                    "expected malformed driver response, got {other:?}"
                )))
            }
        },
    }
    Ok(())
}

fn event_for(action: &str) -> io::Result<ProtocolSchedulerEvent> {
    Ok(match action {
        "idle" => ProtocolSchedulerEvent::Idle,
        "start" => ProtocolSchedulerEvent::Start,
        "stop" => ProtocolSchedulerEvent::Stop,
        "hint" => ProtocolSchedulerEvent::Hint,
        "go_offline" => ProtocolSchedulerEvent::GoOffline,
        "go_online" => ProtocolSchedulerEvent::GoOnline,
        "timer_fire" => ProtocolSchedulerEvent::TimerFire,
        "timer_join" => ProtocolSchedulerEvent::TimerJoin,
        "stale_timer_fire" => ProtocolSchedulerEvent::StaleTimerFire,
        "page_more" => ProtocolSchedulerEvent::PageMore,
        "begin_reset" => ProtocolSchedulerEvent::BeginReset,
        "finish_reset" => ProtocolSchedulerEvent::FinishReset,
        "cycle_success" => ProtocolSchedulerEvent::CycleSuccess,
        "cycle_success_more" => ProtocolSchedulerEvent::CycleSuccessMore,
        "cycle_retryable_failure" => ProtocolSchedulerEvent::CycleRetryableFailure,
        "cycle_permanent_failure" => ProtocolSchedulerEvent::CyclePermanentFailure,
        "malformed_response" => ProtocolSchedulerEvent::MalformedResponse,
        "stale_cycle_success" => ProtocolSchedulerEvent::StaleCycleSuccess,
        "stale_cycle_failure" => ProtocolSchedulerEvent::StaleCycleFailure,
        other => return Err(invalid(format!("unknown scheduler action {other}"))),
    })
}

fn exercise_outcome(action: &str, scheduler: &ProtocolSyncScheduler) -> io::Result<()> {
    let scenario = match action {
        "cycle_success_more" => Some(DriverScenario::SuccessMore),
        "cycle_retryable_failure" | "stale_cycle_failure" => Some(DriverScenario::Retryable),
        "cycle_permanent_failure" => Some(DriverScenario::Permanent),
        "malformed_response" => Some(DriverScenario::Malformed),
        "stale_cycle_success" => Some(DriverScenario::Success),
        "cycle_success"
            if scheduler.state().reset_phase == ProtocolSchedulerResetPhase::SnapshotInstalled =>
        {
            Some(DriverScenario::Reset)
        }
        "cycle_success" if scheduler.state().pages_seen > 0 => Some(DriverScenario::Paging),
        "cycle_success" => Some(DriverScenario::Success),
        _ => None,
    };
    if let Some(scenario) = scenario {
        exercise_driver(scenario)?;
    }
    Ok(())
}

fn record_scenario(action: &str, previous: &Value, scenarios: &mut BTreeSet<String>) {
    let cycle_pending = previous["cyclePending"].as_bool() == Some(true);
    match action {
        "stop" if cycle_pending => {
            scenarios.insert("stop_during_cycle".to_string());
        }
        "hint" | "timer_join" if cycle_pending => {
            scenarios.insert("trailing_wake".to_string());
        }
        "go_offline" if cycle_pending => {
            scenarios.insert("offline_during_cycle".to_string());
        }
        "go_online" => {
            scenarios.insert("online_recovery".to_string());
        }
        "cycle_retryable_failure" => {
            scenarios.insert("retryable_failure".to_string());
        }
        "cycle_permanent_failure" => {
            scenarios.insert("permanent_failure".to_string());
        }
        "finish_reset" => {
            scenarios.insert("reset_ordering".to_string());
        }
        "malformed_response" => {
            scenarios.insert("malformed_response".to_string());
        }
        "cycle_success_more" => {
            scenarios.insert("paging_rerun".to_string());
        }
        "stale_cycle_success" | "stale_cycle_failure" => {
            scenarios.insert("stale_cycle".to_string());
        }
        "stale_timer_fire" => {
            scenarios.insert("stale_timer".to_string());
        }
        _ => {}
    }
}

fn replay_trace(
    path: &str,
    coverage: &mut BTreeSet<String>,
    scenarios: &mut BTreeSet<String>,
) -> io::Result<Option<Value>> {
    let trace: Value = serde_json::from_str(&fs::read_to_string(path)?)?;
    let states = object(&trace, "ITF trace")?
        .get("states")
        .and_then(Value::as_array)
        .ok_or_else(|| invalid("ITF trace must contain states"))?;
    if states.is_empty() || states.len() > 100_000 {
        return Err(invalid("ITF scheduler trace has invalid length"));
    }
    let mut scheduler = ProtocolSyncScheduler::new();

    for (step, raw_state) in states.iter().enumerate() {
        let raw = object(raw_state, "ITF state")?;
        let action = field(raw, ACTION_FIELD)?
            .as_str()
            .ok_or_else(|| invalid("model action must be a string"))?;
        if !REQUIRED_ACTIONS.contains(&action) {
            return Err(invalid(format!("unknown model action {action}")));
        }
        coverage.insert(action.to_string());
        if step == 0 {
            if action != "init" {
                return Err(invalid("first scheduler state must be init"));
            }
        } else {
            let previous = model_projection(&states[step - 1])?;
            record_scenario(action, &previous, scenarios);
            exercise_outcome(action, &scheduler)?;
            scheduler
                .apply(event_for(action)?)
                .map_err(|error| invalid(error.to_string()))?;
        }
        let expected = model_projection(raw_state)?;
        let actual = implementation_projection(&scheduler);
        if expected != actual {
            return Ok(Some(json!({
                "trace": path,
                "step": step,
                "action": action,
                "message": "production Rust scheduler/driver projection does not refine Quint",
                "expected": expected,
                "actual": actual,
            })));
        }
    }
    Ok(None)
}

fn validate_request(value: &Value) -> io::Result<Vec<String>> {
    let request = object(value, "adapter request")?;
    if request.get("protocol").and_then(Value::as_str) != Some("fmctl.adapter.v1")
        || request.get("adapter").and_then(Value::as_str) != Some("rust")
        || request.get("project").and_then(Value::as_str) != Some("opto-sync-clients")
        || request.get("model").and_then(Value::as_str) != Some("protocol-sync-scheduler-v1")
    {
        return Err(invalid(
            "adapter request identity does not match Rust scheduler",
        ));
    }
    let specification = request
        .get("specification")
        .and_then(Value::as_str)
        .ok_or_else(|| invalid("missing specification"))?;
    if !Path::new(specification).is_file() {
        return Err(invalid("specification is not a file"));
    }
    let traces = request
        .get("traces")
        .and_then(Value::as_array)
        .ok_or_else(|| invalid("request must contain traces"))?;
    traces
        .iter()
        .map(|trace| {
            let path = trace
                .as_str()
                .ok_or_else(|| invalid("trace path must be a string"))?;
            if !Path::new(path).is_file() {
                return Err(invalid(format!("trace is not a file: {path}")));
            }
            Ok(path.to_string())
        })
        .collect()
}

fn replay_paths(mut paths: Vec<String>) -> Value {
    paths.sort();
    let mut coverage = BTreeSet::new();
    let mut scenarios = BTreeSet::new();
    let mut mismatches = Vec::new();
    let mut passed = 0_usize;
    for path in &paths {
        match replay_trace(path, &mut coverage, &mut scenarios) {
            Ok(None) => passed += 1,
            Ok(Some(mismatch)) => mismatches.push(mismatch),
            Err(error) => mismatches.push(json!({
                "trace": path,
                "step": null,
                "action": null,
                "message": error.to_string(),
                "expected": {},
                "actual": {},
            })),
        }
    }
    let missing = REQUIRED_ACTIONS
        .iter()
        .filter(|action| !coverage.contains(**action))
        .copied()
        .collect::<Vec<_>>();
    let missing_scenarios = REQUIRED_SCENARIOS
        .iter()
        .filter(|scenario| !scenarios.contains(**scenario))
        .copied()
        .collect::<Vec<_>>();
    if !missing.is_empty() || !missing_scenarios.is_empty() {
        mismatches.push(json!({
            "trace": paths.first(),
            "step": null,
            "action": null,
            "message": format!("scheduler corpus missing actions {missing:?} scenarios {missing_scenarios:?}"),
            "expected": {"actions": REQUIRED_ACTIONS, "scenarios": REQUIRED_SCENARIOS},
            "actual": {"actions": coverage, "scenarios": scenarios},
        }));
        if passed == paths.len() {
            passed = passed.saturating_sub(1);
        }
    }
    json!({
        "protocol": "fmctl.adapter.v1",
        "success": mismatches.is_empty(),
        "traces_total": paths.len(),
        "traces_passed": passed,
        "mismatches": mismatches,
        "implementation": {
            "language": "rust",
            "name": "opto-sync-client ProtocolSyncScheduler + ProtocolSyncDriver",
            "version": env!("CARGO_PKG_VERSION"),
        },
    })
}

fn main() -> io::Result<()> {
    let arguments = std::env::args().skip(1).collect::<Vec<_>>();
    let paths = if arguments.is_empty() {
        let mut input = String::new();
        io::stdin().read_to_string(&mut input)?;
        let request: Value = serde_json::from_str(&input)?;
        validate_request(&request)?
    } else {
        arguments
    };
    println!("{}", serde_json::to_string(&replay_paths(paths))?);
    Ok(())
}
