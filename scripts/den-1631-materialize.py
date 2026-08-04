#!/usr/bin/env python3
"""Wire the merged local resource policy into plans and outcomes."""

from pathlib import Path


def replace_once(path: Path, old: str, new: str, label: str) -> None:
    source = path.read_text(encoding="utf-8")
    count = source.count(old)
    if count != 1:
        raise SystemExit(f"{path}: {label}: expected one exact anchor, found {count}")
    path.write_text(source.replace(old, new, 1), encoding="utf-8")


lib = Path("tools/fmctl/src/lib.rs")
replace_once(lib, "pub mod plan;\n", "pub mod plan;\npub mod resource;\n", "export resource module")

plan = Path("tools/fmctl/src/plan.rs")
replace_once(
    plan,
    "use crate::manifest::{validate_relative_path, AdapterStatus, LoadedManifest, SpecLanguage};\n",
    "use crate::manifest::{validate_relative_path, AdapterStatus, LoadedManifest, SpecLanguage};\n"
    "use crate::resource::{EffectiveResourcePolicy, ResourceProfile, ResourceRequest};\n",
    "import resource policy",
)
replace_once(
    plan,
    "    pub max_output_bytes: usize,\n    pub create_directories: Vec<PathBuf>,\n",
    "    pub max_output_bytes: usize,\n"
    "    pub resource_policy: EffectiveResourcePolicy,\n"
    "    pub create_directories: Vec<PathBuf>,\n",
    "plan policy field",
)
replace_once(
    plan,
    '''pub fn build_plan(loaded: &LoadedManifest, operation: &Operation) -> Result<CommandPlan, FmError> {
    match loaded.manifest.language {
        SpecLanguage::Quint => match operation {
            Operation::Replay { adapter, traces } => build_replay_plan(loaded, adapter, traces),
            _ => build_quint_plan(loaded, operation),
        },
    }
}
''',
    '''pub fn build_plan(loaded: &LoadedManifest, operation: &Operation) -> Result<CommandPlan, FmError> {
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
''',
    "resolve local policy",
)
replace_once(
    plan,
    '''fn build_quint_plan(
    loaded: &LoadedManifest,
    operation: &Operation,
) -> Result<CommandPlan, FmError> {
''',
    '''fn build_quint_plan(
    loaded: &LoadedManifest,
    operation: &Operation,
    resource_policy: &EffectiveResourcePolicy,
) -> Result<CommandPlan, FmError> {
''',
    "quint policy parameter",
)
replace_once(
    plan,
    '''            args.push(format!("--max-samples={}", simulation.max_samples));
            args.push(format!("--max-steps={}", simulation.max_steps));
''',
    '''            args.push(format!(
                "--max-samples={}",
                resource_policy.effective.scalar.simulation_max_samples
            ));
            args.push(format!(
                "--max-steps={}",
                resource_policy.effective.scalar.simulation_max_steps
            ));
''',
    "simulation effective arguments",
)
replace_once(
    plan,
    '''            if let Some(max_steps) = verification.max_steps {
                args.push(format!("--max-steps={max_steps}"));
            }
''',
    '''            if verification.max_steps.is_some() {
                args.push(format!(
                    "--max-steps={}",
                    resource_policy.effective.scalar.verification_max_steps
                ));
            }
''',
    "verification effective arguments",
)
replace_once(
    plan,
    '''            args.push(format!(
                "--max-samples={}",
                traces
                    .max_samples
                    .or_else(|| manifest.simulation.as_ref().map(|value| value.max_samples))
                    .unwrap_or(500)
            ));
            args.push(format!("--max-steps={}", traces.max_steps));
            args.push(format!("--n-traces={}", traces.count));
''',
    '''            args.push(format!(
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
''',
    "trace effective arguments",
)
replace_once(
    plan,
    '''    finalize_plan(
        loaded,
        operation,
        manifest.toolchain.npx.clone(),
''',
    '''    finalize_plan(
        loaded,
        operation,
        resource_policy,
        manifest.toolchain.npx.clone(),
''',
    "quint finalize policy",
)
replace_once(
    plan,
    '''fn build_replay_plan(
    loaded: &LoadedManifest,
    adapter_name: &str,
    traces: &[PathBuf],
) -> Result<CommandPlan, FmError> {
''',
    '''fn build_replay_plan(
    loaded: &LoadedManifest,
    adapter_name: &str,
    traces: &[PathBuf],
    resource_policy: &EffectiveResourcePolicy,
) -> Result<CommandPlan, FmError> {
''',
    "replay policy parameter",
)
replace_once(
    plan,
    '''        let max_trace_bytes =
            u64::try_from(loaded.manifest.execution.max_output_bytes).unwrap_or(u64::MAX);
''',
    '''        let max_trace_bytes = resource_policy.effective.scalar.max_output_bytes;
''',
    "replay effective artifact size",
)
replace_once(
    plan,
    '''    finalize_plan(
        loaded,
        &Operation::Replay {
''',
    '''    finalize_plan(
        loaded,
        &Operation::Replay {
''',
    "replay finalize opening",
)
# Insert policy after the replay operation object closes.
replace_once(
    plan,
    '''            traces: traces.to_vec(),
        },
        program,
''',
    '''            traces: traces.to_vec(),
        },
        resource_policy,
        program,
''',
    "replay finalize policy",
)
replace_once(
    plan,
    '''fn finalize_plan(
    loaded: &LoadedManifest,
    operation: &Operation,
    program: String,
''',
    '''fn finalize_plan(
    loaded: &LoadedManifest,
    operation: &Operation,
    resource_policy: &EffectiveResourcePolicy,
    program: String,
''',
    "finalize policy parameter",
)
replace_once(
    plan,
    '''    Ok(CommandPlan {
        schema_version: 1,
''',
    '''    let max_output_bytes = usize::try_from(
        resource_policy.effective.scalar.max_output_bytes,
    )
    .map_err(|_| FmError::Validation("effective output limit exceeds usize".to_owned()))?;

    Ok(CommandPlan {
        schema_version: 1,
''',
    "effective output conversion",
)
replace_once(
    plan,
    '''        timeout_seconds: loaded.manifest.execution.timeout_seconds,
        max_output_bytes: loaded.manifest.execution.max_output_bytes,
        create_directories,
''',
    '''        timeout_seconds: resource_policy.effective.scalar.timeout_seconds,
        max_output_bytes,
        resource_policy: resource_policy.clone(),
        create_directories,
''',
    "effective runtime limits",
)
replace_once(
    plan,
    '''    use crate::manifest::LoadedManifest;
''',
    '''    use crate::manifest::LoadedManifest;
    use crate::resource::{ResourceProfileName, MAX_TIMEOUT_SECONDS};
''',
    "plan test imports",
)
replace_once(
    plan,
    '''        assert!(plan.args.contains(&"--witnesses".to_owned()));
    }
''',
    '''        assert!(plan.args.contains(&"--witnesses".to_owned()));
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
''',
    "simulation policy assertions",
)
plan_source = plan.read_text(encoding="utf-8")
closing = plan_source.rfind("\n}\n")
if closing < 0:
    raise SystemExit("plan tests closing brace not found")
plan_tests = r'''

    #[test]
    fn trace_sample_fallback_is_resolved_before_command_construction() {
        let (_directory, mut loaded) = fixture();
        loaded
            .manifest
            .traces
            .as_mut()
            .expect("traces")
            .max_samples = None;
        let plan = build_plan(&loaded, &Operation::Trace { output: None })
            .expect("trace plan");
        assert!(plan.args.contains(&"--max-samples=100".to_owned()));
        assert_eq!(
            plan.resource_policy.effective.scalar.trace_max_samples,
            100
        );
    }

    #[test]
    fn over_policy_manifest_cannot_build_a_plan_or_create_runtime_artifacts() {
        let (_directory, mut loaded) = fixture();
        loaded.manifest.execution.timeout_seconds = MAX_TIMEOUT_SECONDS + 1;
        let artifact_root = loaded
            .workspace
            .join(&loaded.manifest.execution.artifacts_dir)
            .join("fmctl");
        let error = build_plan(&loaded, &Operation::Check)
            .expect_err("over-policy plan must fail");
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
'''
plan.write_text(plan_source[:closing] + plan_tests + plan_source[closing:], encoding="utf-8")

runner = Path("tools/fmctl/src/runner.rs")
replace_once(
    runner,
    '''    pub args: Vec<String>,
    pub success: bool,
''',
    '''    pub args: Vec<String>,
    pub resource_policy: crate::resource::EffectiveResourcePolicy,
    pub success: bool,
''',
    "outcome policy field",
)
replace_once(
    runner,
    '''        args: plan.args.clone(),
        success: status.success() && !timed_out,
''',
    '''        args: plan.args.clone(),
        resource_policy: plan.resource_policy.clone(),
        success: status.success() && !timed_out,
''',
    "outcome policy copy",
)
replace_once(
    runner,
    '''    use crate::plan::CommandArtifacts;
''',
    '''    use crate::plan::CommandArtifacts;
    use crate::resource::{ResourceProfile, ResourceRequest};
''',
    "runner test policy imports",
)
replace_once(
    runner,
    '''        let plan = CommandPlan {
            schema_version: 1,
''',
    '''        let resource_policy = ResourceProfile::local_v1()
            .resolve(ResourceRequest {
                timeout_seconds: Some(1),
                max_output_bytes: Some(1024),
                ..ResourceRequest::absent()
            })
            .expect("test policy");
        let plan = CommandPlan {
            schema_version: 1,
''',
    "runner test policy resolution",
)
replace_once(
    runner,
    '''            max_output_bytes: 1024,
            create_directories: vec![artifacts.clone()],
''',
    '''            max_output_bytes: 1024,
            resource_policy: resource_policy.clone(),
            create_directories: vec![artifacts.clone()],
''',
    "runner test plan policy",
)
replace_once(
    runner,
    '''        assert!(outcome.timed_out);
        assert!(started.elapsed() < Duration::from_secs(10));
''',
    '''        assert!(outcome.timed_out);
        assert_eq!(outcome.resource_policy, resource_policy);
        assert!(started.elapsed() < Duration::from_secs(10));
''',
    "runner outcome policy assertion",
)
