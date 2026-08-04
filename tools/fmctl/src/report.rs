use std::collections::BTreeMap;
use std::fmt::Write as _;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::resource::{EffectiveResourcePolicy, ResourceRequest, ResourceValues};

pub const POLICY_REPORT_SCHEMA_VERSION: u32 = 1;
pub const POLICY_REPORT_VERSION: &str = "fm.policy-reports.v1";
pub const SARIF_SCHEMA: &str =
    "https://json.schemastore.org/sarif-2.1.0.json";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ReportStatus {
    Passed,
    Failed,
    TimedOut,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ReportArtifacts {
    pub stdout: PathBuf,
    pub stderr: PathBuf,
    pub result: PathBuf,
    #[serde(default)]
    pub traces: Vec<PathBuf>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PolicyReportInput {
    pub schema_version: u32,
    pub report_version: String,
    pub project: String,
    pub model: String,
    pub operation: String,
    pub status: ReportStatus,
    pub duration_millis: u64,
    pub exit_code: Option<i32>,
    pub command_sha256: String,
    pub manifest_sha256: Option<String>,
    pub model_sha256: Option<String>,
    pub source_revision: Option<String>,
    pub resource_policy: EffectiveResourcePolicy,
    pub artifacts: ReportArtifacts,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PolicyReportBundle {
    pub junit_xml: String,
    pub sarif_json: Vec<u8>,
    pub artifact_manifest_json: Vec<u8>,
    pub provenance_json: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
struct ArtifactManifest<'a> {
    schema_version: u32,
    report_version: &'a str,
    project: &'a str,
    model: &'a str,
    operation: &'a str,
    status: &'a ReportStatus,
    artifacts: &'a ReportArtifacts,
    resource_policy: &'a EffectiveResourcePolicy,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
struct Provenance<'a> {
    schema_version: u32,
    report_version: &'a str,
    project: &'a str,
    model: &'a str,
    operation: &'a str,
    status: &'a ReportStatus,
    duration_millis: u64,
    exit_code: Option<i32>,
    command_sha256: &'a str,
    manifest_sha256: Option<&'a str>,
    model_sha256: Option<&'a str>,
    source_revision: Option<&'a str>,
    resource_policy: &'a EffectiveResourcePolicy,
}

impl PolicyReportInput {
    pub fn validate(&self) -> Result<(), String> {
        if self.schema_version != POLICY_REPORT_SCHEMA_VERSION {
            return Err(format!(
                "unsupported policy report schema version {}",
                self.schema_version
            ));
        }
        if self.report_version != POLICY_REPORT_VERSION {
            return Err(format!(
                "unsupported policy report version {:?}",
                self.report_version
            ));
        }
        for (label, value, maximum) in [
            ("project", self.project.as_str(), 256_usize),
            ("model", self.model.as_str(), 256),
            ("operation", self.operation.as_str(), 128),
        ] {
            validate_label(label, value, maximum)?;
        }
        validate_sha256("command_sha256", &self.command_sha256)?;
        for (label, value) in [
            ("manifest_sha256", self.manifest_sha256.as_deref()),
            ("model_sha256", self.model_sha256.as_deref()),
        ] {
            if let Some(value) = value {
                validate_sha256(label, value)?;
            }
        }
        if let Some(revision) = &self.source_revision {
            validate_label("source_revision", revision, 256)?;
        }
        validate_artifact_path("stdout", &self.artifacts.stdout)?;
        validate_artifact_path("stderr", &self.artifacts.stderr)?;
        validate_artifact_path("result", &self.artifacts.result)?;
        if self.artifacts.traces.len() > 10_000 {
            return Err("artifacts.traces must contain at most 10000 paths".to_owned());
        }
        for trace in &self.artifacts.traces {
            validate_artifact_path("trace", trace)?;
        }
        Ok(())
    }

    pub fn render_bundle(&self) -> Result<PolicyReportBundle, String> {
        self.validate()?;
        Ok(PolicyReportBundle {
            junit_xml: render_junit(self),
            sarif_json: render_sarif(self)?,
            artifact_manifest_json: render_artifact_manifest(self)?,
            provenance_json: render_provenance(self)?,
        })
    }
}

pub fn render_junit(input: &PolicyReportInput) -> String {
    let properties = policy_properties(input);
    let testsuite_name = format!("fmctl.{}", input.operation);
    let testcase_name = format!("{}.{}", input.project, input.model);
    let time = format_duration_seconds(input.duration_millis);
    let failures = usize::from(input.status != ReportStatus::Passed);

    let mut xml = String::new();
    writeln!(&mut xml, "<?xml version=\"1.0\" encoding=\"UTF-8\"?>").unwrap();
    writeln!(
        &mut xml,
        "<testsuite name=\"{}\" tests=\"1\" failures=\"{}\" errors=\"0\" time=\"{}\">",
        escape_xml(&testsuite_name),
        failures,
        time
    )
    .unwrap();
    writeln!(&mut xml, "  <properties>").unwrap();
    for (name, value) in properties {
        writeln!(
            &mut xml,
            "    <property name=\"{}\" value=\"{}\"/>",
            escape_xml(&name),
            escape_xml(&value)
        )
        .unwrap();
    }
    writeln!(&mut xml, "  </properties>").unwrap();
    writeln!(
        &mut xml,
        "  <testcase classname=\"{}\" name=\"{}\" time=\"{}\">",
        escape_xml(&input.project),
        escape_xml(&testcase_name),
        time
    )
    .unwrap();
    match input.status {
        ReportStatus::Passed => {}
        ReportStatus::Failed => {
            writeln!(
                &mut xml,
                "    <failure message=\"formal operation failed\" type=\"fmctl.failure\"/>"
            )
            .unwrap();
        }
        ReportStatus::TimedOut => {
            writeln!(
                &mut xml,
                "    <failure message=\"formal operation timed out\" type=\"fmctl.timeout\"/>"
            )
            .unwrap();
        }
    }
    writeln!(&mut xml, "  </testcase>").unwrap();
    writeln!(&mut xml, "</testsuite>").unwrap();
    xml
}

pub fn render_sarif(input: &PolicyReportInput) -> Result<Vec<u8>, String> {
    let level = if input.status == ReportStatus::Passed {
        "none"
    } else {
        "error"
    };
    let message = match input.status {
        ReportStatus::Passed => "formal operation passed",
        ReportStatus::Failed => "formal operation failed",
        ReportStatus::TimedOut => "formal operation timed out",
    };
    let result = serde_json::json!({
        "ruleId": format!("fmctl.{}", input.operation),
        "level": level,
        "message": {"text": message},
        "properties": {
            "project": input.project,
            "model": input.model,
            "status": input.status,
            "durationMillis": input.duration_millis,
            "exitCode": input.exit_code,
            "resourcePolicy": input.resource_policy,
        }
    });
    let document = serde_json::json!({
        "$schema": SARIF_SCHEMA,
        "version": "2.1.0",
        "runs": [{
            "tool": {
                "driver": {
                    "name": "fmctl",
                    "informationUri": "https://github.com/opto-sync/opto-sync-clients",
                    "rules": [{
                        "id": format!("fmctl.{}", input.operation),
                        "name": input.operation,
                        "shortDescription": {"text": "Formal-methods operation result"}
                    }]
                }
            },
            "invocations": [{
                "executionSuccessful": input.status == ReportStatus::Passed,
                "properties": {
                    "resourcePolicy": input.resource_policy,
                    "commandSha256": input.command_sha256,
                    "manifestSha256": input.manifest_sha256,
                    "modelSha256": input.model_sha256,
                    "sourceRevision": input.source_revision,
                }
            }],
            "results": [result],
            "properties": {
                "schemaVersion": POLICY_REPORT_SCHEMA_VERSION,
                "reportVersion": POLICY_REPORT_VERSION,
                "resourcePolicy": input.resource_policy,
            }
        }]
    });
    serde_json::to_vec(&document).map_err(|error| error.to_string())
}

pub fn render_artifact_manifest(input: &PolicyReportInput) -> Result<Vec<u8>, String> {
    serde_json::to_vec(&ArtifactManifest {
        schema_version: POLICY_REPORT_SCHEMA_VERSION,
        report_version: POLICY_REPORT_VERSION,
        project: &input.project,
        model: &input.model,
        operation: &input.operation,
        status: &input.status,
        artifacts: &input.artifacts,
        resource_policy: &input.resource_policy,
    })
    .map_err(|error| error.to_string())
}

pub fn render_provenance(input: &PolicyReportInput) -> Result<Vec<u8>, String> {
    serde_json::to_vec(&Provenance {
        schema_version: POLICY_REPORT_SCHEMA_VERSION,
        report_version: POLICY_REPORT_VERSION,
        project: &input.project,
        model: &input.model,
        operation: &input.operation,
        status: &input.status,
        duration_millis: input.duration_millis,
        exit_code: input.exit_code,
        command_sha256: &input.command_sha256,
        manifest_sha256: input.manifest_sha256.as_deref(),
        model_sha256: input.model_sha256.as_deref(),
        source_revision: input.source_revision.as_deref(),
        resource_policy: &input.resource_policy,
    })
    .map_err(|error| error.to_string())
}

fn policy_properties(input: &PolicyReportInput) -> BTreeMap<String, String> {
    let mut properties = BTreeMap::new();
    properties.insert(
        "fm.report.schema_version".to_owned(),
        POLICY_REPORT_SCHEMA_VERSION.to_string(),
    );
    properties.insert(
        "fm.report.version".to_owned(),
        POLICY_REPORT_VERSION.to_owned(),
    );
    properties.insert(
        "fm.policy.schema_version".to_owned(),
        input.resource_policy.schema_version.to_string(),
    );
    properties.insert(
        "fm.policy.version".to_owned(),
        input.resource_policy.policy_version.clone(),
    );
    properties.insert(
        "fm.policy.profile".to_owned(),
        serde_json::to_value(input.resource_policy.profile)
            .unwrap()
            .as_str()
            .unwrap()
            .to_owned(),
    );
    properties.insert(
        "fm.policy.overage_behavior".to_owned(),
        serde_json::to_value(input.resource_policy.overage_behavior)
            .unwrap()
            .as_str()
            .unwrap()
            .to_owned(),
    );
    append_request_properties(
        &mut properties,
        "fm.policy.requested",
        &input.resource_policy.requested,
    );
    append_values_properties(
        &mut properties,
        "fm.policy.defaults",
        &input.resource_policy.policy_defaults,
    );
    append_values_properties(
        &mut properties,
        "fm.policy.maximum",
        &input.resource_policy.policy_maximum.scalar,
    );
    properties.insert(
        "fm.policy.maximum.max_simulation_work".to_owned(),
        input
            .resource_policy
            .policy_maximum
            .max_simulation_work
            .to_string(),
    );
    properties.insert(
        "fm.policy.maximum.max_trace_work".to_owned(),
        input.resource_policy.policy_maximum.max_trace_work.to_string(),
    );
    append_values_properties(
        &mut properties,
        "fm.policy.effective",
        &input.resource_policy.effective.scalar,
    );
    properties.insert(
        "fm.policy.effective.simulation_work".to_owned(),
        input.resource_policy.effective.simulation_work.to_string(),
    );
    properties.insert(
        "fm.policy.effective.trace_count_work".to_owned(),
        input.resource_policy.effective.trace_count_work.to_string(),
    );
    properties.insert(
        "fm.policy.effective.trace_sample_work".to_owned(),
        input.resource_policy.effective.trace_sample_work.to_string(),
    );
    properties.insert(
        "fm.policy.inherited_fields".to_owned(),
        serde_json::to_string(&input.resource_policy.inherited_fields).unwrap(),
    );
    properties.insert(
        "fm.policy.clamped_fields".to_owned(),
        serde_json::to_string(&input.resource_policy.clamped_fields).unwrap(),
    );
    properties.insert("fm.command.sha256".to_owned(), input.command_sha256.clone());
    properties
}

fn append_request_properties(
    properties: &mut BTreeMap<String, String>,
    prefix: &str,
    request: &ResourceRequest,
) {
    for (field, value) in [
        ("timeout_seconds", request.timeout_seconds),
        ("max_output_bytes", request.max_output_bytes),
        ("simulation_max_samples", request.simulation_max_samples),
        ("simulation_max_steps", request.simulation_max_steps),
        ("verification_max_steps", request.verification_max_steps),
        ("trace_count", request.trace_count),
        ("trace_max_steps", request.trace_max_steps),
        ("trace_max_samples", request.trace_max_samples),
    ] {
        properties.insert(
            format!("{prefix}.{field}"),
            value
                .map(|value| value.to_string())
                .unwrap_or_else(|| "<inherit>".to_owned()),
        );
    }
}

fn append_values_properties(
    properties: &mut BTreeMap<String, String>,
    prefix: &str,
    values: &ResourceValues,
) {
    for (field, value) in [
        ("timeout_seconds", values.timeout_seconds),
        ("max_output_bytes", values.max_output_bytes),
        ("simulation_max_samples", values.simulation_max_samples),
        ("simulation_max_steps", values.simulation_max_steps),
        ("verification_max_steps", values.verification_max_steps),
        ("trace_count", values.trace_count),
        ("trace_max_steps", values.trace_max_steps),
        ("trace_max_samples", values.trace_max_samples),
    ] {
        properties.insert(format!("{prefix}.{field}"), value.to_string());
    }
}

fn validate_label(label: &str, value: &str, maximum: usize) -> Result<(), String> {
    if value.trim().is_empty() {
        return Err(format!("{label} must not be empty"));
    }
    if value.len() > maximum {
        return Err(format!("{label} must be at most {maximum} bytes"));
    }
    if value.chars().any(char::is_control) {
        return Err(format!("{label} must not contain control characters"));
    }
    Ok(())
}

fn validate_sha256(label: &str, value: &str) -> Result<(), String> {
    let digest = value
        .strip_prefix("sha256:")
        .ok_or_else(|| format!("{label} must use sha256:<hex>"))?;
    if digest.len() != 64
        || !digest
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(format!(
            "{label} must contain exactly 64 lowercase hexadecimal digits"
        ));
    }
    Ok(())
}

fn validate_artifact_path(label: &str, path: &std::path::Path) -> Result<(), String> {
    let value = path
        .to_str()
        .ok_or_else(|| format!("{label} artifact path must be UTF-8"))?;
    validate_label(&format!("{label} artifact path"), value, 4096)
}

fn escape_xml(value: &str) -> String {
    let mut escaped = String::with_capacity(value.len());
    for character in value.chars() {
        match character {
            '&' => escaped.push_str("&amp;"),
            '<' => escaped.push_str("&lt;"),
            '>' => escaped.push_str("&gt;"),
            '"' => escaped.push_str("&quot;"),
            '\'' => escaped.push_str("&apos;"),
            _ => escaped.push(character),
        }
    }
    escaped
}

fn format_duration_seconds(duration_millis: u64) -> String {
    format!("{}.{:03}", duration_millis / 1000, duration_millis % 1000)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::resource::{ResourceProfile, ResourceRequest};

    fn fixture(status: ReportStatus) -> PolicyReportInput {
        let policy = ResourceProfile::service_v1()
            .resolve(ResourceRequest {
                timeout_seconds: Some(1_000),
                max_output_bytes: None,
                simulation_max_samples: Some(10),
                simulation_max_steps: Some(20),
                verification_max_steps: None,
                trace_count: Some(2),
                trace_max_steps: Some(3),
                trace_max_samples: Some(4),
            })
            .expect("policy");
        PolicyReportInput {
            schema_version: POLICY_REPORT_SCHEMA_VERSION,
            report_version: POLICY_REPORT_VERSION.to_owned(),
            project: "project<&\"".to_owned(),
            model: "model'one".to_owned(),
            operation: "verify".to_owned(),
            status,
            duration_millis: 1_234,
            exit_code: Some(1),
            command_sha256: format!("sha256:{}", "1".repeat(64)),
            manifest_sha256: Some(format!("sha256:{}", "2".repeat(64))),
            model_sha256: Some(format!("sha256:{}", "3".repeat(64))),
            source_revision: Some("abc123".to_owned()),
            resource_policy: policy,
            artifacts: ReportArtifacts {
                stdout: PathBuf::from("artifacts/stdout.log"),
                stderr: PathBuf::from("artifacts/stderr.log"),
                result: PathBuf::from("artifacts/result.json"),
                traces: vec![PathBuf::from("artifacts/trace-0.json")],
            },
        }
    }

    #[test]
    fn all_formats_are_deterministic_and_secret_free() {
        let input = fixture(ReportStatus::Failed);
        let first = input.render_bundle().expect("first bundle");
        let second = input.render_bundle().expect("second bundle");
        assert_eq!(first, second);
        for bytes in [
            first.junit_xml.as_bytes(),
            &first.sarif_json,
            &first.artifact_manifest_json,
            &first.provenance_json,
        ] {
            let text = String::from_utf8_lossy(bytes);
            assert!(!text.contains("secret"));
            assert!(!text.contains("token"));
            assert!(!text.contains("stdout contents"));
        }
    }

    #[test]
    fn junit_escapes_labels_and_reports_timeout_as_failure() {
        let xml = render_junit(&fixture(ReportStatus::TimedOut));
        assert!(xml.contains("project&lt;&amp;&quot;"));
        assert!(xml.contains("model&apos;one"));
        assert!(xml.contains("fmctl.timeout"));
        assert!(xml.contains("fm.policy.effective.timeout_seconds"));
        assert!(xml.contains("time=\"1.234\""));
    }

    #[test]
    fn policy_values_agree_across_json_formats_and_junit() {
        let input = fixture(ReportStatus::Passed);
        let bundle = input.render_bundle().expect("bundle");
        let effective_timeout = input
            .resource_policy
            .effective
            .scalar
            .timeout_seconds;
        assert!(bundle.junit_xml.contains(&format!(
            "name=\"fm.policy.effective.timeout_seconds\" value=\"{effective_timeout}\""
        )));

        let sarif: Value = serde_json::from_slice(&bundle.sarif_json).expect("SARIF");
        let artifact: Value =
            serde_json::from_slice(&bundle.artifact_manifest_json).expect("artifact manifest");
        let provenance: Value =
            serde_json::from_slice(&bundle.provenance_json).expect("provenance");
        assert_eq!(
            sarif["runs"][0]["properties"]["resourcePolicy"]["effective"]["scalar"]
                ["timeout_seconds"],
            effective_timeout
        );
        assert_eq!(
            artifact["resource_policy"]["effective"]["scalar"]["timeout_seconds"],
            effective_timeout
        );
        assert_eq!(
            provenance["resource_policy"]["effective"]["scalar"]["timeout_seconds"],
            effective_timeout
        );
    }

    #[test]
    fn success_failure_and_timeout_have_stable_status_mappings() {
        for (status, expected_level, expected_failures) in [
            (ReportStatus::Passed, "none", "failures=\"0\""),
            (ReportStatus::Failed, "error", "failures=\"1\""),
            (ReportStatus::TimedOut, "error", "failures=\"1\""),
        ] {
            let input = fixture(status);
            let bundle = input.render_bundle().expect("bundle");
            let sarif: Value = serde_json::from_slice(&bundle.sarif_json).expect("SARIF");
            assert_eq!(sarif["runs"][0]["results"][0]["level"], expected_level);
            assert!(bundle.junit_xml.contains(expected_failures));
        }
    }

    #[test]
    fn validation_rejects_bad_hashes_and_oversized_trace_lists() {
        let mut input = fixture(ReportStatus::Passed);
        input.command_sha256 = "not-a-hash".to_owned();
        assert!(input.validate().unwrap_err().contains("sha256"));

        let mut input = fixture(ReportStatus::Passed);
        input.artifacts.traces = vec![PathBuf::from("trace.json"); 10_001];
        assert!(input.validate().unwrap_err().contains("at most 10000"));
    }
}
