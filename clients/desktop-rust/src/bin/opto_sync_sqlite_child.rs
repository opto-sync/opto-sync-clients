//! Uniform cross-language conformance child for SQLite desktop coordination.
//!
//! Every language runtime that implements `opto_sync_desktop_coordination_v1`
//! ships one of these. They accept identical arguments and emit identical
//! sentinel-prefixed JSON events so a single orchestrator can contend Node,
//! Dart, and Rust processes against one SQLite database.
//!
//! Events are prefixed with `@@OPTO@@` because toolchains write their own
//! progress text to stdout and stderr; the sentinel keeps the protocol
//! readable regardless of that noise.

use std::collections::BTreeMap;
use std::io::Write;
use std::process::ExitCode;
use std::thread;
use std::time::Duration;

use opto_sync_desktop::sqlite::{
    SqliteDesktopAcquireRequest, SqliteDesktopAcquireResult, SqliteDesktopCoordinator,
    SqliteDesktopCoordinatorOptions,
};

const SENTINEL: &str = "@@OPTO@@";

/// Minimal JSON object writer. The corpus only emits flat string/number/bool
/// maps, so a dependency-free encoder keeps the child free of serde drift.
fn emit(event: &str, fields: &BTreeMap<&str, String>) {
    let mut line = format!("{SENTINEL} {{\"event\":\"{event}\",\"runtime\":\"rust\"");
    for (key, value) in fields {
        // '#' marks an already-encoded literal (number or bool).
        if let Some(literal) = value.strip_prefix('#') {
            line.push_str(&format!(",\"{key}\":{literal}"));
        } else {
            line.push_str(&format!(",\"{key}\":\"{}\"", escape(value)));
        }
    }
    line.push('}');
    println!("{line}");
    let _ = std::io::stdout().flush();
}

fn escape(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('\n', "\\n")
}

fn flag(args: &[String], name: &str) -> Option<String> {
    args.iter()
        .position(|candidate| candidate == name)
        .and_then(|index| args.get(index + 1))
        .cloned()
}

fn required(args: &[String], name: &str) -> String {
    flag(args, name).unwrap_or_else(|| {
        eprintln!("missing required flag {name}");
        std::process::exit(2);
    })
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let db = required(&args, "--db");
    let key = required(&args, "--key");
    let owner = required(&args, "--owner");
    let mode = required(&args, "--mode");
    let hold_ms: u64 = flag(&args, "--hold-ms")
        .and_then(|value| value.parse().ok())
        .unwrap_or(0);
    let ttl_ms: u64 = flag(&args, "--ttl-ms")
        .and_then(|value| value.parse().ok())
        .unwrap_or(5_000);

    let mut coordinator = match SqliteDesktopCoordinator::open(
        &db,
        SqliteDesktopCoordinatorOptions {
            busy_timeout_ms: 10_000,
            initialize_pragmas: true,
        },
    ) {
        Ok(coordinator) => coordinator,
        Err(error) => {
            let mut fields = BTreeMap::new();
            fields.insert("message", error.to_string());
            emit("error", &fields);
            return ExitCode::from(1);
        }
    };

    match mode.as_str() {
        "wake" => match coordinator.signal_wake(&key) {
            Ok(receipt) => {
                let mut fields = BTreeMap::new();
                fields.insert("generation", receipt.generation.clone());
                fields.insert("handledGeneration", receipt.handled_generation.clone());
                fields.insert("dirty", format!("#{}", receipt.dirty));
                emit("wake", &fields);
            }
            Err(error) => {
                let mut fields = BTreeMap::new();
                fields.insert("message", error.to_string());
                emit("error", &fields);
                return ExitCode::from(1);
            }
        },
        "contend" | "acquire-hold" => {
            if let Err(error) = coordinator.signal_wake(&key) {
                let mut fields = BTreeMap::new();
                fields.insert("message", error.to_string());
                emit("error", &fields);
                return ExitCode::from(1);
            }
            let request = SqliteDesktopAcquireRequest {
                key: key.clone(),
                owner_id: owner.clone(),
                token: format!("{owner}-token"),
                lease_ttl_ms: ttl_ms,
            };
            match coordinator.acquire(request) {
                Ok(SqliteDesktopAcquireResult::Busy(busy)) => {
                    let mut fields = BTreeMap::new();
                    fields.insert("wakeGeneration", busy.wake_generation.clone());
                    fields.insert("handledGeneration", busy.handled_generation.clone());
                    fields.insert("retryAfterMs", format!("#{}", busy.retry_after_ms));
                    emit("busy", &fields);
                }
                Ok(SqliteDesktopAcquireResult::Acquired(grant)) => {
                    let mut fields = BTreeMap::new();
                    fields.insert("fence", grant.fence.clone());
                    fields.insert("owner", grant.owner_id.clone());
                    fields.insert("wakeGeneration", grant.wake_generation.clone());
                    emit("acquired", &fields);

                    if hold_ms > 0 {
                        thread::sleep(Duration::from_millis(hold_ms));
                    }

                    if mode == "acquire-hold" {
                        // Exit while still holding, to exercise expiry replay.
                        return ExitCode::SUCCESS;
                    }

                    let observed = grant.wake_generation.clone();
                    match coordinator.complete(&grant, &observed) {
                        Ok(completion) => {
                            let mut fields = BTreeMap::new();
                            fields.insert("released", format!("#{}", completion.released));
                            fields.insert(
                                "currentWakeGeneration",
                                completion.current_wake_generation.clone(),
                            );
                            fields
                                .insert("handledGeneration", completion.handled_generation.clone());
                            emit("completed", &fields);
                        }
                        Err(error) => {
                            let mut fields = BTreeMap::new();
                            fields.insert("message", error.to_string());
                            emit("error", &fields);
                            return ExitCode::from(1);
                        }
                    }
                }
                Err(error) => {
                    let mut fields = BTreeMap::new();
                    fields.insert("message", error.to_string());
                    emit("error", &fields);
                    return ExitCode::from(1);
                }
            }
        }
        "state" => match coordinator.read_state(&key) {
            Ok(state) => {
                let mut fields = BTreeMap::new();
                fields.insert("fence", state.fence.clone());
                fields.insert("wakeGeneration", state.wake_generation.clone());
                fields.insert("handledGeneration", state.handled_generation.clone());
                fields.insert("dirty", format!("#{}", state.dirty));
                fields.insert("owned", format!("#{}", state.owned));
                emit("state", &fields);
            }
            Err(error) => {
                let mut fields = BTreeMap::new();
                fields.insert("message", error.to_string());
                emit("error", &fields);
                return ExitCode::from(1);
            }
        },
        other => {
            let mut fields = BTreeMap::new();
            fields.insert("message", format!("unknown mode {other}"));
            emit("error", &fields);
            return ExitCode::from(2);
        }
    }

    ExitCode::SUCCESS
}
