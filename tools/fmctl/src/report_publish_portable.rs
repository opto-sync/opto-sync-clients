use std::io;
use std::path::Path;
use std::time::Duration;

use crate::error::FmError;
use crate::runner::CommandOutcome;

use super::{
    render_artifact_manifest_json, render_junit_xml, render_provenance_json, render_sarif_json,
    report_status, ArtifactEntry, ReportStatus,
};

#[path = "report_publish.rs"]
mod legacy;

pub use legacy::{
    cleanup_stale_publication_state, CleanupReport, PublishStep, PublishedReportBundle,
};

pub const MAX_REPORT_BUNDLE_ID_BYTES: usize = 128;

pub fn validate_report_bundle_id(bundle_id: &str) -> Result<(), FmError> {
    if bundle_id.is_empty() || bundle_id.len() > MAX_REPORT_BUNDLE_ID_BYTES {
        return invalid_bundle_id(bundle_id);
    }

    let reserved_basename = bundle_id.split('.').next().unwrap_or(bundle_id);
    if is_windows_device_basename(reserved_basename) {
        return Err(FmError::Validation(format!(
            "report bundle id uses a reserved Windows device basename: {bundle_id:?}"
        )));
    }

    let bytes = bundle_id.as_bytes();
    let first = bytes[0];
    let last = bytes[bytes.len() - 1];
    if !is_lower_ascii_alphanumeric(first)
        || !is_lower_ascii_alphanumeric(last)
        || !bytes
            .iter()
            .copied()
            .all(|byte| is_lower_ascii_alphanumeric(byte) || matches!(byte, b'-' | b'_'))
    {
        return invalid_bundle_id(bundle_id);
    }
    Ok(())
}

pub fn publish_report_bundle(
    outcome: &CommandOutcome,
    root: &Path,
    bundle_id: &str,
) -> Result<PublishedReportBundle, FmError> {
    validate_report_bundle_id(bundle_id)?;
    legacy::publish_report_bundle(outcome, root, bundle_id)
}

pub fn publish_report_bundle_with_hook<F>(
    outcome: &CommandOutcome,
    root: &Path,
    bundle_id: &str,
    hook: F,
) -> Result<PublishedReportBundle, FmError>
where
    F: FnMut(PublishStep) -> io::Result<()>,
{
    validate_report_bundle_id(bundle_id)?;
    legacy::publish_report_bundle_with_hook(outcome, root, bundle_id, hook)
}

fn is_lower_ascii_alphanumeric(byte: u8) -> bool {
    byte.is_ascii_lowercase() || byte.is_ascii_digit()
}

fn is_windows_device_basename(value: &str) -> bool {
    let lower = value.to_ascii_lowercase();
    if matches!(lower.as_str(), "con" | "prn" | "aux" | "nul" | "clock$") {
        return true;
    }
    let bytes = lower.as_bytes();
    bytes.len() == 4
        && matches!(bytes[3], b'1'..=b'9')
        && (bytes.starts_with(b"com") || bytes.starts_with(b"lpt"))
}

fn invalid_bundle_id<T>(bundle_id: &str) -> Result<T, FmError> {
    Err(FmError::Validation(format!(
        "invalid report bundle id {bundle_id:?}; use 1..={MAX_REPORT_BUNDLE_ID_BYTES} lower-case ASCII alphanumeric bytes with interior '-' or '_' only"
    )))
}

#[allow(dead_code)]
fn _cleanup_signature_check(root: &Path, minimum_age: Duration) -> Result<CleanupReport, FmError> {
    cleanup_stale_publication_state(root, minimum_age)
}
