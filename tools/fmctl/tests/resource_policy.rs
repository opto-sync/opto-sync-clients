#[path = "../src/resource.rs"]
mod resource;

#[test]
fn local_policy_maxima_track_the_manifest_v1_constants() {
    let manifest_source = include_str!("../src/manifest.rs");
    let expected_declarations = [
        "pub const MAX_TIMEOUT_SECONDS: u64 = 21_600;",
        "pub const MAX_OUTPUT_BYTES: usize = 64 * 1024 * 1024;",
        "pub const MAX_SIMULATION_SAMPLES: u64 = 1_000_000;",
        "pub const MAX_SIMULATION_STEPS: u64 = 100_000;",
        "pub const MAX_SIMULATION_WORK: u64 = 100_000_000;",
        "pub const MAX_VERIFICATION_STEPS: u64 = 100_000;",
        "pub const MAX_TRACE_COUNT: u64 = 10_000;",
        "pub const MAX_TRACE_STEPS: u64 = 100_000;",
        "pub const MAX_TRACE_SAMPLES: u64 = 1_000_000;",
        "pub const MAX_TRACE_WORK: u64 = 100_000_000;",
    ];
    for declaration in expected_declarations {
        assert!(
            manifest_source.contains(declaration),
            "manifest/resource policy drift: missing {declaration}"
        );
    }

    let local = resource::ResourceProfile::local_v1();
    assert_eq!(local.maximum.scalar.timeout_seconds, 21_600);
    assert_eq!(local.maximum.scalar.max_output_bytes, 64 * 1024 * 1024);
    assert_eq!(local.maximum.scalar.simulation_max_samples, 1_000_000);
    assert_eq!(local.maximum.scalar.simulation_max_steps, 100_000);
    assert_eq!(local.maximum.max_simulation_work, 100_000_000);
    assert_eq!(local.maximum.scalar.verification_max_steps, 100_000);
    assert_eq!(local.maximum.scalar.trace_count, 10_000);
    assert_eq!(local.maximum.scalar.trace_max_steps, 100_000);
    assert_eq!(local.maximum.scalar.trace_max_samples, 1_000_000);
    assert_eq!(local.maximum.max_trace_work, 100_000_000);
}
