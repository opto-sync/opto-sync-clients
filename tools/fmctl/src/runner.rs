use std::fs::{self, OpenOptions};
use std::io::{self, Read, Write};
#[cfg(unix)]
use std::os::unix::process::CommandExt;
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use wait_timeout::ChildExt;

use crate::adapter::AdapterReplayResponse;
use crate::error::FmError;
use crate::plan::CommandPlan;

static ARTIFACT_SEQUENCE: AtomicU64 = AtomicU64::new(0);
const WORKER_DRAIN_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommandOutcome {
    pub schema_version: u32,
    pub project: String,
    pub model: String,
    pub operation: String,
    pub program: String,
    pub args: Vec<String>,
    pub resource_policy: crate::resource::EffectiveResourcePolicy,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub failure: Option<String>,
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
        .env_clear()
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .stdin(if plan.stdin.is_some() {
            Stdio::piped()
        } else {
            Stdio::null()
        });
    #[cfg(unix)]
    command.process_group(0);
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

    let stdout_worker = spawn_io_worker(move || capture_stream(stdout, output_limit, stdout_limit));
    let stderr_worker = spawn_io_worker(move || capture_stream(stderr, output_limit, stderr_limit));

    let stdin_worker = plan.stdin.as_ref().and_then(|input| {
        child.stdin.take().map(|mut child_stdin| {
            let input = input.as_bytes().to_vec();
            spawn_io_worker(move || child_stdin.write_all(&input))
        })
    });

    let timeout = Duration::from_secs(plan.timeout_seconds);
    let (status, timed_out) = match child.wait_timeout(timeout) {
        Err(source) => {
            terminate_process_group(&mut child, &plan.program)?;
            let _ = child.wait();
            let _ = join_stdin(stdin_worker);
            let _ = join_capture(stdout_worker, &plan.program, "stdout");
            let _ = join_capture(stderr_worker, &plan.program, "stderr");
            return Err(FmError::Wait {
                program: plan.program.clone(),
                source,
            });
        }
        Ok(Some(status)) => {
            terminate_process_group(&mut child, &plan.program)?;
            (status, false)
        }
        Ok(None) => {
            terminate_process_group(&mut child, &plan.program)?;
            let status = child.wait().map_err(|source| FmError::Wait {
                program: plan.program.clone(),
                source,
            })?;
            (status, true)
        }
    };

    let stdin_result = join_stdin(stdin_worker);
    let stdout_capture = join_capture(stdout_worker, &plan.program, "stdout")?;
    let stderr_capture = join_capture(stderr_worker, &plan.program, "stderr")?;
    let duration_millis = started.elapsed().as_millis().min(u128::from(u64::MAX)) as u64;

    write_artifact(
        &plan.workspace,
        &plan.artifacts.stdout,
        &stdout_capture.bytes,
    )?;
    write_artifact(
        &plan.workspace,
        &plan.artifacts.stderr,
        &stderr_capture.bytes,
    )?;
    if !timed_out {
        stdin_result.map_err(|source| FmError::WriteStdin {
            program: plan.program.clone(),
            source,
        })?;
    }

    let outcome = CommandOutcome {
        schema_version: 1,
        project: plan.project.clone(),
        model: plan.model.clone(),
        operation: plan.operation.clone(),
        program: plan.program.clone(),
        args: plan.args.clone(),
        resource_policy: plan.resource_policy.clone(),
        success: status.success() && !timed_out,
        timed_out,
        exit_code: status.code(),
        duration_millis,
        stdout: String::from_utf8_lossy(&stdout_capture.bytes).into_owned(),
        stderr: String::from_utf8_lossy(&stderr_capture.bytes).into_owned(),
        stdout_truncated: stdout_capture.truncated,
        stderr_truncated: stderr_capture.truncated,
        adapter_response: None,
        failure: None,
        artifacts: plan.artifacts.clone(),
    };

    Ok(outcome)
}

pub(crate) fn write_artifact(
    workspace: &Path,
    path: &Path,
    contents: &[u8],
) -> Result<(), FmError> {
    let parent = path.parent().ok_or_else(|| {
        FmError::Validation(format!("artifact path has no parent: {}", path.display()))
    })?;
    let canonical_parent =
        fs::canonicalize(parent).map_err(|source| FmError::io(parent, source))?;
    if !canonical_parent.starts_with(workspace) {
        return Err(FmError::Validation(format!(
            "artifact parent escapes workspace: {}",
            canonical_parent.display()
        )));
    }
    let file_name = path.file_name().ok_or_else(|| {
        FmError::Validation(format!(
            "artifact path has no file name: {}",
            path.display()
        ))
    })?;
    let sequence = ARTIFACT_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    let temporary = parent.join(format!(
        ".{}.{}.{}.tmp",
        file_name.to_string_lossy(),
        std::process::id(),
        sequence
    ));
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary)
        .map_err(|source| FmError::io(&temporary, source))?;
    file.write_all(contents)
        .map_err(|source| FmError::io(&temporary, source))?;
    file.sync_all()
        .map_err(|source| FmError::io(&temporary, source))?;
    fs::rename(&temporary, path).map_err(|source| FmError::io(path, source))
}

fn spawn_io_worker<T, F>(worker: F) -> Receiver<io::Result<T>>
where
    T: Send + 'static,
    F: FnOnce() -> io::Result<T> + Send + 'static,
{
    let (sender, receiver) = mpsc::channel();
    thread::spawn(move || {
        let _ = sender.send(worker());
    });
    receiver
}

fn join_stdin(worker: Option<Receiver<io::Result<()>>>) -> io::Result<()> {
    match worker {
        Some(worker) => match worker.recv_timeout(WORKER_DRAIN_TIMEOUT) {
            Ok(result) => result,
            Err(RecvTimeoutError::Timeout) => Err(io::Error::new(
                io::ErrorKind::TimedOut,
                "stdin worker did not finish after process termination",
            )),
            Err(RecvTimeoutError::Disconnected) => {
                Err(io::Error::other("stdin worker thread panicked"))
            }
        },
        None => Ok(()),
    }
}

#[cfg(unix)]
fn terminate_process_group(child: &mut Child, program: &str) -> Result<(), FmError> {
    let process_group = i32::try_from(child.id()).map_err(|_| FmError::Terminate {
        program: program.to_owned(),
        source: io::Error::new(io::ErrorKind::InvalidInput, "child process id exceeds i32"),
    })?;
    // SAFETY: `process_group(0)` above places the child in a new group whose
    // positive ID is the child PID. A negative PID addresses exactly that group.
    let result = unsafe { libc::kill(-process_group, libc::SIGKILL) };
    if result == 0 {
        return Ok(());
    }
    let source = io::Error::last_os_error();
    if source.raw_os_error() == Some(libc::ESRCH) {
        Ok(())
    } else {
        Err(FmError::Terminate {
            program: program.to_owned(),
            source,
        })
    }
}

#[cfg(not(unix))]
fn terminate_process_group(child: &mut Child, program: &str) -> Result<(), FmError> {
    match child.try_wait() {
        Ok(Some(_)) => Ok(()),
        Ok(None) => child.kill().map_err(|source| FmError::Terminate {
            program: program.to_owned(),
            source,
        }),
        Err(source) => Err(FmError::Terminate {
            program: program.to_owned(),
            source,
        }),
    }
}

fn join_capture(
    worker: Receiver<io::Result<CapturedStream>>,
    program: &str,
    stream: &'static str,
) -> Result<CapturedStream, FmError> {
    match worker.recv_timeout(WORKER_DRAIN_TIMEOUT) {
        Ok(result) => result.map_err(|source| FmError::Output {
            program: program.to_owned(),
            stream,
            source,
        }),
        Err(RecvTimeoutError::Timeout) => Err(FmError::Output {
            program: program.to_owned(),
            stream,
            source: io::Error::new(
                io::ErrorKind::TimedOut,
                "output worker did not finish after process termination",
            ),
        }),
        Err(RecvTimeoutError::Disconnected) => Err(FmError::OutputWorkerPanicked),
    }
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
    use crate::plan::CommandArtifacts;
    use crate::resource::{ResourceProfile, ResourceRequest};
    use std::collections::BTreeMap;
    use tempfile::TempDir;

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

    #[cfg(unix)]
    #[test]
    fn blocked_stdin_and_descendants_obey_the_timeout() {
        let directory = TempDir::new().expect("tempdir");
        let workspace = fs::canonicalize(directory.path()).expect("canonical workspace");
        let artifacts = workspace.join("artifacts");
        fs::create_dir_all(&artifacts).expect("artifacts");
        let resource_policy = ResourceProfile::local_v1()
            .resolve(ResourceRequest {
                timeout_seconds: Some(1),
                max_output_bytes: Some(1024),
                ..ResourceRequest::absent()
            })
            .expect("test policy");
        let plan = CommandPlan {
            schema_version: 1,
            project: "example".to_owned(),
            model: "machine".to_owned(),
            operation: "replay".to_owned(),
            program: "/bin/sh".to_owned(),
            args: vec!["-c".to_owned(), "sleep 60 & wait".to_owned()],
            workspace: workspace.clone(),
            cwd: workspace,
            environment: BTreeMap::new(),
            stdin: Some("x".repeat(2 * 1024 * 1024)),
            timeout_seconds: 1,
            max_output_bytes: 1024,
            resource_policy: resource_policy.clone(),
            create_directories: vec![artifacts.clone()],
            artifacts: CommandArtifacts {
                stdout: artifacts.join("stdout.log"),
                stderr: artifacts.join("stderr.log"),
                result: artifacts.join("result.json"),
                trace_pattern: None,
            },
        };
        let started = Instant::now();
        let outcome = execute_plan(&plan).expect("bounded execution");
        assert!(outcome.timed_out);
        assert_eq!(outcome.resource_policy, resource_policy);
        assert!(started.elapsed() < Duration::from_secs(10));
    }
}
