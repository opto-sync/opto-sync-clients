#!/usr/bin/env python3
"""Materialize the DEN-1623 Rust budget validation exactly once."""

from pathlib import Path

PATH = Path("tools/fmctl/src/manifest.rs")
source = PATH.read_text(encoding="utf-8")

if "pub const MAX_TIMEOUT_SECONDS" in source:
    raise SystemExit("DEN-1623 execution budgets are already materialized")


def replace_once(old: str, new: str, label: str) -> None:
    global source
    count = source.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one exact anchor, found {count}")
    source = source.replace(old, new, 1)


replace_once(
    "pub const MAX_ENVIRONMENT_VALUE_BYTES: usize = 4096;\n",
    """pub const MAX_ENVIRONMENT_VALUE_BYTES: usize = 4096;
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
""",
    "budget constants",
)

replace_once(
    """    if manifest.execution.timeout_seconds == 0 {
        errors.push("execution.timeout_seconds must be greater than zero".to_owned());
    }
    if manifest.execution.max_output_bytes < 1_024 {
        errors.push("execution.max_output_bytes must be at least 1024".to_owned());
    }
""",
    """    if manifest.execution.timeout_seconds == 0 {
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
""",
    "execution scalar validation",
)

replace_once(
    """        if simulation.max_samples == 0 {
            errors.push("simulation.max_samples must be greater than zero".to_owned());
        }
        if simulation.max_steps == 0 {
            errors.push("simulation.max_steps must be greater than zero".to_owned());
        }
""",
    """        if simulation.max_samples == 0 {
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
""",
    "simulation validation",
)

replace_once(
    """        if verification.max_steps == Some(0) {
            errors.push("verification.max_steps must be greater than zero when set".to_owned());
        }
""",
    """        if verification.max_steps == Some(0) {
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
""",
    "verification validation",
)

replace_once(
    """        if traces.count == 0 {
            errors.push("traces.count must be greater than zero".to_owned());
        }
        if traces.max_steps == 0 {
            errors.push("traces.max_steps must be greater than zero".to_owned());
        }
        if traces.max_samples == Some(0) {
            errors.push("traces.max_samples must be greater than zero when set".to_owned());
        }
""",
    """        if traces.count == 0 {
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
""",
    "trace validation",
)

helper_anchor = "fn validate_collection_limit(label: &str, actual: usize, maximum: usize, errors: &mut Vec<String>) {\n"
helper = """fn validate_work_product(
    label: &str,
    left: u64,
    right: u64,
    maximum: u64,
    errors: &mut Vec<String>,
) {
    match left.checked_mul(right) {
        Some(actual) if actual <= maximum => {}
        Some(actual) => errors.push(format!(
            "{label} must be at most {maximum}, got {actual}"
        )),
        None => errors.push(format!("{label} overflows u64")),
    }
}

"""
replace_once(helper_anchor, helper + helper_anchor, "aggregate helper")

tests = r'''

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

        manifest.simulation.as_mut().expect("simulation").max_samples = 10_001;
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

        manifest.verification.as_mut().expect("verification").max_steps =
            Some(MAX_VERIFICATION_STEPS + 1);
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
'''

closing = source.rfind("\n}\n")
if closing < 0:
    raise SystemExit("tests module closing brace was not found")
source = source[:closing] + tests + source[closing:]

PATH.write_text(source, encoding="utf-8")
