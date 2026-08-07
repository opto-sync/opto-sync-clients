use std::collections::{BTreeMap, BTreeSet};
use std::env;
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::FmError;
use crate::manifest::{validate_relative_path, AdapterStatus, LoadedManifest, SpecLanguage};
use crate::resource::{EffectiveResourcePolicy, ResourceProfile, ResourceRequest};

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(tag = "operation", rename_all = "snake_case")]
pub enum Operation {
    Check,
    Simulate,
    Verify,
    Trace {
        output: Option<PathBuf>,
    },
    Replay {
        adapter: String,
        traces: Vec<PathBuf>,
    },
}

impl Operation {
    pub fn name(&self) -> &'static str {
        match self {
            Self::Check => "check",
            Self::Simulate => "simulate",
            Self::Verify => "verify",
            Self::Trace { .. } => "trace",
            Self::Replay { .. } => "replay",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommandPlan {
    pub schema_version: u32,
    pub project: String,
    pub model: String,
    pub operation: String,
    pub program: String,
    pub args: Vec<String>,
    pub workspace: PathBuf,
    pub cwd: PathBuf,
    pub environment: BTreeMap<String, String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stdin: Option<String>,
    pub timeout_seconds: u64,
    pub max_output_bytes: usize,
    pub resource_policy: EffectiveResourcePolicy,
    pub create_directories: Vec<PathBuf>,
    pub artifacts: CommandArtifacts,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommandArtifacts {
    pub stdout: PathBuf,
    pub stderr: PathBuf,
    pub result: PathBuf,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub trace_pattern: Option<PathBuf>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReplayRequest {
    pub protocol: String,
    pub project: String,
    pub model: String,
    pub adapter: String,
    pub specification: PathBuf,
    pub traces: Vec<PathBuf>,
}

pub fn build_plan(loaded: &LoadedManifest, operation: &Operation) -> Result<CommandPlan, FmError> {
    let resource_policy = resolve_local_resource_policy(loaded)?;
    match loaded.manifest.language {
        SpecLanguage::Quint => match operation {
            Operation::Replay { adapter, traces } => {
                build_replay_plan(loaded, adapter, traces, &resource_policy)
            }
            _ => build_quint_plan(loaded, operation, &resource_policy),
        },
    }
}

fn resolve_local_resource_policy(
    loaded: &LoadedManifest,
) -> Result<EffectiveResourcePolicy, FmError> {
    let manifest = &loaded.manifest;
    let trace_max_samples = manifest.traces.as_ref().map(|traces| {
        traces
            .max_samples
            .or_else(|| {
                manifest
                    .simulation
                    .as_ref()
                    .map(|simulation| simulation.max_samples)
            })
            .unwrap_or(500)
    });
    let request = ResourceRequest {
        timeout_seconds: Some(manifest.execution.timeout_seconds),
        max_output_bytes: Some(
            u64::try_from(manifest.execution.max_output_bytes).unwrap_or(u64::MAX),
        ),
        simulation_max_samples: manifest
            .simulation
            .as_ref()
            .map(|simulation| simulation.max_samples),
        simulation_max_steps: manifest
            .simulation
            .as_ref()
            .map(|simulation| simulation.max_steps),
        verification_max_steps: manifest
            .verification
            .as_ref()
            .and_then(|verification| verification.max_steps),
        trace_count: manifest.traces.as_ref().map(|traces| traces.count),
        trace_max_steps: manifest.traces.as_ref().map(|traces| traces.max_steps),
        trace_max_samples,
    };
    ResourceProfile::local_v1()
        .resolve(request)
        .map_err(|error| FmError::Validation(error.to_string()))
}

fn build_quint_plan(
    loaded: &LoadedManifest,
    operation: &Operation,
    resource_policy: &EffectiveResourcePolicy,
) -> Result<CommandPlan, FmError> {
    let manifest = &loaded.manifest;
    let mut args = vec![
        "--yes".to_owned(),
        format!(
            "--package=@informalsystems/quint@{}",
            manifest.toolchain.quint
        ),
        "quint".to_owned(),
    ];
    let mut trace_pattern = None;
    let mut create_directories = Vec::new();

    match operation {
        Operation::Check => {
            args.push("typecheck".to_owned());
            args.push(path_argument(&manifest.spec));
        }
        Operation::Simulate => {
            let simulation =
                manifest
                    .simulation
                    .as_ref()
                    .ok_or_else(|| FmError::OperationNotConfigured {
                        operation: "simulate",
                        manifest: loaded.manifest_path.clone(),
                    })?;
            args.push("run".to_owned());
            args.push(path_argument(&manifest.spec));
            push_machine_arguments(&mut args, loaded);
            args.push(format!("--backend={}", simulation.backend));
            args.push(format!(
                "--max-samples={}",
                resource_policy.effective.scalar.simulation_max_samples
            ));
            args.push(format!(
                "--max-steps={}",
                resource_policy.effective.scalar.simulation_max_steps
            ));
            push_named_values(&mut args, "--invariants", &manifest.invariants);
            push_named_values(&mut args, "--witnesses", &manifest.witnesses);
        }
        Operation::Verify => {
            let verification =
                manifest
                    .verification
                    .as_ref()
                    .ok_or_else(|| FmError::OperationNotConfigured {
                        operation: "verify",
                        manifest: loaded.manifest_path.clone(),
                    })?;
            args.push("verify".to_owned());
            args.push(path_argument(&manifest.spec));
            push_machine_arguments(&mut args, loaded);
            args.push(format!("--backend={}", verification.backend));
            push_named_values(&mut args, "--invariants", &manifest.invariants);
            if verification.max_steps.is_some() {
                args.push(format!(
                    "--max-steps={}",
                    resource_policy.effective.scalar.verification_max_steps
                ));
            }
        }
        Operation::Trace { output } => {
            let traces =
                manifest
                    .traces
                    .as_ref()
                    .ok_or_else(|| FmError::OperationNotConfigured {
                        operation: "trace",
                        manifest: loaded.manifest_path.clone(),
                    })?;
            let relative_pattern = output.clone().unwrap_or_else(|| {
                manifest.execution.artifacts_dir.join(format!(
                    "{}-{}-{{seq}}.itf.json",
                    file_component(&manifest.project),
                    file_component(&manifest.model)
                ))
            });
            validate_relative_path("trace output", &relative_pattern)
                .map_err(FmError::Validation)?;
            if !relative_pattern.starts_with(&manifest.execution.artifacts_dir) {
                return Err(FmError::Validation(format!(
                    "trace output must remain beneath execution.artifacts_dir {}",
                    manifest.execution.artifacts_dir.display()
                )));
            }
            let pattern_text = relative_pattern.to_str().ok_or_else(|| {
                FmError::Validation("trace output must be valid UTF-8".to_owned())
            })?;
            if pattern_text.matches("{seq}").count() != 1 {
                return Err(FmError::Validation(
                    "trace output must contain exactly one '{seq}' placeholder".to_owned(),
                ));
            }
            let absolute_pattern = loaded.resolve_output_path(&relative_pattern)?;
            if let Some(parent) = absolute_pattern.parent() {
                create_directories.push(parent.to_path_buf());
            }

            args.push("run".to_owned());
            args.push(path_argument(&manifest.spec));
            push_machine_arguments(&mut args, loaded);
            if let Some(backend) = traces.backend.as_deref().or_else(|| {
                manifest
                    .simulation
                    .as_ref()
                    .map(|value| value.backend.as_str())
            }) {
                args.push(format!("--backend={backend}"));
            }
            if let Some(seed) = &traces.seed {
                args.push(format!("--seed={seed}"));
            }
            args.push(format!(
                "--max-samples={}",
                resource_policy.effective.scalar.trace_max_samples
            ));
            args.push(format!(
                "--max-steps={}",
                resource_policy.effective.scalar.trace_max_steps
            ));
            args.push(format!(
                "--n-traces={}",
                resource_policy.effective.scalar.trace_count
            ));
            if traces.model_based_testing_metadata {
                args.push("--mbt".to_owned());
            }
            args.push(format!("--out-itf={}", path_argument(&relative_pattern)));
            trace_pattern = Some(absolute_pattern);
        }
        Operation::Replay { .. } => unreachable!("replay has a dedicated plan builder"),
    }

    finalize_plan(
        loaded,
        operation,
        resource_policy,
        manifest.toolchain.npx.clone(),
        args,
        loaded.workspace.clone(),
        BTreeMap::new(),
        None,
        create_directories,
        trace_pattern,
    )
}

fn build_replay_plan(
    loaded: &LoadedManifest,
    adapter_name: &str,
    traces: &[PathBuf],
    resource_policy: &EffectiveResourcePolicy,
) -> Result<CommandPlan, FmError> {
    let adapter =
        loaded
            .manifest
            .adapters
            .get(adapter_name)
            .ok_or_else(|| FmError::UnknownAdapter {
                adapter: adapter_name.to_owned(),
            })?;

    if adapter.status != AdapterStatus::Active || adapter.command.is_empty() {
        return Err(FmError::AdapterCommandMissing {
            adapter: adapter_name.to_owned(),
        });
    }

    let mut canonical_traces = Vec::with_capacity(traces.len());
    let mut unique_traces = BTreeSet::new();
    for trace in traces {
        validate_relative_path("replay trace", trace).map_err(FmError::Validation)?;
        let candidate = loaded.workspace.join(trace);
        let canonical =
            fs::canonicalize(&candidate).map_err(|source| FmError::io(&candidate, source))?;
        if !canonical.starts_with(&loaded.workspace) {
            return Err(FmError::Validation(format!(
                "replay trace escapes workspace: {}",
                canonical.display()
            )));
        }
        let metadata =
            fs::metadata(&canonical).map_err(|source| FmError::io(&canonical, source))?;
        let max_trace_bytes = resource_policy.effective.scalar.max_output_bytes;
        if !metadata.is_file() || metadata.len() == 0 || metadata.len() > max_trace_bytes {
            return Err(FmError::Validation(format!(
                "replay trace must be a non-empty regular file no larger than {max_trace_bytes} bytes: {}",
                canonical.display()
            )));
        }
        if !unique_traces.insert(canonical.clone()) {
            return Err(FmError::Validation(format!(
                "replay trace was supplied more than once: {}",
                canonical.display()
            )));
        }
        canonical_traces.push(canonical);
    }
    if canonical_traces.is_empty() {
        return Err(FmError::Validation(
            "replay requires at least one trace".to_owned(),
        ));
    }
    canonical_traces.sort();

    let request = ReplayRequest {
        protocol: "fmctl.adapter.v1".to_owned(),
        project: loaded.manifest.project.clone(),
        model: loaded.manifest.model.clone(),
        adapter: adapter_name.to_owned(),
        specification: loaded.spec_path.clone(),
        traces: canonical_traces,
    };
    let mut stdin = serde_json::to_string(&request)?;
    stdin.push('\n');

    let program =
        adapter
            .command
            .first()
            .cloned()
            .ok_or_else(|| FmError::AdapterCommandMissing {
                adapter: adapter_name.to_owned(),
            })?;
    let args = adapter.command.iter().skip(1).cloned().collect();
    let cwd = loaded.resolve_adapter_working_directory(adapter)?;
    let mut environment = adapter.environment.clone();
    environment.insert(
        "FMCTL_ADAPTER_PROTOCOL".to_owned(),
        "fmctl.adapter.v1".to_owned(),
    );

    finalize_plan(
        loaded,
        &Operation::Replay {
            adapter: adapter_name.to_owned(),
            traces: traces.to_vec(),
        },
        resource_policy,
        program,
        args,
        cwd,
        environment,
        Some(stdin),
        Vec::new(),
        None,
    )
}

#[allow(clippy::too_many_arguments)]
fn finalize_plan(
    loaded: &LoadedManifest,
    operation: &Operation,
    resource_policy: &EffectiveResourcePolicy,
    program: String,
    args: Vec<String>,
    cwd: PathBuf,
    mut environment: BTreeMap<String, String>,
    stdin: Option<String>,
    mut create_directories: Vec<PathBuf>,
    trace_pattern: Option<PathBuf>,
) -> Result<CommandPlan, FmError> {
    let artifact_root = loaded
        .resolve_output_path(&loaded.manifest.execution.artifacts_dir)?
        .join("fmctl");
    let runtime_root = artifact_root.join("runtime");
    let runtime_home = runtime_root.join("home");
    let runtime_tmp = runtime_root.join("tmp");
    let cargo_home = runtime_root.join("cargo-home");
    let npm_cache = runtime_root.join("npm-cache");
    create_directories.push(artifact_root.clone());
    create_directories.push(runtime_home.clone());
    create_directories.push(runtime_tmp.clone());
    create_directories.push(cargo_home.clone());
    create_directories.push(npm_cache.clone());
    create_directories.sort();
    create_directories.dedup();

    let mut sanitized_environment = BTreeMap::new();
    copy_environment_variable(&mut sanitized_environment, "PATH");
    copy_environment_variable(&mut sanitized_environment, "JAVA_HOME");
    copy_environment_variable(&mut sanitized_environment, "SSL_CERT_FILE");
    copy_environment_variable(&mut sanitized_environment, "SSL_CERT_DIR");
    copy_environment_variable(&mut sanitized_environment, "LANG");
    copy_environment_variable(&mut sanitized_environment, "LC_ALL");
    copy_environment_variable(&mut sanitized_environment, "CI");
    // Nix compiler wrappers depend on these explicit flags after fmctl clears
    // the ambient environment. They contain store paths and compiler options,
    // not credentials, and are required for native Rust adapters on Darwin.
    for name in [
        "CC",
        "CXX",
        "SDKROOT",
        "MACOSX_DEPLOYMENT_TARGET",
        "PKG_CONFIG_PATH",
        "LIBRARY_PATH",
        "NIX_CC",
        "NIX_BINTOOLS",
        "NIX_APPLE_SDK_VERSION",
        "NIX_CFLAGS_COMPILE",
        "NIX_LDFLAGS",
        "NIX_DONT_SET_RPATH",
        "NIX_ENFORCE_NO_NATIVE",
        "NIX_IGNORE_LD_THROUGH_GCC",
    ] {
        copy_environment_variable(&mut sanitized_environment, name);
    }
    for prefix in [
        "NIX_CC_WRAPPER_TARGET_",
        "NIX_BINTOOLS_WRAPPER_TARGET_",
        "NIX_PKG_CONFIG_WRAPPER_TARGET_",
    ] {
        copy_environment_variables_with_prefix(&mut sanitized_environment, prefix);
    }
    if let Some(rustup_home) = env::var_os("RUSTUP_HOME").or_else(|| {
        env::var_os("HOME").map(|home| PathBuf::from(home).join(".rustup").into_os_string())
    }) {
        sanitized_environment.insert(
            "RUSTUP_HOME".to_owned(),
            rustup_home.to_string_lossy().into_owned(),
        );
    }
    if let Some(rust) = &loaded.manifest.toolchain.rust {
        sanitized_environment.insert("RUSTUP_TOOLCHAIN".to_owned(), rust.clone());
    }
    sanitized_environment.insert(
        "HOME".to_owned(),
        runtime_home.to_string_lossy().into_owned(),
    );
    sanitized_environment.insert(
        "TMPDIR".to_owned(),
        runtime_tmp.to_string_lossy().into_owned(),
    );
    sanitized_environment.insert(
        "CARGO_HOME".to_owned(),
        cargo_home.to_string_lossy().into_owned(),
    );
    sanitized_environment.insert(
        "NPM_CONFIG_CACHE".to_owned(),
        npm_cache.to_string_lossy().into_owned(),
    );
    sanitized_environment.insert(
        "NPM_CONFIG_USERCONFIG".to_owned(),
        runtime_root.join("npmrc").to_string_lossy().into_owned(),
    );
    sanitized_environment.extend(environment);
    environment = sanitized_environment;

    let operation_name = operation.name();
    let artifact_name = match operation {
        Operation::Replay { adapter, .. } => {
            format!("{operation_name}-{}", file_component(adapter))
        }
        _ => operation_name.to_owned(),
    };
    let max_output_bytes = usize::try_from(resource_policy.effective.scalar.max_output_bytes)
        .map_err(|_| FmError::Validation("effective output limit exceeds usize".to_owned()))?;

    Ok(CommandPlan {
        schema_version: 1,
        project: loaded.manifest.project.clone(),
        model: loaded.manifest.model.clone(),
        operation: operation_name.to_owned(),
        program,
        args,
        workspace: loaded.workspace.clone(),
        cwd,
        environment,
        stdin,
        timeout_seconds: resource_policy.effective.scalar.timeout_seconds,
        max_output_bytes,
        resource_policy: resource_policy.clone(),
        create_directories,
        artifacts: CommandArtifacts {
            stdout: artifact_root.join(format!("{artifact_name}.stdout.log")),
            stderr: artifact_root.join(format!("{artifact_name}.stderr.log")),
            result: artifact_root.join(format!("{artifact_name}.result.json")),
            trace_pattern,
        },
    })
}

fn copy_environment_variable(environment: &mut BTreeMap<String, String>, name: &str) {
    if let Some(value) = env::var_os(name) {
        environment.insert(name.to_owned(), value.to_string_lossy().into_owned());
    }
}

fn copy_environment_variables_with_prefix(
    environment: &mut BTreeMap<String, String>,
    prefix: &str,
) {
    for (name, value) in env::vars_os() {
        let Some(name) = name.to_str() else {
            continue;
        };
        if name.starts_with(prefix) {
            environment.insert(name.to_owned(), value.to_string_lossy().into_owned());
        }
    }
}

fn push_machine_arguments(args: &mut Vec<String>, loaded: &LoadedManifest) {
    args.push(format!("--main={}", loaded.manifest.main));
    args.push(format!("--init={}", loaded.manifest.init));
    args.push(format!("--step={}", loaded.manifest.step));
}

fn push_named_values(args: &mut Vec<String>, flag: &str, values: &[String]) {
    if !values.is_empty() {
        args.push(flag.to_owned());
        args.extend(values.iter().cloned());
    }
}

fn path_argument(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

fn file_component(value: &str) -> String {
    value
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.') {
                character
            } else {
                '-'
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::manifest::{LoadedManifest, MAX_TIMEOUT_SECONDS};
    use crate::resource::ResourceProfileName;
    use std::fs;
    use tempfile::TempDir;

    fn fixture() -> (TempDir, LoadedManifest) {
        let directory = TempDir::new().expect("tempdir");
        fs::create_dir_all(directory.path().join("formal")).expect("formal directory");
        fs::write(
            directory.path().join("formal/model.qnt"),
            "module model { action init = true action step = true val safe = true }",
        )
        .expect("spec");
        fs::write(
            directory.path().join("formal/fm.toml"),
            r#"
schema_version = 1
project = "example"
model = "machine"
language = "quint"
spec = "formal/model.qnt"
main = "model"
init = "init"
step = "step"
invariants = ["safe"]
witnesses = ["safe"]

[toolchain]
quint = "0.32.0"
java = ">=17"

[simulation]
backend = "typescript"
max_samples = 100
max_steps = 20

[verification]
backend = "tlc"
exhaustive_finite_model = true

[traces]
format = "itf"
model_based_testing_metadata = true
count = 2
max_steps = 10
"#,
        )
        .expect("manifest");
        let loaded = LoadedManifest::load(directory.path(), Path::new("formal/fm.toml"))
            .expect("valid manifest");
        (directory, loaded)
    }

    #[test]
    fn simulation_plan_uses_pinned_quint_and_named_properties() {
        let (_directory, loaded) = fixture();
        let plan = build_plan(&loaded, &Operation::Simulate).expect("simulation plan");
        assert_eq!(plan.program, "npx");
        assert!(plan
            .args
            .contains(&"--package=@informalsystems/quint@0.32.0".to_owned()));
        assert!(plan.args.contains(&"--invariants".to_owned()));
        assert!(plan.args.contains(&"safe".to_owned()));
        assert!(plan.args.contains(&"--witnesses".to_owned()));
        assert!(plan.args.contains(&"--max-samples=100".to_owned()));
        assert!(plan.args.contains(&"--max-steps=20".to_owned()));
        assert_eq!(plan.resource_policy.profile, ResourceProfileName::Local);
        assert_eq!(
            plan.timeout_seconds,
            plan.resource_policy.effective.scalar.timeout_seconds
        );
        assert_eq!(
            plan.max_output_bytes as u64,
            plan.resource_policy.effective.scalar.max_output_bytes
        );
    }

    #[test]
    fn trace_plan_stays_inside_artifact_directory() {
        let (_directory, loaded) = fixture();
        let plan = build_plan(&loaded, &Operation::Trace { output: None }).expect("trace plan");
        let pattern = plan
            .artifacts
            .trace_pattern
            .expect("trace pattern should be present");
        assert!(pattern.starts_with(&loaded.workspace));
        assert!(pattern.to_string_lossy().contains("{seq}"));
    }

    #[test]
    fn trace_plan_uses_its_own_backend_and_seed() {
        let (_directory, mut loaded) = fixture();
        let traces = loaded.manifest.traces.as_mut().expect("traces");
        traces.backend = Some("rust".to_owned());
        traces.seed = Some("0x1234".to_owned());
        let plan = build_plan(&loaded, &Operation::Trace { output: None }).expect("trace plan");
        assert!(plan.args.contains(&"--backend=rust".to_owned()));
        assert!(plan.args.contains(&"--seed=0x1234".to_owned()));
        assert!(!plan.args.contains(&"--backend=typescript".to_owned()));
    }

    #[test]
    fn trace_sample_fallback_is_resolved_before_command_construction() {
        let (_directory, mut loaded) = fixture();
        loaded.manifest.traces.as_mut().expect("traces").max_samples = None;
        let plan = build_plan(&loaded, &Operation::Trace { output: None }).expect("trace plan");
        assert!(plan.args.contains(&"--max-samples=100".to_owned()));
        assert_eq!(plan.resource_policy.effective.scalar.trace_max_samples, 100);
    }

    #[test]
    fn over_policy_manifest_cannot_build_a_plan_or_create_runtime_artifacts() {
        let (_directory, mut loaded) = fixture();
        loaded.manifest.execution.timeout_seconds = MAX_TIMEOUT_SECONDS + 1;
        let artifact_root = loaded
            .workspace
            .join(&loaded.manifest.execution.artifacts_dir)
            .join("fmctl");
        let error = build_plan(&loaded, &Operation::Check).expect_err("over-policy plan must fail");
        assert!(error.to_string().contains("exceeds Local maximum"));
        assert!(!artifact_root.exists());
    }

    #[test]
    fn command_plan_json_contains_complete_resource_policy() {
        let (_directory, loaded) = fixture();
        let plan = build_plan(&loaded, &Operation::Simulate).expect("simulation plan");
        let value = serde_json::to_value(&plan).expect("plan JSON");
        assert_eq!(value["resource_policy"]["profile"], "local");
        assert_eq!(
            value["resource_policy"]["effective"]["scalar"]["simulation_max_samples"],
            100
        );
        assert_eq!(
            value["resource_policy"]["requested"]["simulation_max_steps"],
            20
        );
    }
}
