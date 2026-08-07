use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::io::Read;
use std::path::{Component, Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::FmError;

pub const MANIFEST_SCHEMA_VERSION: u32 = 1;
pub const MAX_MANIFEST_BYTES: usize = 1024 * 1024;
pub const MAX_INVARIANTS: usize = 256;
pub const MAX_WITNESSES: usize = 256;
pub const MAX_ADAPTERS: usize = 32;
pub const MAX_REQUIRED_ACTIONS: usize = 256;
pub const MAX_OBSERVABLE_FIELDS: usize = 256;
pub const MAX_COMMAND_ARGUMENTS: usize = 64;
pub const MAX_ENVIRONMENT_ENTRIES: usize = 64;
pub const MAX_LABEL_BYTES: usize = 128;
pub const MAX_IDENTIFIER_BYTES: usize = 128;
pub const MAX_TOOLCHAIN_TOKEN_BYTES: usize = 256;
pub const MAX_COMMAND_ARGUMENT_BYTES: usize = 4096;
pub const MAX_ENVIRONMENT_KEY_BYTES: usize = 128;
pub const MAX_ENVIRONMENT_VALUE_BYTES: usize = 4096;
pub const MAX_TIMEOUT_SECONDS: u64 = 21_600;
pub const MAX_OUTPUT_BYTES: usize = 64 * 1024 * 1024;
pub const MAX_SIMULATION_SAMPLES: u64 = 1_000_000;
pub const MAX_SIMULATION_STEPS: u64 = 100_000;
pub const MAX_SIMULATION_WORK: u64 = 100_000_000;
pub const MAX_VERIFICATION_STEPS: u64 = 100_000;
pub const MAX_TRACE_COUNT: u64 = 10_000;
pub const MAX_TRACE_STEPS: u64 = 100_000;
pub const MAX_TRACE_SAMPLES: u64 = 1_000_000;
pub const MAX_TRACE_WORK: u64 = 100_000_000;

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
    pub node: Option<String>,
    pub rust: Option<String>,
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
    pub backend: Option<String>,
    pub seed: Option<String>,
    pub count: u64,
    pub max_steps: u64,
    pub max_samples: Option<u64>,
    #[serde(default)]
    pub required_actions: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct AdapterConfig {
    pub strategy: String,
    pub target: Option<PathBuf>,
    pub implementation: Option<String>,
    #[serde(default)]
    pub observable_state: Vec<String>,
    pub issue: Option<String>,
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
        let workspace =
            fs::canonicalize(workspace).map_err(|source| FmError::io(workspace, source))?;
        let manifest_path =
            canonicalize_existing_under_workspace(&workspace, manifest_path, "manifest")?;
        let source = read_bounded_utf8_file(&manifest_path, MAX_MANIFEST_BYTES, "manifest")?;
        let manifest: Manifest =
            toml::from_str(&source).map_err(|source| FmError::ManifestSyntax {
                path: manifest_path.clone(),
                source,
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

        let loaded = Self {
            workspace,
            manifest_path,
            spec_path,
            manifest,
        };
        loaded.resolve_output_path(&loaded.manifest.execution.artifacts_dir)?;
        for (name, adapter) in &loaded.manifest.adapters {
            if let Some(target) = &adapter.target {
                resolve_workspace_descendant(
                    &loaded.workspace,
                    target,
                    &format!("adapter '{name}' target"),
                )?;
            }
        }
        Ok(loaded)
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
        resolve_workspace_descendant(&self.workspace, path, "output")
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
        let canonical =
            fs::canonicalize(&candidate).map_err(|source| FmError::io(&candidate, source))?;
        if !canonical.starts_with(&self.workspace) {
            return Err(FmError::Validation(format!(
                "adapter working directory escapes workspace: {}",
                canonical.display()
            )));
        }
        Ok(canonical)
    }
}

fn read_bounded_utf8_file(path: &Path, maximum: usize, label: &str) -> Result<String, FmError> {
    let file = fs::File::open(path).map_err(|error| FmError::io(path, error))?;
    let metadata = file
        .metadata()
        .map_err(|source| FmError::io(path, source))?;
    if !metadata.is_file() {
        return Err(FmError::Validation(format!(
            "{label} input must be a regular file: {}",
            path.display()
        )));
    }

    let reported_bytes = usize::try_from(metadata.len()).unwrap_or(usize::MAX);
    validate_bounded_file_size(label, path, reported_bytes, reported_bytes, maximum)?;

    let read_limit = u64::try_from(maximum).unwrap_or(u64::MAX).saturating_add(1);
    let mut source = Vec::with_capacity(reported_bytes.min(maximum));
    file.take(read_limit)
        .read_to_end(&mut source)
        .map_err(|error| FmError::io(path, error))?;
    validate_bounded_file_size(label, path, reported_bytes, source.len(), maximum)?;
    String::from_utf8(source).map_err(|error| {
        FmError::Validation(format!(
            "{label} input must be UTF-8: {}: {error}",
            path.display()
        ))
    })
}

fn validate_bounded_file_size(
    label: &str,
    path: &Path,
    reported_bytes: usize,
    actual_bytes: usize,
    maximum: usize,
) -> Result<(), FmError> {
    if reported_bytes > maximum {
        return Err(FmError::Validation(format!(
            "{label} input exceeds the {maximum}-byte limit before reading: {}",
            path.display()
        )));
    }
    if actual_bytes > maximum {
        return Err(FmError::Validation(format!(
            "{label} input grew beyond the {maximum}-byte limit while reading: {}",
            path.display()
        )));
    }
    Ok(())
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
    validate_collection_limit(
        "invariants",
        manifest.invariants.len(),
        MAX_INVARIANTS,
        &mut errors,
    );
    validate_collection_limit(
        "witnesses",
        manifest.witnesses.len(),
        MAX_WITNESSES,
        &mut errors,
    );
    validate_collection_limit(
        "adapters",
        manifest.adapters.len(),
        MAX_ADAPTERS,
        &mut errors,
    );
    validate_unique_identifiers("invariants", &manifest.invariants, &mut errors);
    validate_unique_identifiers("witnesses", &manifest.witnesses, &mut errors);

    if !is_safe_version(&manifest.toolchain.quint) {
        errors.push(format!(
            "toolchain.quint must be a pinned version token, got {:?}",
            manifest.toolchain.quint
        ));
    }
    validate_label("toolchain.java", &manifest.toolchain.java, &mut errors);
    if let Some(node) = &manifest.toolchain.node {
        if !is_safe_version(node) {
            errors.push(format!(
                "toolchain.node must be a pinned version token, got {node:?}"
            ));
        }
    }
    if let Some(rust) = &manifest.toolchain.rust {
        if !is_safe_version(rust) {
            errors.push(format!(
                "toolchain.rust must be a pinned version token, got {rust:?}"
            ));
        }
    }
    if !is_safe_program(&manifest.toolchain.npx) {
        errors.push(format!(
            "toolchain.npx must be one executable token without whitespace, got {:?}",
            manifest.toolchain.npx
        ));
    }

    if manifest.execution.timeout_seconds == 0 {
        errors.push("execution.timeout_seconds must be greater than zero".to_owned());
    } else if manifest.execution.timeout_seconds > MAX_TIMEOUT_SECONDS {
        errors.push(format!(
            "execution.timeout_seconds must be at most {MAX_TIMEOUT_SECONDS}"
        ));
    }
    if manifest.execution.max_output_bytes < 1_024 {
        errors.push("execution.max_output_bytes must be at least 1024".to_owned());
    } else if manifest.execution.max_output_bytes > MAX_OUTPUT_BYTES {
        errors.push(format!(
            "execution.max_output_bytes must be at most {MAX_OUTPUT_BYTES}"
        ));
    }
    if let Err(message) =
        validate_relative_path("execution.artifacts_dir", &manifest.execution.artifacts_dir)
    {
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
        } else if simulation.max_samples > MAX_SIMULATION_SAMPLES {
            errors.push(format!(
                "simulation.max_samples must be at most {MAX_SIMULATION_SAMPLES}"
            ));
        }
        if simulation.max_steps == 0 {
            errors.push("simulation.max_steps must be greater than zero".to_owned());
        } else if simulation.max_steps > MAX_SIMULATION_STEPS {
            errors.push(format!(
                "simulation.max_steps must be at most {MAX_SIMULATION_STEPS}"
            ));
        }
        validate_work_product(
            "simulation.max_samples * simulation.max_steps",
            simulation.max_samples,
            simulation.max_steps,
            MAX_SIMULATION_WORK,
            &mut errors,
        );
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
        if verification
            .max_steps
            .is_some_and(|steps| steps > MAX_VERIFICATION_STEPS)
        {
            errors.push(format!(
                "verification.max_steps must be at most {MAX_VERIFICATION_STEPS}"
            ));
        }
    }

    if let Some(traces) = &manifest.traces {
        validate_collection_limit(
            "traces.required_actions",
            traces.required_actions.len(),
            MAX_REQUIRED_ACTIONS,
            &mut errors,
        );
        if traces.format != "itf" {
            errors.push(format!(
                "traces.format must be 'itf', got {:?}",
                traces.format
            ));
        }
        if let Some(backend) = &traces.backend {
            if !matches!(backend.as_str(), "typescript" | "rust") {
                errors.push(format!(
                    "traces.backend must be 'typescript' or 'rust', got {backend:?}"
                ));
            }
        }
        if let Some(seed) = &traces.seed {
            if !is_safe_version(seed) {
                errors.push(format!(
                    "traces.seed must be one deterministic seed token, got {seed:?}"
                ));
            }
        }
        if traces.count == 0 {
            errors.push("traces.count must be greater than zero".to_owned());
        } else if traces.count > MAX_TRACE_COUNT {
            errors.push(format!("traces.count must be at most {MAX_TRACE_COUNT}"));
        }
        if traces.max_steps == 0 {
            errors.push("traces.max_steps must be greater than zero".to_owned());
        } else if traces.max_steps > MAX_TRACE_STEPS {
            errors.push(format!(
                "traces.max_steps must be at most {MAX_TRACE_STEPS}"
            ));
        }
        if traces.max_samples == Some(0) {
            errors.push("traces.max_samples must be greater than zero when set".to_owned());
        }
        if traces
            .max_samples
            .is_some_and(|samples| samples > MAX_TRACE_SAMPLES)
        {
            errors.push(format!(
                "traces.max_samples must be at most {MAX_TRACE_SAMPLES}"
            ));
        }
        validate_work_product(
            "traces.count * traces.max_steps",
            traces.count,
            traces.max_steps,
            MAX_TRACE_WORK,
            &mut errors,
        );
        if let Some(samples) = traces.max_samples {
            validate_work_product(
                "traces.max_samples * traces.max_steps",
                samples,
                traces.max_steps,
                MAX_TRACE_WORK,
                &mut errors,
            );
        }
        validate_unique_identifiers(
            "traces.required_actions",
            &traces.required_actions,
            &mut errors,
        );
    }

    for (name, adapter) in &manifest.adapters {
        validate_identifier("adapter name", name, &mut errors);
        validate_label(
            &format!("adapter '{name}' strategy"),
            &adapter.strategy,
            &mut errors,
        );
        validate_collection_limit(
            &format!("adapter '{name}' observable_state"),
            adapter.observable_state.len(),
            MAX_OBSERVABLE_FIELDS,
            &mut errors,
        );
        validate_collection_limit(
            &format!("adapter '{name}' command"),
            adapter.command.len(),
            MAX_COMMAND_ARGUMENTS,
            &mut errors,
        );
        validate_collection_limit(
            &format!("adapter '{name}' environment"),
            adapter.environment.len(),
            MAX_ENVIRONMENT_ENTRIES,
            &mut errors,
        );
        if let Some(target) = &adapter.target {
            if let Err(message) =
                validate_relative_path(&format!("adapter '{name}' target"), target)
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
        if let Some(implementation) = &adapter.implementation {
            validate_label(
                &format!("adapter '{name}' implementation"),
                implementation,
                &mut errors,
            );
        }
        if let Some(issue) = &adapter.issue {
            validate_label(&format!("adapter '{name}' issue"), issue, &mut errors);
        }
        let mut observable_fields = BTreeSet::new();
        for field in &adapter.observable_state {
            validate_label(
                &format!("adapter '{name}' observable_state"),
                field,
                &mut errors,
            );
            if !observable_fields.insert(field) {
                errors.push(format!(
                    "adapter '{name}' observable_state contains duplicate value {field:?}"
                ));
            }
        }
        if adapter.status == AdapterStatus::Active && adapter.command.is_empty() {
            errors.push(format!(
                "active adapter '{name}' must declare a command array"
            ));
        }
        for (index, part) in adapter.command.iter().enumerate() {
            if part.is_empty() || part.contains('\0') {
                errors.push(format!(
                    "adapter '{name}' command argument {index} is empty or contains NUL"
                ));
            }
            if part.len() > MAX_COMMAND_ARGUMENT_BYTES {
                errors.push(format!(
                    "adapter '{name}' command argument {index} must be at most {MAX_COMMAND_ARGUMENT_BYTES} bytes"
                ));
            }
        }
        for (key, value) in &adapter.environment {
            if key.is_empty() || key.contains('=') || key.contains('\0') || value.contains('\0') {
                errors.push(format!(
                    "adapter '{name}' has an invalid environment entry {key:?}"
                ));
            }
            if key.len() > MAX_ENVIRONMENT_KEY_BYTES {
                errors.push(format!(
                    "adapter '{name}' environment key must be at most {MAX_ENVIRONMENT_KEY_BYTES} bytes, got {key:?}"
                ));
            }
            if value.len() > MAX_ENVIRONMENT_VALUE_BYTES {
                errors.push(format!(
                    "adapter '{name}' environment value for {key:?} must be at most {MAX_ENVIRONMENT_VALUE_BYTES} bytes"
                ));
            }
        }
    }

    errors
}

fn validate_work_product(
    label: &str,
    left: u64,
    right: u64,
    maximum: u64,
    errors: &mut Vec<String>,
) {
    match left.checked_mul(right) {
        Some(actual) if actual <= maximum => {}
        Some(actual) => errors.push(format!("{label} must be at most {maximum}, got {actual}")),
        None => errors.push(format!("{label} overflows u64")),
    }
}

fn validate_collection_limit(label: &str, actual: usize, maximum: usize, errors: &mut Vec<String>) {
    if actual > maximum {
        errors.push(format!(
            "{label} must contain at most {maximum} entries, got {actual}"
        ));
    }
}

fn validate_label(label: &str, value: &str, errors: &mut Vec<String>) {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        errors.push(format!("{label} must not be empty"));
    } else if trimmed.len() > MAX_LABEL_BYTES {
        errors.push(format!("{label} must be at most {MAX_LABEL_BYTES} bytes"));
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
    if value.len() > MAX_IDENTIFIER_BYTES {
        errors.push(format!(
            "{label} must be at most {MAX_IDENTIFIER_BYTES} bytes"
        ));
        return;
    }
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
        && version.len() <= MAX_TOOLCHAIN_TOKEN_BYTES
        && version
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || ".+-_".contains(character))
}

fn is_safe_program(program: &str) -> bool {
    !program.is_empty()
        && program.len() <= MAX_COMMAND_ARGUMENT_BYTES
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
    let canonical =
        fs::canonicalize(&candidate).map_err(|source| FmError::io(&candidate, source))?;
    if !canonical.starts_with(workspace) {
        return Err(FmError::Validation(format!(
            "{label} path escapes the workspace: {}",
            canonical.display()
        )));
    }
    Ok(canonical)
}

fn resolve_workspace_descendant(
    workspace: &Path,
    path: &Path,
    label: &str,
) -> Result<PathBuf, FmError> {
    validate_relative_path(label, path).map_err(FmError::Validation)?;
    let candidate = workspace.join(path);
    let mut existing = candidate.as_path();
    while !existing.exists() {
        existing = existing.parent().ok_or_else(|| {
            FmError::Validation(format!("{label} has no existing workspace ancestor"))
        })?;
    }
    let canonical_ancestor =
        fs::canonicalize(existing).map_err(|source| FmError::io(existing, source))?;
    if !canonical_ancestor.starts_with(workspace) {
        return Err(FmError::Validation(format!(
            "{label} escapes the workspace through symlinked ancestor {}",
            existing.display()
        )));
    }
    if candidate.exists() {
        let canonical =
            fs::canonicalize(&candidate).map_err(|source| FmError::io(&candidate, source))?;
        if !canonical.starts_with(workspace) {
            return Err(FmError::Validation(format!(
                "{label} escapes the workspace: {}",
                canonical.display()
            )));
        }
    }
    Ok(candidate)
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
    use tempfile::TempDir;

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

    #[cfg(unix)]
    #[test]
    fn rejects_output_symlink_that_escapes_workspace() {
        use std::os::unix::fs::symlink;

        let workspace = TempDir::new().expect("workspace");
        let outside = TempDir::new().expect("outside");
        symlink(outside.path(), workspace.path().join("artifacts")).expect("symlink");
        let canonical_workspace = fs::canonicalize(workspace.path()).expect("workspace path");
        let error = resolve_workspace_descendant(
            &canonical_workspace,
            Path::new("artifacts/result.json"),
            "output",
        )
        .expect_err("symlink escape must fail");
        assert!(error.to_string().contains("symlinked ancestor"));
    }

    #[test]
    fn rejects_oversized_manifest_before_toml_parsing() {
        let workspace = TempDir::new().expect("workspace");
        let manifest_path = workspace.path().join("oversized.toml");
        fs::write(&manifest_path, vec![b'x'; MAX_MANIFEST_BYTES + 1]).expect("oversized manifest");

        let error = LoadedManifest::load(workspace.path(), Path::new("oversized.toml"))
            .expect_err("oversized manifest must fail");
        let message = error.to_string();
        assert!(message.contains("exceeds"), "{message}");
        assert!(
            message.contains(&MAX_MANIFEST_BYTES.to_string()),
            "{message}"
        );
        assert!(!message.contains("failed to parse manifest"), "{message}");
    }

    #[test]
    fn rejects_manifest_path_that_is_not_a_regular_file() {
        let workspace = TempDir::new().expect("workspace");
        fs::create_dir(workspace.path().join("manifest-dir")).expect("manifest directory");

        let error = LoadedManifest::load(workspace.path(), Path::new("manifest-dir"))
            .expect_err("directory manifest must fail");
        assert!(error.to_string().contains("regular file"));
    }

    #[test]
    fn rejects_invalid_utf8_before_toml_parsing() {
        let workspace = TempDir::new().expect("workspace");
        fs::write(workspace.path().join("invalid.toml"), [0xff, 0xfe])
            .expect("invalid UTF-8 manifest");

        let error = LoadedManifest::load(workspace.path(), Path::new("invalid.toml"))
            .expect_err("invalid UTF-8 manifest must fail");
        let message = error.to_string();
        assert!(message.contains("must be UTF-8"), "{message}");
        assert!(!message.contains("failed to parse manifest"), "{message}");
    }

    #[test]
    fn post_read_size_check_rejects_growth_after_metadata() {
        let error = validate_bounded_file_size(
            "manifest",
            Path::new("formal/fm.toml"),
            MAX_MANIFEST_BYTES,
            MAX_MANIFEST_BYTES + 1,
            MAX_MANIFEST_BYTES,
        )
        .expect_err("post-read growth must fail");
        assert!(error.to_string().contains("grew beyond"));
    }

    fn valid_manifest() -> Manifest {
        toml::from_str(include_str!("../../../formal/fm.toml")).expect("repository formal manifest")
    }

    fn identifiers(prefix: &str, count: usize) -> Vec<String> {
        (0..count)
            .map(|index| format!("{prefix}_{index}"))
            .collect()
    }

    fn assert_valid(manifest: &Manifest) {
        let errors = validate_manifest_shape(manifest);
        assert!(
            errors.is_empty(),
            "unexpected validation errors: {errors:#?}"
        );
    }

    fn assert_error(manifest: &Manifest, expected: &str) {
        let errors = validate_manifest_shape(manifest);
        assert!(
            errors.iter().any(|error| error.contains(expected)),
            "expected error containing {expected:?}, got {errors:#?}"
        );
    }

    #[test]
    fn invariant_and_witness_boundaries_are_exact() {
        let mut manifest = valid_manifest();
        manifest.invariants = identifiers("invariant", MAX_INVARIANTS);
        manifest.witnesses = identifiers("witness", MAX_WITNESSES);
        assert_valid(&manifest);

        manifest.invariants.push("invariant_overflow".to_owned());
        manifest.witnesses.push("witness_overflow".to_owned());
        assert_error(&manifest, "invariants must contain at most");
        assert_error(&manifest, "witnesses must contain at most");
    }

    #[test]
    fn adapter_and_trace_collection_boundaries_are_exact() {
        let mut manifest = valid_manifest();
        let template = manifest
            .adapters
            .values()
            .next()
            .cloned()
            .expect("adapter template");
        manifest.adapters = (0..MAX_ADAPTERS)
            .map(|index| (format!("adapter_{index}"), template.clone()))
            .collect();
        manifest
            .traces
            .as_mut()
            .expect("trace config")
            .required_actions = identifiers("action", MAX_REQUIRED_ACTIONS);
        assert_valid(&manifest);

        manifest
            .adapters
            .insert("adapter_overflow".to_owned(), template);
        manifest
            .traces
            .as_mut()
            .expect("trace config")
            .required_actions
            .push("action_overflow".to_owned());
        assert_error(&manifest, "adapters must contain at most");
        assert_error(&manifest, "traces.required_actions must contain at most");
    }

    #[test]
    fn adapter_local_collection_boundaries_are_exact() {
        let mut manifest = valid_manifest();
        let adapter = manifest.adapters.values_mut().next().expect("adapter");
        adapter.observable_state = (0..MAX_OBSERVABLE_FIELDS)
            .map(|index| format!("field {index}"))
            .collect();
        adapter.command = vec!["argument".to_owned(); MAX_COMMAND_ARGUMENTS];
        adapter.environment = (0..MAX_ENVIRONMENT_ENTRIES)
            .map(|index| (format!("KEY_{index}"), "value".to_owned()))
            .collect();
        assert_valid(&manifest);

        let adapter = manifest.adapters.values_mut().next().expect("adapter");
        adapter.observable_state.push("field overflow".to_owned());
        adapter.command.push("argument".to_owned());
        adapter
            .environment
            .insert("KEY_OVERFLOW".to_owned(), "value".to_owned());
        assert_error(&manifest, "observable_state must contain at most");
        assert_error(&manifest, "command must contain at most");
        assert_error(&manifest, "environment must contain at most");
    }

    #[test]
    fn scalar_boundaries_are_exact() {
        let mut errors = Vec::new();
        validate_label("label", &"x".repeat(MAX_LABEL_BYTES), &mut errors);
        validate_identifier(
            "identifier",
            &format!("a{}", "x".repeat(MAX_IDENTIFIER_BYTES - 1)),
            &mut errors,
        );
        assert!(errors.is_empty(), "boundary values must pass: {errors:#?}");
        assert!(is_safe_version(&"1".repeat(MAX_TOOLCHAIN_TOKEN_BYTES)));
        assert!(is_safe_program(&"x".repeat(MAX_COMMAND_ARGUMENT_BYTES)));

        validate_label("label", &"x".repeat(MAX_LABEL_BYTES + 1), &mut errors);
        validate_identifier(
            "identifier",
            &format!("a{}", "x".repeat(MAX_IDENTIFIER_BYTES)),
            &mut errors,
        );
        assert!(errors
            .iter()
            .any(|error| error.contains("label must be at most")));
        assert!(errors
            .iter()
            .any(|error| error.contains("identifier must be at most")));
        assert!(!is_safe_version(&"1".repeat(MAX_TOOLCHAIN_TOKEN_BYTES + 1)));
        assert!(!is_safe_program(
            &"x".repeat(MAX_COMMAND_ARGUMENT_BYTES + 1)
        ));
    }

    #[test]
    fn command_and_environment_scalar_boundaries_are_exact() {
        let mut manifest = valid_manifest();
        let adapter = manifest.adapters.values_mut().next().expect("adapter");
        adapter.command = vec!["x".repeat(MAX_COMMAND_ARGUMENT_BYTES)];
        adapter.environment = BTreeMap::from([(
            "K".repeat(MAX_ENVIRONMENT_KEY_BYTES),
            "v".repeat(MAX_ENVIRONMENT_VALUE_BYTES),
        )]);
        assert_valid(&manifest);

        let adapter = manifest.adapters.values_mut().next().expect("adapter");
        adapter.command = vec!["x".repeat(MAX_COMMAND_ARGUMENT_BYTES + 1)];
        adapter.environment = BTreeMap::from([(
            "K".repeat(MAX_ENVIRONMENT_KEY_BYTES + 1),
            "v".repeat(MAX_ENVIRONMENT_VALUE_BYTES + 1),
        )]);
        assert_error(&manifest, "command argument 0 must be at most");
        assert_error(&manifest, "environment key must be at most");
        assert_error(&manifest, "environment value");
    }

    #[test]
    fn execution_budget_boundaries_are_exact() {
        let mut manifest = valid_manifest();
        manifest.execution.timeout_seconds = MAX_TIMEOUT_SECONDS;
        manifest.execution.max_output_bytes = MAX_OUTPUT_BYTES;
        assert_valid(&manifest);

        manifest.execution.timeout_seconds = MAX_TIMEOUT_SECONDS + 1;
        manifest.execution.max_output_bytes = MAX_OUTPUT_BYTES + 1;
        assert_error(&manifest, "execution.timeout_seconds must be at most");
        assert_error(&manifest, "execution.max_output_bytes must be at most");
    }

    #[test]
    fn simulation_scalar_and_aggregate_boundaries_are_exact() {
        let mut manifest = valid_manifest();
        let simulation = manifest.simulation.as_mut().expect("simulation");
        simulation.max_samples = MAX_SIMULATION_SAMPLES;
        simulation.max_steps = 1;
        assert_valid(&manifest);

        let simulation = manifest.simulation.as_mut().expect("simulation");
        simulation.max_samples = 1;
        simulation.max_steps = MAX_SIMULATION_STEPS;
        assert_valid(&manifest);

        let simulation = manifest.simulation.as_mut().expect("simulation");
        simulation.max_samples = 10_000;
        simulation.max_steps = 10_000;
        assert_valid(&manifest);

        manifest
            .simulation
            .as_mut()
            .expect("simulation")
            .max_samples = 10_001;
        assert_error(
            &manifest,
            "simulation.max_samples * simulation.max_steps must be at most",
        );

        let simulation = manifest.simulation.as_mut().expect("simulation");
        simulation.max_samples = MAX_SIMULATION_SAMPLES + 1;
        simulation.max_steps = MAX_SIMULATION_STEPS + 1;
        assert_error(&manifest, "simulation.max_samples must be at most");
        assert_error(&manifest, "simulation.max_steps must be at most");
    }

    #[test]
    fn verification_step_boundary_is_exact() {
        let mut manifest = valid_manifest();
        let verification = manifest.verification.as_mut().expect("verification");
        verification.backend = "apalache".to_owned();
        verification.max_steps = Some(MAX_VERIFICATION_STEPS);
        assert_valid(&manifest);

        manifest
            .verification
            .as_mut()
            .expect("verification")
            .max_steps = Some(MAX_VERIFICATION_STEPS + 1);
        assert_error(&manifest, "verification.max_steps must be at most");
    }

    #[test]
    fn trace_scalar_and_aggregate_boundaries_are_exact() {
        let mut manifest = valid_manifest();
        let traces = manifest.traces.as_mut().expect("traces");
        traces.count = MAX_TRACE_COUNT;
        traces.max_steps = 1;
        traces.max_samples = Some(1);
        assert_valid(&manifest);

        let traces = manifest.traces.as_mut().expect("traces");
        traces.count = 1;
        traces.max_steps = MAX_TRACE_STEPS;
        traces.max_samples = Some(1);
        assert_valid(&manifest);

        let traces = manifest.traces.as_mut().expect("traces");
        traces.count = 10_000;
        traces.max_steps = 10_000;
        traces.max_samples = Some(10_000);
        assert_valid(&manifest);

        let traces = manifest.traces.as_mut().expect("traces");
        traces.count = 10_000;
        traces.max_steps = 10_001;
        traces.max_samples = Some(10_001);
        assert_error(&manifest, "traces.count * traces.max_steps must be at most");
        assert_error(
            &manifest,
            "traces.max_samples * traces.max_steps must be at most",
        );

        let traces = manifest.traces.as_mut().expect("traces");
        traces.count = MAX_TRACE_COUNT + 1;
        traces.max_steps = MAX_TRACE_STEPS + 1;
        traces.max_samples = Some(MAX_TRACE_SAMPLES + 1);
        assert_error(&manifest, "traces.count must be at most");
        assert_error(&manifest, "traces.max_steps must be at most");
        assert_error(&manifest, "traces.max_samples must be at most");
    }

    #[test]
    fn aggregate_work_overflow_is_rejected() {
        let mut errors = Vec::new();
        validate_work_product("overflowing work", u64::MAX, 2, u64::MAX, &mut errors);
        assert_eq!(errors, ["overflowing work overflows u64"]);
    }
}
