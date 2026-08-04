use std::fs;
use std::io;
use std::path::PathBuf;
use std::sync::{Arc, Barrier};
use std::thread;
use std::time::Duration;

use fmctl::plan::CommandArtifacts;
use fmctl::resource::{ResourceProfile, ResourceRequest};
use fmctl::result::publish::{
    cleanup_stale_publication_state, publish_report_bundle, publish_report_bundle_with_hook,
    PublishStep,
};
use fmctl::result::report::{
    render_artifact_manifest_json, render_junit_xml, render_provenance_json, render_sarif_json,
};
use fmctl::runner::CommandOutcome;
use tempfile::TempDir;

const SECRET: &str = "publisher-must-not-leak-this";

#[test]
fn publishes_a_complete_immutable_bundle() {
    let directory = TempDir::new().expect("tempdir");
    let outcome = fixture_outcome();
    let published = publish_report_bundle(&outcome, directory.path(), "verify-001")
        .expect("publish report bundle");

    assert_eq!(published.directory, directory.path().join("verify-001"));
    for path in [
        &published.result,
        &published.junit,
        &published.sarif,
        &published.artifact_manifest,
        &published.provenance,
    ] {
        assert!(path.is_file(), "missing published file: {}", path.display());
    }
    assert_eq!(
        fs::read(&published.junit).expect("JUnit bytes"),
        render_junit_xml(&outcome).expect("JUnit render").as_bytes()
    );
    assert_eq!(
        fs::read(&published.sarif).expect("SARIF bytes"),
        render_sarif_json(&outcome).expect("SARIF render")
    );
    assert_eq!(
        fs::read(&published.artifact_manifest).expect("artifact manifest bytes"),
        render_artifact_manifest_json(&outcome).expect("artifact manifest render")
    );
    assert_eq!(
        fs::read(&published.provenance).expect("provenance bytes"),
        render_provenance_json(&outcome).expect("provenance render")
    );
    let result: serde_json::Value =
        serde_json::from_slice(&fs::read(&published.result).expect("result bytes"))
            .expect("result JSON");
    assert_eq!(result["schema"], "fm.result.v1");
    assert_eq!(result["operation"], "verify");
    assert_eq!(result["command"]["program"], "npx");
    assert_eq!(result["command"]["argument_count"], 3);

    for path in [
        &published.result,
        &published.junit,
        &published.sarif,
        &published.artifact_manifest,
        &published.provenance,
    ] {
        let text = String::from_utf8(fs::read(path).expect("published report bytes"))
            .expect("published report UTF-8");
        assert!(
            !text.contains(SECRET),
            "{} leaked the fixture secret",
            path.display()
        );
        assert!(!text.contains("captured stdout"));
        assert!(!text.contains("captured stderr"));
        assert!(!text.contains("internal failure"));
    }

    let error = publish_report_bundle(&outcome, directory.path(), "verify-001")
        .expect_err("published bundle id must be immutable");
    assert!(error.to_string().contains("already"));
    assert_eq!(
        fs::read(&published.provenance).expect("unchanged provenance"),
        render_provenance_json(&outcome).expect("provenance render")
    );
}

#[test]
fn failure_before_rename_leaves_no_partial_bundle_or_reservation() {
    let directory = TempDir::new().expect("tempdir");
    let outcome = fixture_outcome();
    let error =
        publish_report_bundle_with_hook(&outcome, directory.path(), "failure-001", |step| {
            if step == PublishStep::Sarif {
                Err(io::Error::other("injected report publication failure"))
            } else {
                Ok(())
            }
        })
        .expect_err("injected failure must abort publication");
    assert!(error
        .to_string()
        .contains("injected report publication failure"));
    assert!(!directory.path().join("failure-001").exists());
    let names = fs::read_dir(directory.path())
        .expect("read root")
        .map(|entry| {
            entry
                .expect("entry")
                .file_name()
                .to_string_lossy()
                .into_owned()
        })
        .collect::<Vec<_>>();
    assert!(
        names.is_empty(),
        "partial publication state escaped cleanup: {names:?}"
    );
}

#[test]
fn concurrent_same_id_publication_has_one_winner() {
    let directory = TempDir::new().expect("tempdir");
    let root = directory.path().to_path_buf();
    let barrier = Arc::new(Barrier::new(3));
    let handles = (0..2)
        .map(|_| {
            let root = root.clone();
            let barrier = Arc::clone(&barrier);
            thread::spawn(move || {
                barrier.wait();
                publish_report_bundle(&fixture_outcome(), &root, "concurrent-001")
            })
        })
        .collect::<Vec<_>>();
    barrier.wait();
    let results = handles
        .into_iter()
        .map(|handle| handle.join().expect("publication thread"))
        .collect::<Vec<_>>();
    assert_eq!(results.iter().filter(|result| result.is_ok()).count(), 1);
    assert_eq!(results.iter().filter(|result| result.is_err()).count(), 1);
    assert!(root.join("concurrent-001/result.json").is_file());
    assert!(root.join("concurrent-001/provenance.json").is_file());
}

#[test]
fn cleanup_removes_only_old_abandoned_publication_state() {
    let directory = TempDir::new().expect("tempdir");
    let root = directory.path();
    fs::create_dir(root.join(".fm-report-staging-abandoned-1-1")).expect("staging dir");
    fs::write(root.join(".fm-report-reservation-orphan"), b"orphan").expect("orphan reservation");
    fs::write(root.join(".fm-report-reservation-published"), b"published")
        .expect("published reservation");
    fs::create_dir(root.join("published")).expect("published bundle");
    fs::write(root.join("foreign-file"), b"foreign").expect("foreign file");

    let report = cleanup_stale_publication_state(root, Duration::ZERO).expect("cleanup");
    assert_eq!(report.staging_directories_removed, 1);
    assert_eq!(report.reservations_removed, 1);
    assert!(!root.join(".fm-report-staging-abandoned-1-1").exists());
    assert!(!root.join(".fm-report-reservation-orphan").exists());
    assert!(root.join(".fm-report-reservation-published").exists());
    assert!(root.join("published").exists());
    assert!(root.join("foreign-file").exists());
}

#[test]
fn rejects_unsafe_bundle_ids_and_existing_destination_symlinks() {
    let directory = TempDir::new().expect("tempdir");
    let outcome = fixture_outcome();
    for bundle_id in ["", ".", "..", "../escape", "slash/value", "control\n"] {
        assert!(
            publish_report_bundle(&outcome, directory.path(), bundle_id).is_err(),
            "unsafe bundle id was accepted: {bundle_id:?}"
        );
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::symlink;
        let outside = TempDir::new().expect("outside tempdir");
        symlink(outside.path(), directory.path().join("symlinked-id"))
            .expect("destination symlink");
        let error = publish_report_bundle(&outcome, directory.path(), "symlinked-id")
            .expect_err("destination symlink must fail");
        assert!(error.to_string().contains("symlink"));
    }
}

#[cfg(unix)]
#[test]
fn rejects_a_symlinked_publication_root() {
    use std::os::unix::fs::symlink;

    let directory = TempDir::new().expect("tempdir");
    let outside = TempDir::new().expect("outside tempdir");
    let link = directory.path().join("bundle-root");
    symlink(outside.path(), &link).expect("root symlink");
    let error = publish_report_bundle(&fixture_outcome(), &link, "verify-001")
        .expect_err("symlinked root must fail");
    assert!(error.to_string().contains("symlink"));
    assert!(
        fs::read_dir(outside.path())
            .expect("outside directory")
            .next()
            .is_none(),
        "publisher wrote through a symlinked root"
    );
}

fn fixture_outcome() -> CommandOutcome {
    let resource_policy = ResourceProfile::ci_v1()
        .resolve(ResourceRequest {
            timeout_seconds: Some(9_000),
            ..ResourceRequest::absent()
        })
        .expect("CI policy");
    CommandOutcome {
        schema_version: 1,
        project: "publisher-project".to_owned(),
        model: "publisher-model".to_owned(),
        operation: "verify".to_owned(),
        program: "/usr/bin/npx".to_owned(),
        args: vec![
            "--yes".to_owned(),
            format!("--token={SECRET}"),
            "quint".to_owned(),
        ],
        resource_policy,
        success: true,
        timed_out: false,
        exit_code: Some(0),
        duration_millis: 321,
        stdout: format!("captured stdout {SECRET}"),
        stderr: format!("captured stderr {SECRET}"),
        stdout_truncated: false,
        stderr_truncated: false,
        adapter_response: None,
        failure: Some(format!("internal failure {SECRET}")),
        artifacts: CommandArtifacts {
            stdout: PathBuf::from(format!("/tmp/{SECRET}/stdout.log")),
            stderr: PathBuf::from(format!("/tmp/{SECRET}/stderr.log")),
            result: PathBuf::from(format!("/tmp/{SECRET}/result.json")),
            trace_pattern: Some(PathBuf::from(format!("/tmp/{SECRET}/trace-{{seq}}.json"))),
        },
    }
}
