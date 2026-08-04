use std::path::PathBuf;

use serde::Serialize;
use sha2::{Digest, Sha256};

use crate::error::FmError;
use crate::plan::Operation;
use crate::result::publish::{publish_report_bundle, PublishedReportBundle};
use crate::result::{
    render_artifact_manifest_json, render_junit_xml, render_provenance_json, render_sarif_json,
};
use crate::runner::CommandOutcome;
use crate::App;

/// One completed execution and the immutable report bundle published from the
/// exact same in-memory outcome.
#[derive(Debug, Clone, Serialize)]
pub struct PublishedExecution {
    pub outcome: CommandOutcome,
    pub bundle: PublishedReportBundle,
}

impl PublishedExecution {
    pub fn stable_exit_code(&self) -> u8 {
        self.outcome.stable_exit_code()
    }
}

impl App {
    /// Execute a configured operation and publish its complete report bundle.
    /// Planning, validation, doctor, init, and dry-run paths do not call this
    /// method and therefore cannot publish execution evidence.
    pub fn execute_with_report_bundle(
        &self,
        operation: &Operation,
    ) -> Result<PublishedExecution, FmError> {
        let outcome = self.execute(operation)?;
        let loaded = self.load()?;
        let bundle_root = loaded
            .resolve_output_path(&loaded.manifest.execution.artifacts_dir.join("bundles"))
            .map_err(FmError::report_publication)?;
        let bundle_id = deterministic_bundle_id(&outcome).map_err(FmError::report_publication)?;
        let bundle = publish_report_bundle(&outcome, &bundle_root, &bundle_id)
            .map_err(FmError::report_publication)?;
        Ok(PublishedExecution { outcome, bundle })
    }
}

/// Derive a content-addressed bundle id from the sanitized report surfaces.
/// Raw arguments, environment, stdout/stderr, source, and trace payloads are not
/// hashed because the report renderers intentionally exclude them.
pub fn deterministic_bundle_id(outcome: &CommandOutcome) -> Result<String, FmError> {
    let junit = render_junit_xml(outcome)?;
    let sarif = render_sarif_json(outcome)?;
    let artifacts = render_artifact_manifest_json(outcome)?;
    let provenance = render_provenance_json(outcome)?;

    let mut digest = Sha256::new();
    for payload in [
        junit.as_bytes(),
        sarif.as_slice(),
        artifacts.as_slice(),
        provenance.as_slice(),
    ] {
        digest.update(u64::try_from(payload.len()).unwrap_or(u64::MAX).to_be_bytes());
        digest.update(payload);
    }
    let digest = digest.finalize();
    let mut hex = String::with_capacity(digest.len() * 2);
    for byte in digest {
        use std::fmt::Write as _;
        write!(&mut hex, "{byte:02x}").expect("writing to String cannot fail");
    }

    Ok(format!("{}-{hex}", operation_component(&outcome.operation)))
}

fn operation_component(operation: &str) -> String {
    let value = operation
        .bytes()
        .map(|byte| {
            if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_') {
                char::from(byte)
            } else {
                '-'
            }
        })
        .take(48)
        .collect::<String>();
    if value.is_empty() {
        "operation".to_owned()
    } else {
        value
    }
}

pub fn bundle_root_for_artifacts(artifacts_dir: &std::path::Path) -> PathBuf {
    artifacts_dir.join("bundles")
}
