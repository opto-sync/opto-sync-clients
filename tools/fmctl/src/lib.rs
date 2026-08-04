pub mod adapter;
pub mod error;
pub mod manifest;
pub mod plan;
pub mod resource;
pub mod result;
pub mod rpc;
pub mod runner;

use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::adapter::parse_replay_response;
use crate::error::FmError;
use crate::manifest::{validate_relative_path, LoadedManifest, ValidationReport};
use crate::plan::{build_plan, CommandPlan, Operation, ReplayRequest};
use crate::resource::ResourceProfile;
use crate::runner::{execute_plan, write_artifact, CommandOutcome};

#[derive(Debug, Clone)]
pub struct App {
    workspace: PathBuf,
    manifest_path: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InitRequest {
    pub project: String,
    pub model: String,
    pub spec: PathBuf,
    pub main: String,
    pub force: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct InitReport {
    pub created: bool,
    pub workspace: PathBuf,
    pub manifest: PathBuf,
    pub specification: PathBuf,
}

#[derive(Debug, Clone, Serialize)]
pub struct DoctorReport {
    pub ready: bool,
    pub project: String,
    pub model: String,
    pub configured_quint: String,
    pub configured_java: String,
    pub probes: Vec<ToolProbe>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ToolProbe {
    pub name: String,
    pub command: Vec<String>,
    pub available: bool,
    pub exit_code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
}

impl App {
    pub fn new(workspace: impl Into<PathBuf>, manifest_path: impl Into<PathBuf>) -> Self {
        Self {
            workspace: workspace.into(),
            manifest_path: manifest_path.into(),
        }
    }

    pub fn workspace(&self) -> &Path {
        &self.workspace
    }

    pub fn manifest_path(&self) -> &Path {
        &self.manifest_path
    }

    pub fn load(&self) -> Result<LoadedManifest, FmError> {
        LoadedManifest::load(&self.workspace, &self.manifest_path)
    }

    pub fn validate(&self) -> Result<ValidationReport, FmError> {
        Ok(self.load()?.report())
    }

    pub fn plan(&self, operation: &Operation) -> Result<CommandPlan, FmError> {
        let loaded = self.load()?;
        build_plan(&loaded, operation)
    }

    pub fn execute(&self, operation: &Operation) -> Result<CommandOutcome, FmError> {
        let loaded = self.load()?;
        let plan = build_plan(&loaded, operation)?;
        if matches!(operation, Operation::Trace { .. }) {
            clear_existing_trace_outputs(&plan)?;
        }
        let mut outcome = execute_plan(&plan)?;
        let child_succeeded = outcome.success;
        let mut deferred_error = None;

        if outcome.stdout_truncated || outcome.stderr_truncated {
            let message = format!(
                "captured output exceeded the {}-byte limit (stdout_truncated={}, stderr_truncated={})",
                plan.max_output_bytes, outcome.stdout_truncated, outcome.stderr_truncated
            );
            fail_outcome(&mut outcome, message.clone(), 10);
            if child_succeeded && matches!(operation, Operation::Replay { .. }) {
                deferred_error = Some(FmError::AdapterProtocol(message));
            }
        }

        if child_succeeded && matches!(operation, Operation::Trace { .. }) {
            if let Err(error) = validate_trace_corpus(&loaded, &plan) {
                fail_outcome(&mut outcome, error.to_string(), error.exit_code());
                deferred_error = Some(error);
            }
        }

        if matches!(operation, Operation::Replay { .. })
            && !outcome.timed_out
            && !outcome.stdout_truncated
        {
            let response = plan
                .stdin
                .as_deref()
                .ok_or_else(|| {
                    FmError::AdapterProtocol("internal replay plan omitted its request".to_owned())
                })
                .and_then(|request| {
                    let request: ReplayRequest = serde_json::from_str(request)?;
                    parse_replay_response(&outcome.stdout, &request)
                });
            match response {
                Ok(response) => {
                    if response.success && !child_succeeded {
                        fail_outcome(
                            &mut outcome,
                            "adapter reported success but its process exited unsuccessfully"
                                .to_owned(),
                            10,
                        );
                    } else if !response.success {
                        fail_outcome(
                            &mut outcome,
                            format!(
                                "adapter reported {} mismatch(es)",
                                response.mismatches.len()
                            ),
                            10,
                        );
                    }
                    outcome.adapter_response = Some(response);
                }
                Err(error) => {
                    fail_outcome(&mut outcome, error.to_string(), error.exit_code());
                    if child_succeeded && deferred_error.is_none() {
                        deferred_error = Some(error);
                    }
                }
            }
        } else if matches!(operation, Operation::Replay { .. }) && outcome.failure.is_none() {
            outcome.failure =
                Some("adapter process failed before returning a protocol response".to_owned());
        }

        let result_json = serde_json::to_vec_pretty(&outcome)?;
        write_artifact(&plan.workspace, &outcome.artifacts.result, &result_json)?;
        if let Some(error) = deferred_error {
            return Err(error);
        }
        Ok(outcome)
    }

    pub fn doctor(&self) -> Result<DoctorReport, FmError> {
        let loaded = self.load()?;
        let base_plan = build_plan(&loaded, &Operation::Check)?;
        let npx = loaded.manifest.toolchain.npx.clone();
        let quint_package = format!(
            "--package=@informalsystems/quint@{}",
            loaded.manifest.toolchain.quint
        );
        let probes = vec![
            probe_tool(&base_plan, "npx", &npx, &["--version"]),
            probe_tool(&base_plan, "java", "java", &["-version"]),
            probe_tool(
                &base_plan,
                "quint",
                &npx,
                &["--yes", &quint_package, "quint", "--version"],
            ),
        ];
        let ready = probes.iter().all(|probe| probe.available);

        Ok(DoctorReport {
            ready,
            project: loaded.manifest.project.clone(),
            model: loaded.manifest.model.clone(),
            configured_quint: loaded.manifest.toolchain.quint.clone(),
            configured_java: loaded.manifest.toolchain.java.clone(),
            probes,
        })
    }

    pub fn init(&self, request: &InitRequest) -> Result<InitReport, FmError> {
        validate_init_label("project", &request.project)?;
        validate_init_label("model", &request.model)?;
        validate_init_identifier("main", &request.main)?;
        validate_relative_path("manifest", &self.manifest_path).map_err(FmError::Validation)?;
        validate_relative_path("spec", &request.spec).map_err(FmError::Validation)?;

        let workspace = fs::canonicalize(&self.workspace)
            .map_err(|source| FmError::io(&self.workspace, source))?;
        let manifest_path = workspace.join(&self.manifest_path);
        let spec_path = workspace.join(&request.spec);

        let manifest_exists = path_entry_exists(&manifest_path)?;
        if manifest_exists && !request.force {
            return Err(FmError::Validation(format!(
                "refusing to overwrite existing manifest {}; pass --force to replace it",
                manifest_path.display()
            )));
        }

        ensure_workspace_parent(&workspace, &manifest_path)?;
        ensure_workspace_parent(&workspace, &spec_path)?;

        if path_entry_exists(&spec_path)? {
            validate_existing_workspace_file(&workspace, &spec_path, "specification")?;
        } else {
            let specification = specification_template(&request.main);
            write_artifact(&workspace, &spec_path, specification.as_bytes())?;
        }
        let manifest = manifest_template(request, &request.spec, &request.main);
        write_artifact(&workspace, &manifest_path, manifest.as_bytes())?;

        LoadedManifest::load(&workspace, &self.manifest_path)?;

        Ok(InitReport {
            created: true,
            workspace,
            manifest: manifest_path,
            specification: spec_path,
        })
    }
}

fn fail_outcome(outcome: &mut CommandOutcome, message: String, exit_code: u8) {
    outcome.success = false;
    if outcome.exit_code.unwrap_or(0) == 0 {
        outcome.exit_code = Some(i32::from(exit_code));
    }
    outcome.failure = Some(message);
}

fn clear_existing_trace_outputs(plan: &CommandPlan) -> Result<(), FmError> {
    let pattern =
        plan.artifacts.trace_pattern.as_deref().ok_or_else(|| {
            FmError::Validation("trace plan omitted its output pattern".to_owned())
        })?;
    for path in matching_trace_paths(pattern)? {
        let metadata = fs::symlink_metadata(&path).map_err(|source| FmError::io(&path, source))?;
        if !(metadata.file_type().is_file() || metadata.file_type().is_symlink()) {
            return Err(FmError::Validation(format!(
                "refusing to replace non-file trace artifact {}",
                path.display()
            )));
        }
        fs::remove_file(&path).map_err(|source| FmError::io(&path, source))?;
    }
    Ok(())
}

fn validate_trace_corpus(loaded: &LoadedManifest, plan: &CommandPlan) -> Result<(), FmError> {
    let traces =
        loaded
            .manifest
            .traces
            .as_ref()
            .ok_or_else(|| FmError::OperationNotConfigured {
                operation: "trace",
                manifest: loaded.manifest_path.clone(),
            })?;
    let pattern =
        plan.artifacts.trace_pattern.as_deref().ok_or_else(|| {
            FmError::Validation("trace plan omitted its output pattern".to_owned())
        })?;
    let paths = matching_trace_paths(pattern)?;
    let expected_count = usize::try_from(traces.count).map_err(|_| {
        FmError::Validation("configured trace count exceeds platform limits".to_owned())
    })?;
    if paths.len() != expected_count {
        return Err(FmError::Validation(format!(
            "trace generator produced {} distinct files; expected {expected_count}",
            paths.len()
        )));
    }

    let mut actions = BTreeSet::new();
    for path in paths {
        let metadata = fs::symlink_metadata(&path).map_err(|source| FmError::io(&path, source))?;
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            return Err(FmError::Validation(format!(
                "trace artifact is not a regular file: {}",
                path.display()
            )));
        }
        if metadata.len() == 0
            || metadata.len()
                > u64::try_from(loaded.manifest.execution.max_output_bytes).unwrap_or(u64::MAX)
        {
            return Err(FmError::Validation(format!(
                "trace artifact has invalid size {}: {}",
                metadata.len(),
                path.display()
            )));
        }
        let source = fs::read_to_string(&path).map_err(|error| FmError::io(&path, error))?;
        let trace: serde_json::Value = serde_json::from_str(&source)?;
        let states = trace
            .get("states")
            .and_then(serde_json::Value::as_array)
            .filter(|states| !states.is_empty())
            .ok_or_else(|| {
                FmError::Validation(format!(
                    "trace has no nonempty states array: {}",
                    path.display()
                ))
            })?;
        for (index, state) in states.iter().enumerate() {
            let action = state
                .get("mbt::actionTaken")
                .and_then(serde_json::Value::as_str)
                .filter(|action| !action.is_empty())
                .ok_or_else(|| {
                    FmError::Validation(format!(
                        "trace state {index} has no model action: {}",
                        path.display()
                    ))
                })?;
            actions.insert(action.to_owned());
        }
    }
    let missing = traces
        .required_actions
        .iter()
        .filter(|action| !actions.contains(*action))
        .cloned()
        .collect::<Vec<_>>();
    if !missing.is_empty() {
        return Err(FmError::Validation(format!(
            "trace corpus does not cover required actions: {}",
            missing.join(", ")
        )));
    }
    Ok(())
}

fn matching_trace_paths(pattern: &Path) -> Result<Vec<PathBuf>, FmError> {
    let parent = pattern.parent().ok_or_else(|| {
        FmError::Validation(format!(
            "trace output pattern has no parent: {}",
            pattern.display()
        ))
    })?;
    if !parent.exists() {
        return Ok(Vec::new());
    }
    let file_name = pattern
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| {
            FmError::Validation("trace output pattern must be valid UTF-8".to_owned())
        })?;
    let (prefix, suffix) = file_name.split_once("{seq}").ok_or_else(|| {
        FmError::Validation("trace output pattern has no '{seq}' placeholder".to_owned())
    })?;
    let mut paths = Vec::new();
    for entry in fs::read_dir(parent).map_err(|source| FmError::io(parent, source))? {
        let entry = entry.map_err(|source| FmError::io(parent, source))?;
        let name = entry.file_name();
        let Some(name) = name.to_str() else {
            continue;
        };
        let sequence = name
            .strip_prefix(prefix)
            .and_then(|name| name.strip_suffix(suffix));
        if sequence.is_some_and(|sequence| {
            !sequence.is_empty() && sequence.chars().all(|character| character.is_ascii_digit())
        }) {
            paths.push(entry.path());
        }
    }
    paths.sort();
    Ok(paths)
}

fn probe_tool(base_plan: &CommandPlan, name: &str, program: &str, args: &[&str]) -> ToolProbe {
    let command = std::iter::once(program.to_owned())
        .chain(args.iter().map(|argument| (*argument).to_owned()))
        .collect::<Vec<_>>();
    let Some(artifact_root) = base_plan.artifacts.stdout.parent() else {
        return ToolProbe {
            name: name.to_owned(),
            command,
            available: false,
            exit_code: None,
            stdout: String::new(),
            stderr: "internal doctor plan has no artifact directory".to_owned(),
        };
    };
    let mut plan = base_plan.clone();
    plan.operation = format!("doctor-{name}");
    plan.program = program.to_owned();
    plan.args = args.iter().map(|argument| (*argument).to_owned()).collect();
    plan.stdin = None;
    let probe_timeout = plan.timeout_seconds.clamp(1, 120);
    let probe_output = plan.max_output_bytes.clamp(1024, 64 * 1024);
    let mut request = plan.resource_policy.requested.clone();
    request.timeout_seconds = Some(probe_timeout);
    request.max_output_bytes = Some(u64::try_from(probe_output).unwrap_or(u64::MAX));
    let probe_policy = match ResourceProfile::local_v1().resolve(request) {
        Ok(policy) => policy,
        Err(error) => {
            return ToolProbe {
                name: name.to_owned(),
                command,
                available: false,
                exit_code: None,
                stdout: String::new(),
                stderr: format!("failed to resolve doctor resource policy: {error}"),
            };
        }
    };
    let probe_output = match usize::try_from(probe_policy.effective.scalar.max_output_bytes) {
        Ok(value) => value,
        Err(_) => {
            return ToolProbe {
                name: name.to_owned(),
                command,
                available: false,
                exit_code: None,
                stdout: String::new(),
                stderr: "doctor output policy exceeds usize".to_owned(),
            };
        }
    };
    plan.timeout_seconds = probe_policy.effective.scalar.timeout_seconds;
    plan.max_output_bytes = probe_output;
    plan.resource_policy = probe_policy;
    plan.artifacts.stdout = artifact_root.join(format!("doctor-{name}.stdout.log"));
    plan.artifacts.stderr = artifact_root.join(format!("doctor-{name}.stderr.log"));
    plan.artifacts.result = artifact_root.join(format!("doctor-{name}.result.json"));
    plan.artifacts.trace_pattern = None;

    match execute_plan(&plan) {
        Ok(output) => {
            let mut stderr = output.stderr.trim().to_owned();
            if output.timed_out {
                append_probe_error(&mut stderr, "probe timed out");
            }
            if output.stdout_truncated || output.stderr_truncated {
                append_probe_error(&mut stderr, "probe output exceeded the capture limit");
            }
            ToolProbe {
                name: name.to_owned(),
                command,
                available: output.success && !output.stdout_truncated && !output.stderr_truncated,
                exit_code: output.exit_code,
                stdout: output.stdout.trim().to_owned(),
                stderr,
            }
        }
        Err(error) => ToolProbe {
            name: name.to_owned(),
            command,
            available: false,
            exit_code: None,
            stdout: String::new(),
            stderr: error.to_string(),
        },
    }
}

fn append_probe_error(stderr: &mut String, message: &str) {
    if !stderr.is_empty() {
        stderr.push('\n');
    }
    stderr.push_str(message);
}

fn path_entry_exists(path: &Path) -> Result<bool, FmError> {
    match fs::symlink_metadata(path) {
        Ok(_) => Ok(true),
        Err(source) if source.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(source) => Err(FmError::io(path, source)),
    }
}

fn ensure_workspace_parent(workspace: &Path, path: &Path) -> Result<(), FmError> {
    let parent = path.parent().ok_or_else(|| {
        FmError::Validation(format!("generated path has no parent: {}", path.display()))
    })?;
    let relative = parent.strip_prefix(workspace).map_err(|_| {
        FmError::Validation(format!(
            "generated path is outside the workspace: {}",
            path.display()
        ))
    })?;
    let mut current = workspace.to_path_buf();
    for component in relative.components() {
        let std::path::Component::Normal(segment) = component else {
            return Err(FmError::Validation(format!(
                "generated path contains an invalid component: {}",
                path.display()
            )));
        };
        current.push(segment);
        match fs::symlink_metadata(&current) {
            Ok(metadata) => {
                if metadata.file_type().is_symlink() {
                    return Err(FmError::Validation(format!(
                        "refusing to write through symlinked parent {}",
                        current.display()
                    )));
                }
                if !metadata.is_dir() {
                    return Err(FmError::Validation(format!(
                        "generated path parent is not a directory: {}",
                        current.display()
                    )));
                }
            }
            Err(source) if source.kind() == std::io::ErrorKind::NotFound => {
                fs::create_dir(&current).map_err(|source| FmError::io(&current, source))?;
            }
            Err(source) => return Err(FmError::io(&current, source)),
        }
    }
    let canonical_parent =
        fs::canonicalize(parent).map_err(|source| FmError::io(parent, source))?;
    if !canonical_parent.starts_with(workspace) {
        return Err(FmError::Validation(format!(
            "generated path parent escapes the workspace: {}",
            canonical_parent.display()
        )));
    }
    Ok(())
}

fn validate_existing_workspace_file(
    workspace: &Path,
    path: &Path,
    label: &str,
) -> Result<(), FmError> {
    let canonical = fs::canonicalize(path).map_err(|source| FmError::io(path, source))?;
    if !canonical.starts_with(workspace) {
        return Err(FmError::Validation(format!(
            "{label} escapes the workspace after canonicalization: {}",
            canonical.display()
        )));
    }
    let metadata = fs::metadata(&canonical).map_err(|source| FmError::io(&canonical, source))?;
    if !metadata.is_file() {
        return Err(FmError::Validation(format!(
            "{label} is not a regular file: {}",
            canonical.display()
        )));
    }
    Ok(())
}

fn validate_init_label(label: &str, value: &str) -> Result<(), FmError> {
    if value.is_empty()
        || value.len() > 128
        || !value.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.')
        })
    {
        return Err(FmError::Validation(format!(
            "{label} must contain only ASCII letters, digits, '.', '-', or '_'"
        )));
    }
    Ok(())
}

fn validate_init_identifier(label: &str, value: &str) -> Result<(), FmError> {
    let mut characters = value.chars();
    let Some(first) = characters.next() else {
        return Err(FmError::Validation(format!("{label} must not be empty")));
    };
    if !(first.is_ascii_alphabetic() || first == '_')
        || !characters.all(|character| character.is_ascii_alphanumeric() || character == '_')
    {
        return Err(FmError::Validation(format!(
            "{label} must be a Quint-compatible identifier"
        )));
    }
    Ok(())
}

fn manifest_template(request: &InitRequest, spec: &Path, main: &str) -> String {
    format!(
        r#"# fmctl manifest schema v1
schema_version = 1
project = "{}"
model = "{}"
language = "quint"
spec = "{}"
main = "{}"
init = "init"
step = "step"
invariants = ["safety"]
witnesses = []

[toolchain]
quint = "0.32.0"
java = ">=17"
npx = "npx"

[execution]
timeout_seconds = 1200
max_output_bytes = 8388608
artifacts_dir = ".formal-artifacts"

[simulation]
backend = "typescript"
max_samples = 10000
max_steps = 40

[verification]
backend = "tlc"
exhaustive_finite_model = true

[traces]
format = "itf"
model_based_testing_metadata = true
count = 8
max_steps = 30
max_samples = 500
"#,
        request.project,
        request.model,
        spec.to_string_lossy(),
        main
    )
}

fn specification_template(main: &str) -> String {
    format!(
        r#"module {main} {{
  var counter: int

  action init = {{
    counter' = 0
  }}

  action step = {{
    any {{
      counter' = counter,
      counter' = counter + 1,
    }}
  }}

  val safety = counter >= 0
}}
"#
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn init_creates_a_manifest_that_loads() {
        let directory = TempDir::new().expect("tempdir");
        let app = App::new(directory.path(), "formal/fm.toml");
        let report = app
            .init(&InitRequest {
                project: "example".to_owned(),
                model: "counter".to_owned(),
                spec: PathBuf::from("formal/counter.qnt"),
                main: "counter".to_owned(),
                force: false,
            })
            .expect("init");
        assert!(report.manifest.exists());
        assert!(app.validate().expect("validate").valid);
    }

    #[cfg(unix)]
    #[test]
    fn doctor_probe_uses_the_bounded_execution_plan() {
        let directory = TempDir::new().expect("tempdir");
        let app = App::new(directory.path(), "formal/fm.toml");
        app.init(&InitRequest {
            project: "example".to_owned(),
            model: "counter".to_owned(),
            spec: PathBuf::from("formal/counter.qnt"),
            main: "counter".to_owned(),
            force: false,
        })
        .expect("init");
        let plan = app.plan(&Operation::Check).expect("check plan");

        let probe = probe_tool(&plan, "example", "/bin/sh", &["-c", "printf available"]);

        assert!(probe.available);
        assert_eq!(probe.stdout, "available");
        let artifact_root = plan.artifacts.stdout.parent().expect("artifact root");
        assert!(artifact_root.join("doctor-example.stdout.log").is_file());
    }

    #[cfg(unix)]
    #[test]
    fn init_rejects_a_symlinked_parent_that_escapes_the_workspace() {
        use std::os::unix::fs::symlink;

        let workspace = TempDir::new().expect("workspace");
        let outside = TempDir::new().expect("outside");
        symlink(outside.path(), workspace.path().join("formal")).expect("symlink");
        let app = App::new(workspace.path(), "formal/fm.toml");

        let error = app
            .init(&InitRequest {
                project: "example".to_owned(),
                model: "counter".to_owned(),
                spec: PathBuf::from("formal/counter.qnt"),
                main: "counter".to_owned(),
                force: false,
            })
            .expect_err("symlink escape must fail");

        assert!(error.to_string().contains("symlinked parent"));
        assert!(!outside.path().join("fm.toml").exists());
        assert!(!outside.path().join("counter.qnt").exists());
    }
}
