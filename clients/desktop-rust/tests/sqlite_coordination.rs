use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use opto_sync_desktop::sqlite::{
    SqliteCoordinatedDesktopSyncRunner, SqliteDesktopAcquireRequest, SqliteDesktopAcquireResult,
    SqliteDesktopCoordinator, SqliteDesktopCoordinatorOptions, SqliteDesktopError,
};
use opto_sync_desktop::{DesktopLeaseRequest, DesktopLeaseStore, DesktopWakeReason};

static NEXT_FIXTURE: AtomicU64 = AtomicU64::new(0);

struct Fixture {
    path: PathBuf,
}

impl Fixture {
    fn new() -> Self {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock after epoch")
            .as_nanos();
        let serial = NEXT_FIXTURE.fetch_add(1, Ordering::Relaxed);
        let path = std::env::temp_dir().join(format!(
            "opto-sync-rust-sqlite-{}-{nanos}-{serial}.sqlite3",
            std::process::id()
        ));
        Self { path }
    }

    fn coordinator(&self) -> SqliteDesktopCoordinator {
        SqliteDesktopCoordinator::open(&self.path, SqliteDesktopCoordinatorOptions::default())
            .expect("open SQLite coordinator")
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        for suffix in ["", "-wal", "-shm"] {
            let path = PathBuf::from(format!("{}{}", self.path.display(), suffix));
            let _ = fs::remove_file(path);
        }
    }
}

fn acquired(
    coordinator: &mut SqliteDesktopCoordinator,
    owner: &str,
    token: &str,
    ttl_ms: u64,
) -> opto_sync_desktop::sqlite::SqliteDesktopLeaseGrant {
    match coordinator
        .acquire(SqliteDesktopAcquireRequest {
            key: "partition".to_owned(),
            owner_id: owner.to_owned(),
            token: token.to_owned(),
            lease_ttl_ms: ttl_ms,
        })
        .expect("acquire lease")
    {
        SqliteDesktopAcquireResult::Acquired(grant) => grant,
        SqliteDesktopAcquireResult::Busy(busy) => panic!("unexpected busy lease: {busy:?}"),
    }
}

fn child_command(path: &Path, mode: &str, owner: &str, hold_ms: u64, ttl_ms: u64) -> Command {
    let mut command = Command::new(std::env::current_exe().expect("current test executable"));
    command
        .arg("sqlite_child_process")
        .arg("--exact")
        .arg("--ignored")
        .arg("--nocapture")
        .arg("--test-threads=1")
        .env("OPTO_SYNC_SQLITE_CHILD", "1")
        .env("OPTO_SYNC_SQLITE_MODE", mode)
        .env("OPTO_SYNC_SQLITE_PATH", path)
        .env("OPTO_SYNC_SQLITE_OWNER", owner)
        .env("OPTO_SYNC_SQLITE_HOLD_MS", hold_ms.to_string())
        .env("OPTO_SYNC_SQLITE_TTL_MS", ttl_ms.to_string());
    command
}

fn start_holder(path: &Path, owner: &str, ttl_ms: u64) -> Child {
    let mut child = child_command(path, "hold", owner, 10_000, ttl_ms)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("spawn holder process");
    let stdout = child.stdout.take().expect("holder stdout");
    let mut reader = BufReader::new(stdout);
    let mut transcript = String::new();
    loop {
        let mut line = String::new();
        let read = reader
            .read_line(&mut line)
            .expect("read holder acquisition");
        if read == 0 {
            panic!("holder exited before acquisition: {transcript:?}");
        }
        transcript.push_str(&line);
        if line.contains("acquired:") {
            break;
        }
        if line.contains("busy:") {
            panic!("holder unexpectedly found a busy lease: {transcript:?}");
        }
    }
    child
}

#[test]
#[ignore]
fn sqlite_child_process() {
    if std::env::var_os("OPTO_SYNC_SQLITE_CHILD").is_none() {
        return;
    }
    let mode = std::env::var("OPTO_SYNC_SQLITE_MODE").expect("child mode");
    let path = std::env::var_os("OPTO_SYNC_SQLITE_PATH").expect("child path");
    let owner = std::env::var("OPTO_SYNC_SQLITE_OWNER").expect("child owner");
    let hold_ms = std::env::var("OPTO_SYNC_SQLITE_HOLD_MS")
        .expect("child hold")
        .parse::<u64>()
        .expect("numeric child hold");
    let ttl_ms = std::env::var("OPTO_SYNC_SQLITE_TTL_MS")
        .expect("child TTL")
        .parse::<u64>()
        .expect("numeric child TTL");
    let mut coordinator = SqliteDesktopCoordinator::open(
        PathBuf::from(path),
        SqliteDesktopCoordinatorOptions {
            busy_timeout_ms: 10_000,
            initialize_pragmas: true,
        },
    )
    .expect("open child coordinator");
    coordinator
        .signal_wake("partition")
        .expect("signal child wake");
    match coordinator
        .acquire(SqliteDesktopAcquireRequest {
            key: "partition".to_owned(),
            owner_id: owner.clone(),
            token: format!("{owner}-token"),
            lease_ttl_ms: ttl_ms,
        })
        .expect("child acquisition")
    {
        SqliteDesktopAcquireResult::Busy(busy) => {
            println!("busy:{}", busy.wake_generation);
            std::io::stdout().flush().expect("flush child output");
        }
        SqliteDesktopAcquireResult::Acquired(grant) => {
            println!("acquired:{}", grant.fence);
            std::io::stdout().flush().expect("flush child output");
            if mode == "hold" {
                thread::sleep(Duration::from_millis(hold_ms));
            } else {
                coordinator
                    .complete(&grant, &grant.wake_generation)
                    .expect("complete child cycle");
            }
        }
    }
}

#[test]
fn sqlite_store_time_not_process_clock_decides_lease_overlap() {
    let fixture = Fixture::new();
    let mut first = fixture.coordinator();
    let mut second = fixture.coordinator();
    first.signal_wake("partition").expect("signal wake");
    let first_grant = first
        .try_acquire(DesktopLeaseRequest {
            key: "partition".to_owned(),
            owner_id: "slow-clock-process".to_owned(),
            token: "token-a".to_owned(),
            now_ms: 0,
            expires_at_ms: 5_000,
        })
        .expect("first acquisition")
        .expect("first owner");
    assert!(first_grant.expires_at_ms > 1_000_000_000_000);

    let skewed = second
        .try_acquire(DesktopLeaseRequest {
            key: "partition".to_owned(),
            owner_id: "future-clock-process".to_owned(),
            token: "token-b".to_owned(),
            now_ms: 9_000_000_000_000,
            expires_at_ms: 9_000_000_005_000,
        })
        .expect("skewed acquisition attempt");
    assert!(skewed.is_none());
}

#[test]
fn wake_after_inspection_is_retained_for_a_trailing_fenced_cycle() {
    let fixture = Fixture::new();
    let mut owner = fixture.coordinator();
    let mut writer = fixture.coordinator();
    assert_eq!(
        owner
            .signal_wake("partition")
            .expect("initial wake")
            .generation,
        "1"
    );
    let grant = acquired(&mut owner, "owner-a", "token-a", 5_000);
    assert_eq!(grant.wake_generation, "1");

    assert_eq!(
        writer
            .signal_wake("partition")
            .expect("later wake")
            .generation,
        "2"
    );
    let first_completion = owner
        .complete(&grant, &grant.wake_generation)
        .expect("first completion");
    assert!(!first_completion.released);
    assert_eq!(first_completion.current_wake_generation, "2");
    assert_eq!(first_completion.handled_generation, "1");

    let renewed = owner
        .renew(&grant, 5_000)
        .expect("renew lease")
        .expect("same owner remains current");
    let second_completion = owner.complete(&renewed, "2").expect("second completion");
    assert!(second_completion.released);
    let state = owner.read_state("partition").expect("read state");
    assert_eq!(state.wake_generation, "2");
    assert_eq!(state.handled_generation, "2");
    assert!(!state.dirty);
    assert!(!state.owned);
}

#[test]
fn stale_owner_cannot_write_or_release_after_a_newer_fence() {
    let fixture = Fixture::new();
    let mut first = fixture.coordinator();
    let mut second = fixture.coordinator();
    first.signal_wake("partition").expect("signal wake");
    let first_grant = acquired(&mut first, "owner-a", "token-a", 1_000);
    thread::sleep(Duration::from_millis(1_200));
    let second_grant = acquired(&mut second, "owner-b", "token-b", 5_000);
    assert_eq!(second_grant.fence, "2");

    let stale = first.with_fenced_write(&first_grant.desktop_grant(), |transaction| {
        transaction.execute_batch(
            "CREATE TABLE IF NOT EXISTS fenced_probe(value INTEGER NOT NULL);\
             INSERT INTO fenced_probe(value) VALUES (1);",
        )?;
        Ok(())
    });
    assert!(matches!(stale, Err(SqliteDesktopError::StaleFence)));
    first
        .release_lease(&first_grant.desktop_grant())
        .expect("stale release is a no-op");
    second
        .assert_current_fence(&second_grant.desktop_grant())
        .expect("new owner remains current");
}

#[test]
fn real_os_processes_contend_for_one_sqlite_partition() {
    let fixture = Fixture::new();
    let mut holder = start_holder(&fixture.path, "holder", 5_000);
    for index in 0..3 {
        let output = child_command(
            &fixture.path,
            "contend",
            &format!("process-{index}"),
            0,
            2_000,
        )
        .output()
        .expect("run contender process");
        assert!(
            output.status.success(),
            "contender stderr: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        assert!(
            String::from_utf8_lossy(&output.stdout).contains("busy:"),
            "contender stdout: {}",
            String::from_utf8_lossy(&output.stdout)
        );
    }
    holder.kill().expect("terminate holder");
    holder.wait().expect("reap holder");

    let mut coordinator = fixture.coordinator();
    let state = coordinator.read_state("partition").expect("read state");
    assert_eq!(state.fence, "1");
    assert_eq!(state.wake_generation, "4");
    assert_eq!(state.handled_generation, "0");
    assert!(state.dirty);
}

#[test]
fn process_termination_leaves_dirty_generation_for_expiry_replay() {
    let fixture = Fixture::new();
    let mut holder = start_holder(&fixture.path, "doomed", 1_000);
    holder.kill().expect("terminate doomed process");
    holder.wait().expect("reap doomed process");
    thread::sleep(Duration::from_millis(1_200));

    let mut recovery = fixture.coordinator();
    let state = recovery.read_state("partition").expect("read dirty state");
    assert_eq!(state.wake_generation, "1");
    assert_eq!(state.handled_generation, "0");
    assert!(state.dirty);
    let grant = acquired(&mut recovery, "recovery", "recovery-token", 5_000);
    assert_eq!(grant.fence, "2");
    let completed = recovery
        .complete(&grant, &grant.wake_generation)
        .expect("complete replay");
    assert!(completed.released);
}

#[test]
fn rust_runner_rechecks_generation_before_release() {
    let fixture = Fixture::new();
    let coordinator = fixture.coordinator();
    let mut writer = fixture.coordinator();
    let mut runner = SqliteCoordinatedDesktopSyncRunner::new(
        coordinator,
        "partition",
        "runner-a",
        1_000,
        2_500,
        25,
        3_500,
    )
    .expect("build runner");
    let mut token = 0_u64;
    let mut seen = Vec::new();
    let completed = runner
        .wake_and_run(
            DesktopWakeReason::LocalMutation,
            || {
                token += 1;
                format!("runner-token-{token}")
            },
            |_coordinator, context| -> Result<String, &'static str> {
                seen.push(context.wake_generation.clone());
                if seen.len() == 1 {
                    writer
                        .signal_wake("partition")
                        .expect("signal trailing wake");
                }
                Ok(context.wake_generation.clone())
            },
        )
        .expect("run durable cycles");
    assert_eq!(seen, vec!["1".to_owned(), "2".to_owned()]);
    assert_eq!(completed.len(), 2);
    assert_eq!(completed[0].fence, completed[1].fence);
    let state = runner
        .coordinator_mut()
        .read_state("partition")
        .expect("read final state");
    assert!(!state.dirty);
    assert!(!state.owned);
}
