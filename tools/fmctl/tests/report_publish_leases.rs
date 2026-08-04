use std::env;
use std::fs;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::{mpsc, Arc, Barrier};
use std::thread;
use std::time::{Duration, Instant};

use fmctl::plan::{ArtifactPaths, Operation};
use fmctl::result::publish::{
    cleanup_stale_publication_state, publish_report_bundle_with_hook, PublishStep,
};
use fmctl::runner::{CommandOutcome, Termination};
use tempfile::TempDir;

#[test]
fn zero_age_cleanup_never_removes_a_paused_publication() {
    let directory = TempDir::new().expect("tempdir");
    let root = directory.path().join("bundles");
    let publisher_root = root.clone();
    let (ready_tx, ready_rx) = mpsc::sync_channel(0);
    let (resume_tx, resume_rx) = mpsc::sync_channel(0);

    let publisher = thread::spawn(move || {
        publish_report_bundle_with_hook(
            &fixture_outcome(),
            &publisher_root,
            "paused-001",
            |step| {
                if step == PublishStep::Result {
                    ready_tx
                        .send(())
                        .map_err(|_| std::io::Error::other("ready receiver disconnected"))?;
                    resume_rx
                        .recv()
                        .map_err(|_| std::io::Error::other("resume sender disconnected"))?;
                }
                Ok(())
            },
        )
    });

    ready_rx
        .recv_timeout(Duration::from_secs(10))
        .expect("publisher reached first staged file");
    let report = cleanup_stale_publication_state(&root, Duration::ZERO)
        .expect("cleanup during active publication");
    assert_eq!(report.staging_directories_removed, 0);
    assert_eq!(report.reservations_removed, 0);
    assert!(root.join(".fm-report-lease-paused-001").is_file());
    assert!(root
        .join(".fm-report-reservation-paused-001")
        .is_file());
    assert!(fs::read_dir(&root)
        .expect("root entries")
        .filter_map(Result::ok)
        .any(|entry| entry
            .file_name()
            .to_string_lossy()
            .starts_with(".fm-report-staging-paused-001-")));

    resume_tx.send(()).expect("resume publisher");
    let published = publisher
        .join()
        .expect("publisher thread")
        .expect("publisher succeeds");
    assert!(published.result.is_file());
    assert!(!root.join(".fm-report-lease-paused-001").exists());
}

#[test]
fn process_death_releases_the_lease_and_cleanup_recovers_partial_state() {
    let directory = TempDir::new().expect("tempdir");
    let root = directory.path().join("bundles");
    let ready = directory.path().join("child-ready");
    let mut child = Command::new(env::current_exe().expect("current test executable"))
        .args([
            "--exact",
            "publication_child_holds_lease_until_killed",
            "--nocapture",
        ])
        .env("FMCTL_LEASE_CHILD_ROOT", &root)
        .env("FMCTL_LEASE_CHILD_READY", &ready)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .expect("spawn publication child");

    let deadline = Instant::now() + Duration::from_secs(20);
    while !ready.exists() {
        if let Some(status) = child.try_wait().expect("child status") {
            panic!("publication child exited before ready: {status}");
        }
        assert!(Instant::now() < deadline, "publication child did not become ready");
        thread::sleep(Duration::from_millis(20));
    }

    let active = cleanup_stale_publication_state(&root, Duration::ZERO)
        .expect("cleanup while child is alive");
    assert_eq!(active.staging_directories_removed, 0);
    assert_eq!(active.reservations_removed, 0);

    child.kill().expect("kill publication child");
    child.wait().expect("wait for publication child");

    let recovered = cleanup_stale_publication_state(&root, Duration::ZERO)
        .expect("cleanup after process death");
    assert_eq!(recovered.staging_directories_removed, 1);
    assert_eq!(recovered.reservations_removed, 1);
    assert!(!root.join(".fm-report-lease-dead-child").exists());
}

#[test]
fn publication_child_holds_lease_until_killed() {
    let Some(root) = env::var_os("FMCTL_LEASE_CHILD_ROOT") else {
        return;
    };
    let ready = PathBuf::from(
        env::var_os("FMCTL_LEASE_CHILD_READY").expect("child ready marker path"),
    );
    let result = publish_report_bundle_with_hook(
        &fixture_outcome(),
        &PathBuf::from(root),
        "dead-child",
        |step| {
            if step == PublishStep::Result {
                fs::write(&ready, b"ready")?;
                loop {
                    thread::sleep(Duration::from_secs(60));
                }
            }
            Ok(())
        },
    );
    panic!("publication child unexpectedly returned: {result:?}");
}

#[test]
fn concurrent_cleanup_workers_are_serialized_and_idempotent() {
    let directory = TempDir::new().expect("tempdir");
    let root = directory.path().join("bundles");
    fs::create_dir_all(&root).expect("bundle root");
    fs::create_dir(root.join(".fm-report-staging-orphan-001-123-0"))
        .expect("staging directory");
    fs::write(
        root.join(".fm-report-reservation-orphan-001"),
        b"orphan-001",
    )
    .expect("reservation");
    fs::write(root.join(".fm-report-lease-orphan-001"), b"")
        .expect("unlocked lease");

    let barrier = Arc::new(Barrier::new(3));
    let handles = (0..2)
        .map(|_| {
            let root = root.clone();
            let barrier = Arc::clone(&barrier);
            thread::spawn(move || {
                barrier.wait();
                cleanup_stale_publication_state(&root, Duration::ZERO)
            })
        })
        .collect::<Vec<_>>();
    barrier.wait();

    let reports = handles
        .into_iter()
        .map(|handle| handle.join().expect("cleanup thread").expect("cleanup"))
        .collect::<Vec<_>>();
    assert_eq!(
        reports
            .iter()
            .map(|report| report.staging_directories_removed)
            .sum::<usize>(),
        1
    );
    assert_eq!(
        reports
            .iter()
            .map(|report| report.reservations_removed)
            .sum::<usize>(),
        1
    );
    assert!(!root.join(".fm-report-lease-orphan-001").exists());
}

fn fixture_outcome() -> CommandOutcome {
    CommandOutcome {
        operation: "check".to_owned(),
        command: vec!["quint".to_owned(), "typecheck".to_owned()],
        cwd: PathBuf::from("/tmp/workspace"),
        duration_millis: 17,
        success: true,
        dry_run: false,
        exit_code: Some(0),
        termination: Termination::Exited,
        stdout: "typecheck ok\n".to_owned(),
        stderr: String::new(),
        failure: None,
        output_limited: false,
        stdout_bytes: 13,
        stderr_bytes: 0,
        configured_timeout_seconds: 30,
        configured_max_output_bytes: 4096,
        effective_max_output_bytes: 4096,
        artifacts: ArtifactPaths {
            result: PathBuf::from("result.json"),
            stdout: PathBuf::from("stdout.log"),
            stderr: PathBuf::from("stderr.log"),
            trace_pattern: None,
            trace_pattern_template: None,
            trace_glob: None,
        },
        traces: Vec::new(),
        replay: None,
        plan: None,
        protocol_violation: None,
        effective_budget: None,
        provenance: None,
        limiter: None,
        process_group: None,
        descendant_cleanup: None,
    }
}
