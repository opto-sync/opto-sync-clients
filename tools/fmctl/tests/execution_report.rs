#![cfg(unix)]

use std::fs;
use std::io::Cursor;
use std::os::unix::fs::{symlink, PermissionsExt};
use std::path::{Path, PathBuf};
use std::process::Command;

use fmctl::error::FmError;
use fmctl::execution_report::deterministic_bundle_id;
use fmctl::plan::Operation;
use fmctl::{rpc, App, InitRequest};
use serde_json::Value;
use tempfile::TempDir;

#[test]
fn cli_execution_publishes_complete_bundle_and_json_envelope() {
    let fixture = Fixture::new();
    let output = Command::new(env!("CARGO_BIN_EXE_fmctl"))
        .current_dir(fixture.directory.path())
        .args(["--format", "json", "check"])
        .output()
        .expect("run fmctl");
    assert!(
        output.status.success(),
        "stderr: {}",
        String::from_utf8_lossy(&output.stderr)
    );

    let envelope: Value = serde_json::from_slice(&output.stdout).expect("CLI JSON envelope");
    assert_eq!(envelope["outcome"]["operation"], "check");
    assert_eq!(envelope["outcome"]["success"], true);
    let directory = PathBuf::from(
        envelope["bundle"]["directory"]
            .as_str()
            .expect("bundle dir"),
    );
    assert_complete_bundle(&directory);
}

#[test]
fn rpc_execution_returns_the_same_published_execution_shape() {
    let fixture = Fixture::new();
    let input = Cursor::new(
        b"{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"fm.check\"}\n{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"fm.shutdown\"}\n",
    );
    let mut output = Vec::new();
    rpc::run_server(fixture.app, input, &mut output).expect("RPC server");
    let lines = String::from_utf8(output).expect("RPC UTF-8");
    let response: Value =
        serde_json::from_str(lines.lines().next().expect("first response")).expect("RPC response");
    assert_eq!(response["result"]["kind"], "execution");
    assert_eq!(
        response["result"]["execution"]["outcome"]["operation"],
        "check"
    );
    let directory = PathBuf::from(
        response["result"]["execution"]["bundle"]["directory"]
            .as_str()
            .expect("bundle dir"),
    );
    assert_complete_bundle(&directory);
}

#[test]
fn dry_run_does_not_publish_execution_reports() {
    let fixture = Fixture::new();
    let output = Command::new(env!("CARGO_BIN_EXE_fmctl"))
        .current_dir(fixture.directory.path())
        .args(["--format", "json", "--dry-run", "check"])
        .output()
        .expect("run dry-run fmctl");
    assert!(output.status.success());
    assert!(!fixture
        .directory
        .path()
        .join(".formal-artifacts/fmctl/bundles")
        .exists());
}

#[test]
fn publication_failure_has_a_distinct_exit_classification() {
    let fixture = Fixture::new();
    let artifacts = fixture.directory.path().join(".formal-artifacts/fmctl");
    fs::create_dir_all(&artifacts).expect("artifacts");
    let outside = TempDir::new().expect("outside");
    symlink(outside.path(), artifacts.join("bundles")).expect("symlink bundle root");

    let error = fixture
        .app
        .execute_with_report_bundle(&Operation::Check)
        .expect_err("symlinked publication root must fail");
    assert!(matches!(error, FmError::ReportPublication(_)));
    assert_eq!(error.exit_code(), 6);
}

#[test]
fn deterministic_bundle_id_is_stable_for_the_same_sanitized_outcome() {
    let fixture = Fixture::new();
    let execution = fixture
        .app
        .execute_with_report_bundle(&Operation::Check)
        .expect("published execution");
    let first = deterministic_bundle_id(&execution.outcome).expect("first id");
    let second = deterministic_bundle_id(&execution.outcome).expect("second id");
    assert_eq!(first, second);
    assert_eq!(first, execution.bundle.bundle_id);
    assert!(!first.contains("secret"));
}

#[test]
fn trace_validation_failure_still_publishes_a_complete_bundle() {
    let fixture = Fixture::new();
    let execution = fixture
        .app
        .execute_with_report_bundle(&Operation::Trace { output: None })
        .expect("semantic trace failure still publishes");
    assert!(!execution.outcome.success);
    assert_eq!(execution.stable_exit_code(), 2);
    assert!(execution
        .outcome
        .failure
        .as_deref()
        .is_some_and(|failure| failure.contains("expected 8")));
    assert_complete_bundle(&execution.bundle.directory);

    let legacy = fixture.app.execute(&Operation::Trace { output: None });
    assert!(matches!(legacy, Err(FmError::Validation(_))));
}

#[test]
fn execution_uses_the_planned_artifact_root_if_the_manifest_changes_mid_run() {
    let fixture = Fixture::new();
    let script = fixture.directory.path().join("formal/fake-npx.sh");
    fs::write(
        &script,
        "#!/bin/sh\nprintf 'invalid = [' > formal/fm.toml\nprintf 'fake verifier passed\\n'\n",
    )
    .expect("rewrite fake verifier");
    let mut permissions = fs::metadata(&script)
        .expect("script metadata")
        .permissions();
    permissions.set_mode(0o700);
    fs::set_permissions(&script, permissions).expect("script permissions");

    let execution = fixture
        .app
        .execute_with_report_bundle(&Operation::Check)
        .expect("bundle root comes from the executed plan");
    assert_complete_bundle(&execution.bundle.directory);
    let canonical_workspace =
        fs::canonicalize(fixture.directory.path()).expect("canonical fixture workspace");
    assert!(execution
        .bundle
        .directory
        .starts_with(canonical_workspace.join(".formal-artifacts/fmctl/bundles")));
}

#[test]
fn public_result_changes_change_the_content_address() {
    let fixture = Fixture::new();
    let execution = fixture
        .app
        .execute_with_report_bundle(&Operation::Check)
        .expect("published execution");
    let mut changed = execution.outcome.clone();
    changed.duration_millis = changed.duration_millis.saturating_add(1);
    let original = deterministic_bundle_id(&execution.outcome).expect("original id");
    let changed = deterministic_bundle_id(&changed).expect("changed id");
    assert_ne!(original, changed);
}

fn assert_complete_bundle(directory: &Path) {
    for name in [
        "result.json",
        "junit.xml",
        "sarif.json",
        "artifacts.json",
        "provenance.json",
    ] {
        let path = directory.join(name);
        assert!(path.is_file(), "missing {}", path.display());
        assert!(fs::metadata(path).expect("metadata").len() > 0);
    }
}

struct Fixture {
    directory: TempDir,
    app: App,
}

impl Fixture {
    fn new() -> Self {
        let directory = TempDir::new().expect("workspace");
        let app = App::new(directory.path(), "formal/fm.toml");
        app.init(&InitRequest {
            project: "example".to_owned(),
            model: "counter".to_owned(),
            spec: PathBuf::from("formal/counter.qnt"),
            main: "counter".to_owned(),
            force: false,
        })
        .expect("init");

        let script = directory.path().join("formal/fake-npx.sh");
        fs::write(&script, "#!/bin/sh\nprintf 'fake verifier passed\\n'\n").expect("script");
        let mut permissions = fs::metadata(&script)
            .expect("script metadata")
            .permissions();
        permissions.set_mode(0o700);
        fs::set_permissions(&script, permissions).expect("script permissions");

        let manifest_path = directory.path().join("formal/fm.toml");
        let manifest = fs::read_to_string(&manifest_path)
            .expect("manifest")
            .replace("npx = \"npx\"", "npx = \"./formal/fake-npx.sh\"");
        fs::write(manifest_path, manifest).expect("rewrite manifest");
        app.validate().expect("validate fixture");

        Self { directory, app }
    }
}
