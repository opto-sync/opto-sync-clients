#[path = "../src/resource.rs"]
mod resource;

#[test]
fn local_policy_maxima_track_the_manifest_v1_constants() {
    let manifest_source = include_str!("../src/manifest.rs");
    let local = resource::ResourceProfile::local_v1();
    let checks = [
        (
            "MAX_TIMEOUT_SECONDS",
            local.maximum.scalar.timeout_seconds.to_string(),
        ),
        (
            "MAX_OUTPUT_BYTES",
            local.maximum.scalar.max_output_bytes.to_string(),
        ),
        (
            "MAX_SIMULATION_SAMPLES",
            local.maximum.scalar.simulation_max_samples.to_string(),
        ),
        (
            "MAX_SIMULATION_STEPS",
            local.maximum.scalar.simulation_max_steps.to_string(),
        ),
        (
            "MAX_SIMULATION_WORK",
            local.maximum.max_simulation_work.to_string(),
        ),
        (
            "MAX_VERIFICATION_STEPS",
            local.maximum.scalar.verification_max_steps.to_string(),
        ),
        ("MAX_TRACE_COUNT", local.maximum.scalar.trace_count.to_string()),
        (
            "MAX_TRACE_STEPS",
            local.maximum.scalar.trace_max_steps.to_string(),
        ),
        (
            "MAX_TRACE_SAMPLES",
            local.maximum.scalar.trace_max_samples.to_string(),
        ),
        ("MAX_TRACE_WORK", local.maximum.max_trace_work.to_string()),
    ];

    for (name, decimal_value) in checks {
        let normalized = decimal_value
            .as_bytes()
            .rchunks(3)
            .rev()
            .map(std::str::from_utf8)
            .collect::<Result<Vec<_>, _>>()
            .expect("ASCII decimal chunks")
            .join("_");
        assert!(
            manifest_source.contains(&format!("pub const {name}")),
            "manifest does not declare {name}"
        );
        assert!(
            manifest_source.contains(&normalized) || manifest_source.contains(&decimal_value),
            "manifest constant {name} does not contain {decimal_value}"
        );
    }
}
