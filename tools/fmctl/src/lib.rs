pub mod adapter;
pub mod error;
pub mod manifest;
pub mod plan;
pub mod rpc;
pub mod runner;

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use serde::{Deserialize, Serialize};

use crate::adapter::parse_replay_response;
use crate::error::FmError;
use crate::manifest::{validate_relative_path, LoadedManifest, ValidationReport};
use crate::plan::{build_plan, CommandPlan, Operation};
use crate::runner::{execute_plan, CommandOutcome};

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
        let plan = self.plan(operation)?;
        let mut outcome = execute_plan(&plan)?;
        if matches!(operation, Operation::Replay { .. }) && outcome.success {
            let response = parse_replay_response(&outcome.stdout)?;
            if !response.success {
                outcome.success = false;
                outcome.exit_code = Some(10);
            }
            outcome.adapter_response = Some(response);
            let result_json = serde_json::to_vec_pretty(&outcome)?;
            fs::write(&outcome.artifacts.result, result_json)
                .map_err(|source| FmError::io(&outcome.artifacts.result, source))?;
        }
        Ok(outcome)
    }

    pub fn doctor(&self) -> Result<DoctorReport, FmError> {
        let loaded = self.load()?;
        let npx = loaded.manifest.toolchain.npx.clone();
        let quint_package = format!(
            "--package=@informalsystems/quint@{}",
            loaded.manifest.toolchain.quint
        );
        let probes = vec![
            probe_tool("npx", &npx, &["--version"]),
            probe_tool("java", "java", &["-version"]),
            probe_tool(
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

        if manifest_path.exists() && !request.force {
            return Err(FmError::Validation(format!(
                "refusing to overwrite existing manifest {}; pass --force to replace it",
                manifest_path.display()
            )));
        }

        if let Some(parent) = manifest_path.parent() {
            fs::create_dir_all(parent).map_err(|source| FmError::io(parent, source))?;
        }
        if let Some(parent) = spec_path.parent() {
            fs::create_dir_all(parent).map_err(|source| FmError::io(parent, source))?;
        }

        if !spec_path.exists() {
            fs::write(&spec_path, specification_template(&request.main))
                .map_err(|source| FmError::io(&spec_path, source))?;
        }
        fs::write(
            &manifest_path,
            manifest_template(request, &request.spec, &request.main),
        )
        .map_err(|source| FmError::io(&manifest_path, source))?;

        LoadedManifest::load(&workspace, &self.manifest_path)?;

        Ok(InitReport {
            created: true,
            workspace,
            manifest: manifest_path,
            specification: spec_path,
        })
    }
}

fn probe_tool(name: &str, program: &str, args: &[&str]) -> ToolProbe {
    let command = std::iter::once(program.to_owned())
        .chain(args.iter().map(|argument| (*argument).to_owned()))
        .collect::<Vec<_>>();
    match Command::new(program).args(args).output() {
        Ok(output) => ToolProbe {
            name: name.to_owned(),
            command,
            available: output.status.success(),
            exit_code: output.status.code(),
            stdout: String::from_utf8_lossy(&output.stdout).trim().to_owned(),
            stderr: String::from_utf8_lossy(&output.stderr).trim().to_owned(),
        },
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
}
