use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::{json, Value};

use crate::error::FmError;
use crate::plan::CommandArtifacts;
use crate::resource::EffectiveResourcePolicy;
use crate::runner::CommandOutcome;

pub const REPORT_BUNDLE_SCHEMA_VERSION: u32 = 1;
pub const ARTIFACT_MANIFEST_SCHEMA: &str = "fm.artifacts.v1";
pub const PROVENANCE_SCHEMA: &str = "fm.provenance.v1";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ReportStatus {
    Passed,
    Failed,
    TimedOut,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct ArtifactEntry {
    pub kind: String,
    pub path: PathBuf,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct ArtifactManifest {
    pub schema: String,
    pub schema_version: u32,
    pub project: String,
    pub model: String,
    pub operation: String,
    pub status: ReportStatus,
    pub artifacts: Vec<ArtifactEntry>,
    pub resource_policy: EffectiveResourcePolicy,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct CommandIdentity {
    pub program: String,
    pub argument_count: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct ResultEvidence {
    pub status: ReportStatus,
    pub success: bool,
    pub timed_out: bool,
    pub exit_code: Option<i32>,
    pub duration_millis: u64,
    pub stdout_truncated: bool,
    pub stderr_truncated: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct ProvenanceReport {
    pub schema: String,
    pub schema_version: u32,
    pub project: String,
    pub model: String,
    pub operation: String,
    pub command: CommandIdentity,
    pub result: ResultEvidence,
    pub input_hashes: BTreeMap<String, String>,
    pub resource_policy: EffectiveResourcePolicy,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct ReportBundle {
    pub schema_version: u32,
    pub junit_xml: String,
    pub sarif: Value,
    pub artifact_manifest: ArtifactManifest,
    pub provenance: ProvenanceReport,
}

pub fn render_report_bundle(outcome: &CommandOutcome) -> Result<ReportBundle, FmError> {
    Ok(ReportBundle {
        schema_version: REPORT_BUNDLE_SCHEMA_VERSION,
        junit_xml: render_junit_xml(outcome)?,
        sarif: render_sarif(outcome)?,
        artifact_manifest: artifact_manifest(outcome),
        provenance: provenance_report(outcome),
    })
}

pub fn render_report_bundle_json(outcome: &CommandOutcome) -> Result<Vec<u8>, FmError> {
    Ok(serde_json::to_vec_pretty(&render_report_bundle(outcome)?)?)
}

pub fn render_sarif_json(outcome: &CommandOutcome) -> Result<Vec<u8>, FmError> {
    Ok(serde_json::to_vec_pretty(&render_sarif(outcome)?)?)
}

pub fn render_artifact_manifest_json(outcome: &CommandOutcome) -> Result<Vec<u8>, FmError> {
    Ok(serde_json::to_vec_pretty(&artifact_manifest(outcome))?)
}

pub fn render_provenance_json(outcome: &CommandOutcome) -> Result<Vec<u8>, FmError> {
    Ok(serde_json::to_vec_pretty(&provenance_report(outcome))?)
}

pub fn render_junit_xml(outcome: &CommandOutcome) -> Result<String, FmError> {
    let status = report_status(outcome);
    let failures = usize::from(status != ReportStatus::Passed);
    let duration = seconds_text(outcome.duration_millis);
    let mut properties = resource_properties(&outcome.resource_policy)?;
    properties.insert("fm.project".to_owned(), outcome.project.clone());
    properties.insert("fm.model".to_owned(), outcome.model.clone());
    properties.insert("fm.operation".to_owned(), outcome.operation.clone());
    properties.insert("fm.status".to_owned(), status_text(status).to_owned());
    properties.insert(
        "fm.result.duration_millis".to_owned(),
        outcome.duration_millis.to_string(),
    );
    properties.insert(
        "fm.result.exit_code".to_owned(),
        outcome
            .exit_code
            .map_or_else(|| "null".to_owned(), |code| code.to_string()),
    );
    properties.insert(
        "fm.result.stdout_truncated".to_owned(),
        outcome.stdout_truncated.to_string(),
    );
    properties.insert(
        "fm.result.stderr_truncated".to_owned(),
        outcome.stderr_truncated.to_string(),
    );

    let mut xml = String::new();
    xml.push_str("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n");
    xml.push_str(&format!(
        "<testsuite name=\"fmctl\" tests=\"1\" failures=\"{failures}\" errors=\"0\" skipped=\"0\" time=\"{duration}\">\n"
    ));
    xml.push_str("  <properties>\n");
    for (name, value) in properties {
        xml.push_str(&format!(
            "    <property name=\"{}\" value=\"{}\"/>\n",
            xml_attribute(&name),
            xml_attribute(&value)
        ));
    }
    xml.push_str("  </properties>\n");
    xml.push_str(&format!(
        "  <testcase classname=\"fmctl.{}\" name=\"{}\" time=\"{duration}\">\n",
        xml_attribute(&outcome.model),
        xml_attribute(&outcome.operation)
    ));
    match status {
        ReportStatus::Passed => {}
        ReportStatus::Failed => {
            xml.push_str(
                "    <failure type=\"command_failure\" message=\"formal operation failed\"/>\n",
            );
        }
        ReportStatus::TimedOut => {
            xml.push_str(
                "    <failure type=\"timeout\" message=\"formal operation timed out\"/>\n",
            );
        }
    }
    xml.push_str("  </testcase>\n</testsuite>\n");
    Ok(xml)
}

pub fn report_status(outcome: &CommandOutcome) -> ReportStatus {
    if outcome.success {
        ReportStatus::Passed
    } else if outcome.timed_out {
        ReportStatus::TimedOut
    } else {
        ReportStatus::Failed
    }
}

fn render_sarif(outcome: &CommandOutcome) -> Result<Value, FmError> {
    let status = report_status(outcome);
    let policy = serde_json::to_value(&outcome.resource_policy)?;
    let results = if status == ReportStatus::Passed {
        Vec::new()
    } else {
        vec![json!({
            "ruleId": if status == ReportStatus::TimedOut {
                "fmctl.timeout"
            } else {
                "fmctl.command_failed"
            },
            "level": "error",
            "message": {
                "text": if status == ReportStatus::TimedOut {
                    "Formal operation timed out."
                } else {
                    "Formal operation failed."
                }
            },
            "properties": {
                "project": outcome.project,
                "model": outcome.model,
                "operation": outcome.operation,
                "status": status_text(status)
            }
        })]
    };
    Ok(json!({
        "$schema": "https://json.schemastore.org/sarif-2.1.0.json",
        "version": "2.1.0",
        "runs": [{
            "tool": {
                "driver": {
                    "name": "fmctl",
                    "version": env!("CARGO_PKG_VERSION"),
                    "informationUri": "https://github.com/opto-sync/opto-sync-clients"
                }
            },
            "invocations": [{
                "executionSuccessful": outcome.success,
                "exitCode": outcome.exit_code,
                "properties": {
                    "status": status_text(status),
                    "timedOut": outcome.timed_out,
                    "durationMillis": outcome.duration_millis,
                    "stdoutTruncated": outcome.stdout_truncated,
                    "stderrTruncated": outcome.stderr_truncated
                }
            }],
            "properties": {
                "project": outcome.project,
                "model": outcome.model,
                "operation": outcome.operation,
                "resourcePolicy": policy
            },
            "results": results
        }]
    }))
}

fn artifact_manifest(outcome: &CommandOutcome) -> ArtifactManifest {
    ArtifactManifest {
        schema: ARTIFACT_MANIFEST_SCHEMA.to_owned(),
        schema_version: REPORT_BUNDLE_SCHEMA_VERSION,
        project: outcome.project.clone(),
        model: outcome.model.clone(),
        operation: outcome.operation.clone(),
        status: report_status(outcome),
        artifacts: artifact_entries(&outcome.artifacts),
        resource_policy: outcome.resource_policy.clone(),
    }
}

fn provenance_report(outcome: &CommandOutcome) -> ProvenanceReport {
    ProvenanceReport {
        schema: PROVENANCE_SCHEMA.to_owned(),
        schema_version: REPORT_BUNDLE_SCHEMA_VERSION,
        project: outcome.project.clone(),
        model: outcome.model.clone(),
        operation: outcome.operation.clone(),
        command: CommandIdentity {
            program: command_name(&outcome.program),
            argument_count: outcome.args.len(),
        },
        result: ResultEvidence {
            status: report_status(outcome),
            success: outcome.success,
            timed_out: outcome.timed_out,
            exit_code: outcome.exit_code,
            duration_millis: outcome.duration_millis,
            stdout_truncated: outcome.stdout_truncated,
            stderr_truncated: outcome.stderr_truncated,
        },
        input_hashes: BTreeMap::new(),
        resource_policy: outcome.resource_policy.clone(),
    }
}

fn artifact_entries(artifacts: &CommandArtifacts) -> Vec<ArtifactEntry> {
    let mut entries = vec![
        ArtifactEntry {
            kind: "result".to_owned(),
            path: artifacts.result.clone(),
        },
        ArtifactEntry {
            kind: "stderr".to_owned(),
            path: artifacts.stderr.clone(),
        },
        ArtifactEntry {
            kind: "stdout".to_owned(),
            path: artifacts.stdout.clone(),
        },
    ];
    if let Some(path) = &artifacts.trace_pattern {
        entries.push(ArtifactEntry {
            kind: "trace_pattern".to_owned(),
            path: path.clone(),
        });
    }
    entries.sort_by(|left, right| left.kind.cmp(&right.kind));
    entries
}

fn resource_properties(
    resource_policy: &EffectiveResourcePolicy,
) -> Result<BTreeMap<String, String>, FmError> {
    let mut properties = BTreeMap::new();
    flatten_json(
        "fm.resource",
        &serde_json::to_value(resource_policy)?,
        &mut properties,
    )?;
    Ok(properties)
}

fn flatten_json(
    prefix: &str,
    value: &Value,
    properties: &mut BTreeMap<String, String>,
) -> Result<(), FmError> {
    match value {
        Value::Object(object) => {
            for (key, value) in object {
                flatten_json(&format!("{prefix}.{key}"), value, properties)?;
            }
        }
        Value::Array(_) => {
            properties.insert(prefix.to_owned(), serde_json::to_string(value)?);
        }
        Value::Null => {
            properties.insert(prefix.to_owned(), "null".to_owned());
        }
        Value::Bool(value) => {
            properties.insert(prefix.to_owned(), value.to_string());
        }
        Value::Number(value) => {
            properties.insert(prefix.to_owned(), value.to_string());
        }
        Value::String(value) => {
            properties.insert(prefix.to_owned(), value.clone());
        }
    }
    Ok(())
}

fn command_name(program: &str) -> String {
    Path::new(program)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or(program)
        .to_owned()
}

fn status_text(status: ReportStatus) -> &'static str {
    match status {
        ReportStatus::Passed => "passed",
        ReportStatus::Failed => "failed",
        ReportStatus::TimedOut => "timed_out",
    }
}

fn seconds_text(duration_millis: u64) -> String {
    format!("{}.{:03}", duration_millis / 1000, duration_millis % 1000)
}

fn xml_attribute(value: &str) -> String {
    let mut escaped = String::with_capacity(value.len());
    for character in value.chars() {
        match character {
            '&' => escaped.push_str("&amp;"),
            '<' => escaped.push_str("&lt;"),
            '>' => escaped.push_str("&gt;"),
            '"' => escaped.push_str("&quot;"),
            '\'' => escaped.push_str("&apos;"),
            character => escaped.push(character),
        }
    }
    escaped
}
