use std::fs;
use std::io::{self, Read, Write};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use wait_timeout::ChildExt;

use crate::adapter::AdapterReplayResponse;
use crate::error::FmError;
use crate::plan::CommandPlan;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommandOutcome {
    pub schema_version: u32,
    pub project: String,
    pub model: String,
    pub operation: String,
    pub program: String,
    pub args: Vec<String>,
    pub success: bool,
    pub timed_out: bool,
    pub exit_code: Option<i32>,
    pub duration_millis: u64,
    pub stdout: String,
    pub stderr: String,
    pub stdout_truncated: bool,
    pub stderr_truncated: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub adapter_response: Option<AdapterReplayResponse>,
    pub artifacts: crate::plan::CommandArtifacts,
}

impl CommandOutcome {
    pub fn stable_exit_code(&self) -> u8 {
        if self.success {
            0
        } else if self.timed_out {
            124
        } else {
            self.exit_code
                .and_then(|code| u8::try_from(code).ok())
                .filter(|code| *code != 0)
                .unwrap_or(10)
        }
    }
}

#[derive(Debug)]
struct CapturedStream {
    bytes: Vec<u8>,
    truncated: bool,
}

pub fn execute_plan(plan: &CommandPlan) -> Result<CommandOutcome, FmError> {
    for directory in &plan.create_directories {
        fs::create_dir_all(directory).map_err(|source| FmError::io(directory, source))?;
    }

    let started = Instant::now();
    let mut command = Command::new(&plan.program);
    command
        .args(&plan.args)
        .current_dir(&plan.cwd)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .stdin(if plan.stdin.is_some() {
            Stdio::piped()
        } else {
            Stdio::null()
        });
    for (key, value) in &plan.environment {
        command.env(key, value);
    }

    let mut child = command.spawn().map_err(|source| FmError::Spawn {
        program: plan.program.clone(),
        source,
    })?;

    let stdout = child
        .stdout
        .take()
        .expect("stdout is piped before spawning the child process");
    let stderr = child
        .stderr
        .take()
        .expect("stderr is piped before spawning the child process");
    let captured_bytes = Arc::new(AtomicUsize::new(0));
    let stdout_limit = Arc::clone(&captured_bytes);
    let stderr_limit = Arc::clone(&captured_bytes);
    let output_limit = plan.max_output_bytes;

    let stdout_worker = thread::spawn(move || capture_stream(stdout, output_limit, stdout_limit));
    let stderr_worker = thread::spawn(move || capture_stream(stderr, output_limit, stderr_limit));

    if let Some(input) = &plan.stdin {
        if let Some(mut child_stdin) = child.stdin.take() {
            if let Err(source) = child_stdin.write_all(input.as_bytes()) {
                let _ = child.kill();
                let _ = child.wait();
                let _ = stdout_worker.join();
                let _ = stderr_worker.join();
                return Err(FmError::WriteStdin {
                    program: plan.program.clone(),
                    source,
                });
            }
        }
    }

    let timeout = Duration::from_secs(plan.timeout_seconds);
    let (status, timed_out) = match child
        .wait_timeout(timeout)
        .map_err(|source| FmError::Wait {
            program: plan.program.clone(),
            source,
        })? {
        Some(status) => (status, false),
        None => {
            let _ = child.kill();
            let status = child.wait().map_err(|source| FmError::Wait {
                program: plan.program.clone(),
                source,
            })?;
            (status, true)
        }
    };

    let stdout_capture = join_capture(stdout_worker, &plan.program, "stdout")?;
    let stderr_capture = join_capture(stderr_worker, &plan.program, "stderr")?;
    let duration_millis = started.elapsed().as_millis().min(u128::from(u64::MAX)) as u64;

    fs::write(&plan.artifacts.stdout, &stdout_capture.bytes)
        .map_err(|source| FmError::io(&plan.artifacts.stdout, source))?;
    fs::write(&plan.artifacts.stderr, &stderr_capture.bytes)
        .map_err(|source| FmError::io(&plan.artifacts.stderr, source))?;

    let outcome = CommandOutcome {
        schema_version: 1,
        project: plan.project.clone(),
        model: plan.model.clone(),
        operation: plan.operation.clone(),
        program: plan.program.clone(),
        args: plan.args.clone(),
        success: status.success() && !timed_out,
        timed_out,
        exit_code: status.code(),
        duration_millis,
        stdout: String::from_utf8_lossy(&stdout_capture.bytes).into_owned(),
        stderr: String::from_utf8_lossy(&stderr_capture.bytes).into_owned(),
        stdout_truncated: stdout_capture.truncated,
        stderr_truncated: stderr_capture.truncated,
        adapter_response: None,
        artifacts: plan.artifacts.clone(),
    };

    let result_json = serde_json::to_vec_pretty(&outcome)?;
    fs::write(&plan.artifacts.result, result_json)
        .map_err(|source| FmError::io(&plan.artifacts.result, source))?;

    Ok(outcome)
}

fn join_capture(
    worker: thread::JoinHandle<io::Result<CapturedStream>>,
    program: &str,
    stream: &'static str,
) -> Result<CapturedStream, FmError> {
    worker
        .join()
        .map_err(|_| FmError::OutputWorkerPanicked)?
        .map_err(|source| FmError::Output {
            program: program.to_owned(),
            stream,
            source,
        })
}

fn capture_stream<R: Read>(
    mut reader: R,
    limit: usize,
    captured_bytes: Arc<AtomicUsize>,
) -> io::Result<CapturedStream> {
    let mut bytes = Vec::new();
    let mut truncated = false;
    let mut buffer = [0_u8; 16 * 1024];

    loop {
        let read = reader.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        let reserved = reserve_output_bytes(&captured_bytes, limit, read);
        if reserved > 0 {
            bytes.extend_from_slice(&buffer[..reserved]);
        }
        if reserved < read {
            truncated = true;
        }
    }

    Ok(CapturedStream { bytes, truncated })
}

fn reserve_output_bytes(counter: &AtomicUsize, limit: usize, requested: usize) -> usize {
    let mut current = counter.load(Ordering::Relaxed);
    loop {
        if current >= limit {
            return 0;
        }
        let granted = requested.min(limit - current);
        match counter.compare_exchange_weak(
            current,
            current + granted,
            Ordering::Relaxed,
            Ordering::Relaxed,
        ) {
            Ok(_) => return granted,
            Err(observed) => current = observed,
        }
    }
}

pub fn command_display(program: &str, args: &[String]) -> String {
    std::iter::once(program)
        .chain(args.iter().map(String::as_str))
        .map(shell_quote)
        .collect::<Vec<_>>()
        .join(" ")
}

fn shell_quote(value: &str) -> String {
    if !value.is_empty()
        && value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || "-._/:=@{}".contains(character))
    {
        value.to_owned()
    } else {
        format!("'{}'", value.replace('\'', "'\\''"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn output_reservation_never_exceeds_limit() {
        let counter = AtomicUsize::new(0);
        assert_eq!(reserve_output_bytes(&counter, 10, 7), 7);
        assert_eq!(reserve_output_bytes(&counter, 10, 7), 3);
        assert_eq!(reserve_output_bytes(&counter, 10, 1), 0);
        assert_eq!(counter.load(Ordering::Relaxed), 10);
    }

    #[test]
    fn command_display_quotes_whitespace() {
        assert_eq!(
            command_display("tool", &["hello world".to_owned()]),
            "tool 'hello world'"
        );
    }
}
