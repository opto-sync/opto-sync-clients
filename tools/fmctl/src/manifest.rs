use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Component, Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::FmError;

pub const MANIFEST_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Manifest {
    pub schema_version: u32,
    pub project: String,
    pub model: String,
    pub language: SpecLanguage,
    pub spec: PathBuf,
    pub main: String,
    pub init: String,
    pub step: String,
    #[serde(default)]
    pub invariants: Vec<String>,
    #[serde(default)]
    pub witnesses: Vec<String>,
    pub toolchain: ToolchainConfig,
    #[serde(default)]
    pub execution: ExecutionConfig,
    pub simulation: Option<SimulationConfig>,
    pub verification: Option<VerificationConfig>,
    pub traces: Option<TraceConfig>,
    #[serde(default)]
    pub adapters: BTreeMap<String, AdapterConfig>,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SpecLanguage {
    Quint,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ToolchainConfig {
    pub quint: String,
    pub java: String,
    #[serde(default = "default_npx_program")]
    pub npx: String,
}

fn default_npx_program() -> String {
    "npx".to_owned()
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ExecutionConfig {
    #[serde(default = "default_timeout_seconds")]
    pub timeout_seconds: u64,
    #[serde(default = "default_max_output_bytes")]
    pub max_output_bytes: usize,
    #[serde(default = "default_artifacts_dir")]
    pub artifacts_dir: PathBuf,
}

impl Default for ExecutionConfig {
    fn default() -> Self {
        Self {
            timeout_seconds: default_timeout_seconds(),
            max_output_bytes: default_max_output_bytes(),
            artifacts_dir: default_artifacts_dir(),
        }
    }
}

fn default_timeout_seconds() -> u64 {
    1_200
}

fn default_max_output_bytes() -> usize {
    8 * 1024 * 1024
}

fn default_artifacts_dir() -> PathBuf {
    PathBuf::from(".formal-artifacts")
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct SimulationConfig {
    pub backend: String,
    pub max_samples: u64,
    pub max_steps: u64,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct VerificationConfig {
    pub backend: String,
    #[serde(default)]
    pub exhaustive_finite_model: bool,
    pub max_steps: Option<u64>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct TraceConfig {
    pub format: String,
    #[serde(default)]
    pub model_based_testing_metadata: bool,
    pub count: u64,
    pub max_steps: u64,
    pub max_samples: Option<u64>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct AdapterConfig {
    pub strategy: String,
    pub target: Option<PathBuf>,
    #[serde(default)]
    pub status: AdapterStatus,
    #[serde(default)]
    pub command: Vec<String>,
    pub working_directory: Option<PathBuf>,
    #[serde(default)]
    pub environment: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum AdapterStatus {
    Planned,
    Active,
    Disabled,
}

impl Default for AdapterStatus {
    fn default() -> Self {
        Self::Planned
    }
}

#[derive(Debug, Clone)]
pub struct LoadedManifest {
    pub workspace: PathBuf,
    pub manifest_path: PathBuf,
    pub spec_path: PathBuf,
    pub manifest: Manifest,
}

#[derive(Debug, Clone, Serialize)]
pub struct ValidationReport {
    pub valid: bool,
    pub schema_version: u32,
    pub project: String,
    pub model: String,
    pub language: SpecLanguage,
    pub workspace: PathBuf,
    pub manifest: PathBuf,
    pub spec: PathBuf,
    pub invariants: Vec<String>,
    pub witnesses: Vec<String>,
    pub adapters: BTreeMap<String, AdapterStatus>,
    pub warnings: Vec<String>,
}

impl LoadedManifest {
    pub fn load(workspace: &Path, manifest_path: &Path) -> Result<Self, FmError> {
        let workspace = fs::canonicalize(workspace).map_err(|source| FmError::io(workspace, source))?;
        let manifest_path = canonicalize_existing_under_workspace(
            &workspace,
            manifest_path,
            "manifest",
        )?;
        let source = fs::read_to_string(&manifest_path)
            .map_err(|error| FmError::io(&manifest_path, error))?;
        let manifest: Manifest = toml::from_str(&source).map_err(|source| {
            FmError::ManifestSyntax {
                path: manifest_path.clone(),
                source,
            }
        })?;

        let mut errors = validate_manifest_shape(&manifest);
        if let Err(message) = validate_relative_path("spec", &manifest.spec) {
            errors.push(message);
        }

        let spec_path = match fs::canonicalize(workspace.join(&manifest.spec)) {
            Ok(path) if path.starts_with(&workspace) => path,
            Ok(path) => {
                errors.push(format!(
                    "spec path escapes the workspace after canonicalization: {}",
                    path.display()
                ));
                workspace.join(&manifest.spec)
            }
            Err(error) => {
                errors.push(format!(
                    "spec path {} cannot be read: {error}",
                    workspace.join(&manifest.spec).display()
                ));
                workspace.join(&manifest.spec)
            }
        };

        if !errors.is_empty() {
            return Err(FmError::Validation(format_validation_errors(&errors)));
        }

        Ok(Self {
            workspace,
            manifest_path,
            spec_path,
            manifest,
        })
    }

    pub fn report(&self) -> ValidationReport {
        let adapters = self
            .manifest
            .adapters
            .iter()
            .map(|(name, adapter)| (name.clone(), adapter.status))
            .collect();

        let mut warnings = Vec::new();
        for (name, adapter) in &self.manifest.adapters {
            if adapter.status == AdapterStatus::Planned {
                warnings.push(format!("adapter '{name}' is planned but not executable"));
            }
        }

        ValidationReport {
            valid: true,
            schema_version: self.manifest.schema_version,
            project: self.manifest.project.clone(),
            model: self.manifest.model.clone(),
            language: self.manifest.language,
            workspace: self.workspace.clone(),
            manifest: self.manifest_path.clone(),
            spec: self.spec_path.clone(),
            invariants: self.manifest.invariants.clone(),
            witnesses: self.manifest.witnesses.clone(),
            adapters,
            warnings,
        }
    }

    pub fn resolve_output_path(&self, path: &Path) -> Result<PathBuf, FmError> {
        validate_relative_path("output", path).map_err(FmError::Validation)?;
        Ok(self.workspace.join(path))
    }

    pub fn resolve_adapter_working_directory(
        &self,
        adapter: &AdapterConfig,
    ) -> Result<PathBuf, FmError> {
        let path = adapter
            .working_directory
            .as_deref()
            .or(adapter.target.as_deref())
            .unwrap_or_else(|| Path::new("."));
        validate_relative_path("adapter working_directory", path).map_err(FmError::Validation)?;
        let candidate = self.workspace.join(path);
        let canonical = fs::canonicalize(&candidate).map_err(|source| FmError::io(&candidate, source))?;
        if !canonical.starts_with(&self.workspace) {
            return Err(FmError::Validation(format!(
                "adapter working directory escapes workspace: {}",
                canonical.display()
            )));
        }
        Ok(canonical)
    }
}

fn validate_manifest_shape(manifest: &Manifest) -> Vec<String> {
    let mut errors = Vec::new();

    if manifest.schema_version != MANIFEST_SCHEMA_VERSION {
        errors.push(format!(
            "unsupported schema_version {}; expected {}",
            manifest.schema_version, MANIFEST_SCHEMA_VERSION
        ));
    }

    validate_label("project", &manifest.project, &mut errors);
    validate_label("model", &manifest.model, &mut errors);
    validate_identifier("main", &manifest.main, &mut errors);
    validate_identifier("init", &manifest.init, &mut errors);
    validate_identifier("step", &manifest.step, &mut errors);

    if manifest.invariants.is_empty() {
        errors.push("at least one invariant is required".to_owned());
    }
    validate_unique_identifiers("invariants", &manifest.invariants, &mut errors);
    validate_unique_identifiers("witnesses", &manifest.witnesses, &mut errors);

    if !is_safe_version(&manifest.toolchain.quint) {
        errors.push(format!(
            "toolchain.quint must be a pinned version token, got {:?}",
            manifest.toolchain.quint
        ));
    }
    if manifest.toolchain.java.trim().is_empty() {
        errors.push("toolchain.java must not be empty".to_owned());
    }
    if !is_safe_program(&manifest.toolchain.npx) {
        errors.push(format!(
            "toolchain.npx must be one executable token without whitespace, got {:?}",
            manifest.toolchain.npx
        ));
    }

    if manifest.execution.timeout_seconds == 0 {
        errors.push("execution.timeout_seconds must be greater than zero".to_owned());
    }
    if manifest.execution.max_output_bytes < 1_024 {
        errors.push("execution.max_output_bytes must be at least 1024".to_owned());
    }
    if let Err(message) = validate_relative_path(
        "execution.artifacts_dir",
        &manifest.execution.artifacts_dir,
    ) {
        errors.push(message);
    }

    if let Some(simulation) = &manifest.simulation {
        if !matches!(simulation.backend.as_str(), "typescript" | "rust") {
            errors.push(format!(
                "simulation.backend must be 'typescript' or 'rust', got {:?}",
                simulation.backend
            ));
        }
        if simulation.max_samples == 0 {
            errors.push("simulation.max_samples must be greater than zero".to_owned());
        }
        if simulation.max_steps == 0 {
            errors.push("simulation.max_steps must be greater than zero".to_owned());
        }
    }

    if let Some(verification) = &manifest.verification {
        if !matches!(verification.backend.as_str(), "tlc" | "apalache") {
            errors.push(format!(
                "verification.backend must be 'tlc' or 'apalache', got {:?}",
                verification.backend
            ));
        }
        if verification.backend == "tlc" && verification.max_steps.is_some() {
            errors.push("verification.max_steps is only valid for Apalache".to_owned());
        }
        if verification.max_steps == Some(0) {
            errors.push("verification.max_steps must be greater than zero when set".to_owned());
        }
    }

    if let Some(traces) = &manifest.traces {
        if traces.format != "itf" {
            errors.push(format!(
                "traces.format must be 'itf', got {:?}",
                traces.format
            ));
        }
        if traces.count == 0 {
            errors.push("traces.count must be greater than zero".to_owned());
        }
        if traces.max_steps == 0 {
            errors.push("traces.max_steps must be greater than zero".to_owned());
        }
        if traces.max_samples == Some(0) {
            errors.push("traces.max_samples must be greater than zero when set".to_owned());
        }
    }

    for (name, adapter) in &manifest.adapters {
        validate_identifier("adapter name", name, &mut errors);
        if adapter.strategy.trim().is_empty() {
            errors.push(format!("adapter '{name}' strategy must not be empty"));
        }
        if let Some(target) = &adapter.target {
            if let Err(message) = validate_relative_path(&format!("adapter '{name}' target"), target)
            {
                errors.push(message);
            }
        }
        if let Some(working_directory) = &adapter.working_directory {
            if let Err(message) = validate_relative_path(
                &format!("adapter '{name}' working_directory"),
                working_directory,
            ) {
                errors.push(message);
            }
        }
        if adapter.status == AdapterStatus::Active && adapter.command.is_empty() {
            errors.push(format!(
                "active adapter '{name}' must declare a command array"
            ));
        }
        if adapter.command.iter().any(|part| part.is_empty() || part.contains('\0')) {
            errors.push(format!(
                "adapter '{name}' command contains an empty or NUL-bearing argument"
            ));
        }
        for (key, value) in &adapter.environment {
            if key.is_empty() || key.contains('=') || key.contains('\0') || value.contains('\0') {
                errors.push(format!(
                    "adapter '{name}' has an invalid environment entry {key:?}"
                ));
            }
        }
    }

    errors
}

fn validate_label(label: &str, value: &str, errors: &mut Vec<String>) {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        errors.push(format!("{label} must not be empty"));
    } else if trimmed.len() > 128 {
        errors.push(format!("{label} must be at most 128 bytes"));
    } else if trimmed.chars().any(char::is_control) {
        errors.push(format!("{label} must not contain control characters"));
    }
}

fn validate_unique_identifiers(label: &str, values: &[String], errors: &mut Vec<String>) {
    let mut seen = BTreeSet::new();
    for value in values {
        validate_identifier(label, value, errors);
        if !seen.insert(value) {
            errors.push(format!("{label} contains duplicate value {value:?}"));
        }
    }
}

fn validate_identifier(label: &str, value: &str, errors: &mut Vec<String>) {
    let mut chars = value.chars();
    let Some(first) = chars.next() else {
        errors.push(format!("{label} must not be empty"));
        return;
    };
    if !(first.is_ascii_alphabetic() || first == '_')
        || !chars.all(|character| character.is_ascii_alphanumeric() || character == '_')
    {
        errors.push(format!(
            "{label} must be a Quint-compatible identifier, got {value:?}"
        ));
    }
}

fn is_safe_version(version: &str) -> bool {
    !version.is_empty()
        && version
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || ".+-_".contains(character))
}

fn is_safe_program(program: &str) -> bool {
    !program.is_empty()
        && !program.contains('\0')
        && !program.chars().any(char::is_whitespace)
}

pub fn validate_relative_path(label: &str, path: &Path) -> Result<(), String> {
    if path.as_os_str().is_empty() {
        return Err(format!("{label} must not be empty"));
    }
    if path.is_absolute() {
        return Err(format!("{label} must be relative to the workspace"));
    }
    for component in path.components() {
        if matches!(
            component,
            Component::ParentDir | Component::RootDir | Component::Prefix(_)
        ) {
            return Err(format!(
                "{label} must not escape the workspace with '..' or an absolute prefix"
            ));
        }
    }
    Ok(())
}

fn canonicalize_existing_under_workspace(
    workspace: &Path,
    path: &Path,
    label: &str,
) -> Result<PathBuf, FmError> {
    let candidate = if path.is_absolute() {
        path.to_path_buf()
    } else {
        workspace.join(path)
    };
    let canonical = fs::canonicalize(&candidate).map_err(|source| FmError::io(&candidate, source))?;
    if !canonical.starts_with(workspace) {
        return Err(FmError::Validation(format!(
            "{label} path escapes the workspace: {}",
            canonical.display()
        )));
    }
    Ok(canonical)
}

fn format_validation_errors(errors: &[String]) -> String {
    errors
        .iter()
        .enumerate()
        .map(|(index, error)| format!("{}. {error}", index + 1))
        .collect::<Vec<_>>()
        .join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_parent_directory_components() {
        let error = validate_relative_path("spec", Path::new("../outside.qnt"))
            .expect_err("path traversal must fail");
        assert!(error.contains("escape"));
    }

    #[test]
    fn accepts_workspace_relative_paths() {
        validate_relative_path("spec", Path::new("formal/model.qnt"))
            .expect("normal relative path should be accepted");
    }
}
