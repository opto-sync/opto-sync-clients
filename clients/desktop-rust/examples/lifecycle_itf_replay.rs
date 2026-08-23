//! Replay Quint lifecycle traces through the production Rust state machine.

use std::collections::BTreeSet;
use std::error::Error;
use std::fs;
use std::io::{self, Read};
use std::path::{Path, PathBuf};

use opto_sync_desktop::{
    SyncLifecycleEvent, SyncLifecycleMachine, SyncLifecyclePhase, SyncLifecycleSnapshot,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

type AnyResult<T> = Result<T, Box<dyn Error>>;

const MAX_TRACE_BYTES: u64 = 1_048_576;
const MAX_TRACE_STATES: usize = 100_000;
const REQUIRED_ACTIONS: [&str; 12] = [
    "init",
    "idle",
    "wake",
    "join",
    "begin_acquire",
    "acquire_granted",
    "acquire_deferred",
    "cancel",
    "cycle_settled",
    "release_settled",
    "request_close",
    "process_abort",
];
const REQUIRED_SCENARIOS: [&str; 7] = [
    "close_during_acquire",
    "close_while_running",
    "wake_while_running",
    "grant_after_close",
    "defer_after_close",
    "release_after_close",
    "process_abort_with_permit",
];

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

#[derive(Debug, Deserialize)]
struct ItfTrace {
    states: Vec<ItfState>,
}

#[derive(Debug, Deserialize)]
struct ItfState {
    #[serde(rename = "mbt::actionTaken")]
    action: String,
    s: Value,
}

#[derive(Debug, Serialize)]
struct ReplayResponse {
    protocol: &'static str,
    success: bool,
    traces_total: u64,
    traces_passed: u64,
    mismatches: Vec<Mismatch>,
    implementation: Implementation,
}

#[derive(Debug, Serialize)]
struct Mismatch {
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

fn model_projection(state: &ItfState) -> AnyResult<Value> {
    let phase = field(field(&state.s, "phase")?, "tag")?
        .as_str()
        .ok_or_else(|| invalid("ITF phase tag must be a string"))?;
    let phase = match phase {
        "Idle" => "idle",
        "Acquiring" => "acquiring",
        "Running" => "running",
        "Releasing" => "releasing",
        "Closed" => "closed",
        other => return Err(invalid(format!("unknown lifecycle phase `{other}`"))),
    };
    let boolean = |name: &str| -> AnyResult<bool> {
        field(&state.s, name)?
            .as_bool()
            .ok_or_else(|| invalid(format!("ITF field `{name}` must be boolean")))
    };
    Ok(json!({
        "phase": phase,
        "wakePending": boolean("wake_pending")?,
        "closeRequested": boolean("close_requested")?,
        "cancelRequested": boolean("cancel_requested")?,
        "permitHeld": boolean("permit_held")?,
    }))
}

fn implementation_projection(state: SyncLifecycleSnapshot) -> Value {
    let phase = match state.phase {
        SyncLifecyclePhase::Idle => "idle",
        SyncLifecyclePhase::Acquiring => "acquiring",
        SyncLifecyclePhase::Running => "running",
        SyncLifecyclePhase::Releasing => "releasing",
        SyncLifecyclePhase::Closed => "closed",
    };
    json!({
        "phase": phase,
        "wakePending": state.wake_pending,
        "closeRequested": state.close_requested,
        "cancelRequested": state.cancel_requested,
        "permitHeld": state.permit_held,
    })
}

fn event_for(action: &str) -> Option<SyncLifecycleEvent> {
    match action {
        "wake" => Some(SyncLifecycleEvent::Wake),
        "join" => Some(SyncLifecycleEvent::Join),
        "begin_acquire" => Some(SyncLifecycleEvent::BeginAcquire),
        "acquire_granted" => Some(SyncLifecycleEvent::AcquireGranted),
        "acquire_deferred" => Some(SyncLifecycleEvent::AcquireDeferred),
        "cancel" => Some(SyncLifecycleEvent::Cancel),
        "cycle_settled" => Some(SyncLifecycleEvent::CycleSettled),
        "release_settled" => Some(SyncLifecycleEvent::ReleaseSettled),
        "request_close" => Some(SyncLifecycleEvent::Close),
        "process_abort" => Some(SyncLifecycleEvent::ProcessAbort),
        _ => None,
    }
}

fn record_scenario(
    action: &str,
    previous: SyncLifecycleSnapshot,
    scenarios: &mut BTreeSet<String>,
) {
    let scenario = match (action, previous.phase) {
        ("request_close", SyncLifecyclePhase::Acquiring) => Some("close_during_acquire"),
        ("request_close", SyncLifecyclePhase::Running) => Some("close_while_running"),
        ("wake", SyncLifecyclePhase::Running) => Some("wake_while_running"),
        ("acquire_granted", _) if previous.close_requested => Some("grant_after_close"),
        ("acquire_deferred", _) if previous.close_requested => Some("defer_after_close"),
        ("release_settled", _) if previous.close_requested => Some("release_after_close"),
        ("process_abort", _) if previous.permit_held => Some("process_abort_with_permit"),
        _ => None,
    };
    if let Some(scenario) = scenario {
        scenarios.insert(scenario.to_owned());
    }
}

fn read_trace(path: &Path) -> AnyResult<ItfTrace> {
    let metadata = fs::metadata(path)?;
    ensure(
        metadata.is_file(),
        format!("trace is not a file: {}", path.display()),
    )?;
    ensure(
        metadata.len() <= MAX_TRACE_BYTES,
        format!("trace exceeds {MAX_TRACE_BYTES} bytes: {}", path.display()),
    )?;
    let bytes = fs::read(path)?;
    ensure(
        u64::try_from(bytes.len()).unwrap_or(u64::MAX) <= MAX_TRACE_BYTES,
        format!(
            "trace grew beyond {MAX_TRACE_BYTES} bytes: {}",
            path.display()
        ),
    )?;
    Ok(serde_json::from_slice(&bytes)?)
}

fn replay_trace(
    path: &Path,
    coverage: &mut BTreeSet<String>,
    scenarios: &mut BTreeSet<String>,
) -> AnyResult<Option<Mismatch>> {
    let trace = read_trace(path)?;
    ensure(!trace.states.is_empty(), "ITF trace contains no states")?;
    ensure(
        trace.states.len() <= MAX_TRACE_STATES,
        format!("ITF trace exceeds {MAX_TRACE_STATES} states"),
    )?;
    let mut machine = SyncLifecycleMachine::default();

    for (step, state) in trace.states.iter().enumerate() {
        ensure(
            !state.action.is_empty(),
            format!("ITF state {step} has no model action"),
        )?;
        ensure(
            REQUIRED_ACTIONS.contains(&state.action.as_str()),
            format!("ITF state {step} has unknown action `{}`", state.action),
        )?;
        coverage.insert(state.action.clone());
        if step == 0 {
            ensure(
                state.action == "init",
                "the first lifecycle state must be init",
            )?;
        } else if state.action != "idle" {
            record_scenario(&state.action, machine.state(), scenarios);
            let event = event_for(&state.action).ok_or_else(|| {
                invalid(format!(
                    "model action `{}` has no production event",
                    state.action
                ))
            })?;
            machine.apply(event)?;
        }

        let expected = model_projection(state)?;
        let actual = implementation_projection(machine.state());
        if actual != expected {
            return Ok(Some(Mismatch {
                trace: path.to_path_buf(),
                step: Some(u64::try_from(step).unwrap_or(u64::MAX)),
                action: Some(state.action.clone()),
                message: "production Rust lifecycle state does not refine Quint".to_owned(),
                expected,
                actual,
            }));
        }
    }
    Ok(None)
}

fn replay_paths(paths: &[PathBuf]) -> AnyResult<ReplayResponse> {
    ensure(
        !paths.is_empty(),
        "lifecycle replay requires at least one trace",
    )?;
    let mut paths = paths.to_vec();
    paths.sort();
    let mut coverage = BTreeSet::new();
    let mut scenarios = BTreeSet::new();
    let mut mismatches = Vec::new();
    let mut passed = 0_u64;

    for path in &paths {
        match replay_trace(path, &mut coverage, &mut scenarios) {
            Ok(None) => passed += 1,
            Ok(Some(mismatch)) => mismatches.push(mismatch),
            Err(error) => mismatches.push(Mismatch {
                trace: path.clone(),
                step: None,
                action: None,
                message: error.to_string(),
                expected: json!({}),
                actual: json!({}),
            }),
        }
    }

    let missing = REQUIRED_ACTIONS
        .iter()
        .filter(|action| !coverage.contains(**action))
        .copied()
        .collect::<Vec<_>>();
    if !missing.is_empty() {
        mismatches.push(Mismatch {
            trace: paths[0].clone(),
            step: None,
            action: None,
            message: format!(
                "lifecycle trace corpus is missing actions: {}",
                missing.join(", ")
            ),
            expected: json!(REQUIRED_ACTIONS),
            actual: json!(coverage),
        });
        let total = u64::try_from(paths.len()).unwrap_or(u64::MAX);
        passed = passed.min(total.saturating_sub(1));
    }

    let missing_scenarios = REQUIRED_SCENARIOS
        .iter()
        .filter(|scenario| !scenarios.contains(**scenario))
        .copied()
        .collect::<Vec<_>>();
    if !missing_scenarios.is_empty() {
        mismatches.push(Mismatch {
            trace: paths[0].clone(),
            step: None,
            action: None,
            message: format!(
                "lifecycle trace corpus is missing critical scenarios: {}",
                missing_scenarios.join(", ")
            ),
            expected: json!(REQUIRED_SCENARIOS),
            actual: json!(scenarios),
        });
        let total = u64::try_from(paths.len()).unwrap_or(u64::MAX);
        passed = passed.min(total.saturating_sub(1));
    }

    let total = u64::try_from(paths.len()).map_err(|_| invalid("too many trace paths"))?;
    Ok(ReplayResponse {
        protocol: "fmctl.adapter.v1",
        success: mismatches.is_empty(),
        traces_total: total,
        traces_passed: passed,
        mismatches,
        implementation: Implementation {
            language: "rust",
            name: "opto-sync-desktop SyncLifecycleMachine",
            version: env!("CARGO_PKG_VERSION"),
        },
    })
}

fn validate_request(request: &ReplayRequest) -> AnyResult<()> {
    ensure(
        request.protocol == "fmctl.adapter.v1",
        "unsupported adapter protocol",
    )?;
    ensure(
        request.adapter == "rust",
        "request selected a non-Rust adapter",
    )?;
    ensure(
        request.project == "opto-sync-clients",
        "unexpected lifecycle project",
    )?;
    ensure(
        request.model == "mobile-desktop-lifecycle-v1",
        "unexpected lifecycle model",
    )?;
    ensure(
        request.specification.is_file(),
        "specification is not a regular file",
    )?;
    ensure(!request.traces.is_empty(), "request contains no traces")?;
    Ok(())
}

fn main() -> AnyResult<()> {
    let mut paths = std::env::args_os()
        .skip(1)
        .map(PathBuf::from)
        .collect::<Vec<_>>();
    let response = if paths.is_empty() {
        let mut input = String::new();
        io::stdin().read_to_string(&mut input)?;
        let request: ReplayRequest = serde_json::from_str(&input)?;
        validate_request(&request)?;
        replay_paths(&request.traces)?
    } else {
        paths.sort();
        replay_paths(&paths)?
    };
    serde_json::to_writer_pretty(io::stdout().lock(), &response)?;
    println!();
    Ok(())
}
