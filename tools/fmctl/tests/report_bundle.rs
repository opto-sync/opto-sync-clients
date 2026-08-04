use std::fs;
use std::path::PathBuf;
use std::process::Command;

use fmctl::plan::CommandArtifacts;
use fmctl::resource::{ResourceProfile, ResourceRequest};
use fmctl::result::report::{
    render_junit_xml, render_report_bundle, render_report_bundle_json, report_status, ReportStatus,
    ARTIFACT_MANIFEST_SCHEMA, PROVENANCE_SCHEMA, REPORT_BUNDLE_SCHEMA_VERSION,
};
use fmctl::runner::CommandOutcome;
use tempfile::TempDir;

const SECRET: &str = "do-not-publish-this-secret";

#[test]
fn report_bytes_are_deterministic_and_exclude_runtime_secrets() {
    let outcome = fixture_outcome(ReportStatus::Failed);
    let first = render_report_bundle_json(&outcome).expect("first report bundle");
    let second = render_report_bundle_json(&outcome).expect("second report bundle");
    assert_eq!(first, second);

    let text = String::from_utf8(first).expect("UTF-8 report bundle");
    assert!(!text.contains(SECRET), "report leaked a runtime secret");
    assert!(!text.contains("stdout payload"));
    assert!(!text.contains("stderr payload"));
    assert!(!text.contains("adapter mismatch payload"));
}

#[test]
fn every_format_carries_the_exact_effective_resource_policy() {
    let outcome = fixture_outcome(ReportStatus::TimedOut);
    let bundle = render_report_bundle(&outcome).expect("report bundle");
    let expected = serde_json::to_value(&outcome.resource_policy).expect("policy value");

    assert_eq!(bundle.schema_version, REPORT_BUNDLE_SCHEMA_VERSION);
    assert_eq!(bundle.artifact_manifest.schema, ARTIFACT_MANIFEST_SCHEMA);
    assert_eq!(bundle.provenance.schema, PROVENANCE_SCHEMA);
    assert_eq!(
        bundle.artifact_manifest.resource_policy,
        outcome.resource_policy
    );
    assert_eq!(bundle.provenance.resource_policy, outcome.resource_policy);
    assert_eq!(
        bundle.sarif["runs"][0]["properties"]["resourcePolicy"],
        expected
    );

    assert!(bundle
        .junit_xml
        .contains("name=\"fm.resource.profile\" value=\"ci\""));
    assert!(bundle
        .junit_xml
        .contains("name=\"fm.resource.effective.scalar.timeout_seconds\" value=\"7200\""));
    assert!(bundle
        .junit_xml
        .contains("name=\"fm.resource.clamped_fields\" value=\"[&quot;timeout_seconds&quot;]\""));
}

#[test]
fn junit_escapes_names_and_uses_content_free_failure_messages() {
    let mut outcome = fixture_outcome(ReportStatus::Failed);
    outcome.project = "project<&\"'".to_owned();
    outcome.model = "model<&\"'".to_owned();
    outcome.operation = "verify<&\"'".to_owned();
    let xml = render_junit_xml(&outcome).expect("JUnit XML");

    assert!(xml.contains("project&lt;&amp;&quot;&apos;"));
    assert!(xml.contains("model&lt;&amp;&quot;&apos;"));
    assert!(xml.contains("verify&lt;&amp;&quot;&apos;"));
    assert!(xml.contains("type=\"command_failure\""));
    assert!(!xml.contains(SECRET));
}

#[test]
fn success_failure_and_timeout_map_consistently() {
    for (status, expected_failure_type, expected_sarif_results) in [
        (ReportStatus::Passed, None, 0_usize),
        (ReportStatus::Failed, Some("command_failure"), 1_usize),
        (ReportStatus::TimedOut, Some("timeout"), 1_usize),
    ] {
        let outcome = fixture_outcome(status);
        assert_eq!(report_status(&outcome), status);
        let bundle = render_report_bundle(&outcome).expect("bundle");
        assert_eq!(bundle.artifact_manifest.status, status);
        assert_eq!(bundle.provenance.result.status, status);
        assert_eq!(
            bundle.sarif["runs"][0]["results"]
                .as_array()
                .expect("SARIF results")
                .len(),
            expected_sarif_results
        );
        let invocation = &bundle.sarif["runs"][0]["invocations"][0];
        if status == ReportStatus::TimedOut {
            assert!(invocation.get("exitCode").is_none());
        } else {
            assert_eq!(invocation["exitCode"], outcome.exit_code);
        }
        match expected_failure_type {
            Some(kind) => assert!(bundle.junit_xml.contains(&format!("type=\"{kind}\""))),
            None => assert!(!bundle.junit_xml.contains("<failure")),
        }
    }
}

#[test]
fn artifact_manifest_is_sorted_and_provenance_uses_sanitized_command_identity() {
    let outcome = fixture_outcome(ReportStatus::Passed);
    let bundle = render_report_bundle(&outcome).expect("bundle");
    let kinds = bundle
        .artifact_manifest
        .artifacts
        .iter()
        .map(|artifact| artifact.kind.as_str())
        .collect::<Vec<_>>();
    assert_eq!(kinds, ["result", "stderr", "stdout", "trace_pattern"]);
    assert_eq!(bundle.provenance.command.program, "npx");
    assert_eq!(bundle.provenance.command.argument_count, 3);
    assert!(bundle.provenance.input_hashes.is_empty());
    let paths = bundle
        .artifact_manifest
        .artifacts
        .iter()
        .map(|artifact| artifact.path.as_path())
        .collect::<Vec<_>>();
    assert_eq!(
        paths,
        [
            PathBuf::from("result.json"),
            PathBuf::from("stderr.log"),
            PathBuf::from("stdout.log"),
            PathBuf::from("trace-{seq}.json"),
        ]
    );
}

#[test]
fn unusual_program_identity_fails_closed_to_a_generic_name() {
    let mut outcome = fixture_outcome(ReportStatus::Passed);
    outcome.program = "/".to_owned();
    let bundle = render_report_bundle(&outcome).expect("bundle");
    assert_eq!(bundle.provenance.command.program, "program");
}

#[test]
fn report_utility_reads_result_json_and_emits_the_same_bundle() {
    let directory = TempDir::new().expect("tempdir");
    let result = directory.path().join("result.json");
    let outcome = fixture_outcome(ReportStatus::Passed);
    fs::write(
        &result,
        serde_json::to_vec_pretty(&outcome).expect("result JSON"),
    )
    .expect("write result JSON");

    let output = Command::new(env!("CARGO_BIN_EXE_fm-report-bundle"))
        .arg(&result)
        .arg("--format")
        .arg("bundle")
        .output()
        .expect("run report utility");
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let expected = render_report_bundle_json(&outcome).expect("expected bundle");
    assert_eq!(trim_newline(&output.stdout), expected);
}

#[test]
fn report_utility_rejects_directory_invalid_json_and_oversized_input() {
    let directory = TempDir::new().expect("tempdir");

    let directory_result = Command::new(env!("CARGO_BIN_EXE_fm-report-bundle"))
        .arg(directory.path())
        .output()
        .expect("run utility with directory");
    assert!(!directory_result.status.success());
    assert!(directory_result.stdout.is_empty());
    assert!(String::from_utf8_lossy(&directory_result.stderr).contains("regular file"));

    let invalid = directory.path().join("invalid.json");
    fs::write(&invalid, b"{} trailing").expect("write invalid JSON");
    let invalid_result = Command::new(env!("CARGO_BIN_EXE_fm-report-bundle"))
        .arg(&invalid)
        .output()
        .expect("run utility with invalid JSON");
    assert!(!invalid_result.status.success());
    assert!(invalid_result.stdout.is_empty());

    let oversized = directory.path().join("oversized.json");
    let file = fs::File::create(&oversized).expect("create sparse oversized input");
    file.set_len(64 * 1024 * 1024 + 1)
        .expect("size sparse oversized input");
    let oversized_result = Command::new(env!("CARGO_BIN_EXE_fm-report-bundle"))
        .arg(&oversized)
        .output()
        .expect("run utility with oversized input");
    assert!(!oversized_result.status.success());
    assert!(oversized_result.stdout.is_empty());
    assert!(String::from_utf8_lossy(&oversized_result.stderr).contains("exceeds"));
}

fn trim_newline(bytes: &[u8]) -> Vec<u8> {
    bytes.strip_suffix(b"\n").unwrap_or(bytes).to_vec()
}

fn fixture_outcome(status: ReportStatus) -> CommandOutcome {
    let resource_policy = ResourceProfile::ci_v1()
        .resolve(ResourceRequest {
            timeout_seconds: Some(9_000),
            ..ResourceRequest::absent()
        })
        .expect("CI policy");
    let (success, timed_out, exit_code) = match status {
        ReportStatus::Passed => (true, false, Some(0)),
        ReportStatus::Failed => (false, false, Some(7)),
        ReportStatus::TimedOut => (false, true, None),
    };
    CommandOutcome {
        schema_version: 1,
        project: "example-project".to_owned(),
        model: "example-model".to_owned(),
        operation: "verify".to_owned(),
        program: "/usr/bin/npx".to_owned(),
        args: vec![
            "--yes".to_owned(),
            format!("--token={SECRET}"),
            "quint".to_owned(),
        ],
        resource_policy,
        success,
        timed_out,
        exit_code,
        duration_millis: 1_234,
        stdout: format!("stdout payload {SECRET}"),
        stderr: format!("stderr payload {SECRET}"),
        stdout_truncated: false,
        stderr_truncated: true,
        adapter_response: None,
        failure: Some(format!("adapter mismatch payload {SECRET}")),
        artifacts: CommandArtifacts {
            stdout: PathBuf::from(format!("/tmp/{SECRET}/stdout.log")),
            stderr: PathBuf::from(format!("/tmp/{SECRET}/stderr.log")),
            result: PathBuf::from(format!("/tmp/{SECRET}/result.json")),
            trace_pattern: Some(PathBuf::from(format!("/tmp/{SECRET}/trace-{{seq}}.json"))),
        },
    }
}
